import middy from '@middy/core';
import httpJsonBodyParser from '@middy/http-json-body-parser';
import httpErrorHandler from '@middy/http-error-handler';
import httpCors from '@middy/http-cors';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { idempotencyMiddleware } from '@/middleware/idempotency';

import { SubmitTaskHandler, TaskStatus } from '@/types';
import { validateEnvironment, processingConfig } from '@/config';
import {
  logger,
  metrics,
  tracer,
  powertoolsLoggerInstance,
  createApiContext,
} from '@/utils/logger';
import {
  handleError,
  getCorrelationId,
  createdResponse,
  badRequestResponse,
} from '@/utils/response';
import {
  SubmitTaskRequestDto,
  TaskSubmissionResponseDto,
  type SubmitTaskRequest,
  type TaskSubmissionResponse,
} from '@/dto';
import {
  requestValidation,
  responseValidation,
  validationErrorHandler,
} from '@/middleware/validation';
import { sqsService } from '@/services/sqsService';
import { dynamoService } from '@/services/dynamoService';

const customIdempotencyMiddleware = idempotencyMiddleware({
  tableName: process.env.IDEMPOTENCY_TABLE_NAME || 'task-processing-idempotency',
  expirationMinutes: 60,
  keyExtractor: event => {
    if ((event as any).validatedBody?.taskId) {
      return (event as any).validatedBody.taskId;
    }
    try {
      const body = JSON.parse(event.body || '{}');
      return body.taskId || null;
    } catch {
      return null;
    }
  },
});

const baseSubmitTaskHandler: SubmitTaskHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const startTime = Date.now();

  const correlationId = getCorrelationId(event.headers);
  const context = createApiContext(correlationId, event.headers['user-agent']);

  logger.addContext({ correlationId });
  metrics.addMetadata('correlationId', correlationId);
  metrics.addMetadata('userAgent', event.headers['user-agent'] || 'unknown');
  metrics.addMetadata('sourceIp', event.requestContext.identity.sourceIp);
  logger.apiRequestReceived(event.httpMethod, event.path, {
    ...context,
    sourceIp: event.requestContext.identity.sourceIp,
  });

  try {
    validateEnvironment();

    if (event.httpMethod !== 'POST') {
      metrics.addMetric('InvalidMethod', 'Count', 1);
      return badRequestResponse('Only POST method is allowed');
    }

    const requestData = (event as APIGatewayProxyEvent & { validatedBody: SubmitTaskRequest })
      .validatedBody;
    const { taskId, payload } = requestData;
    const now = new Date().toISOString();
    logger.addContext({ taskId });
    metrics.addMetadata('taskId', taskId);
    logger.info('Processing task submission', {
      ...context,
      taskId,
      payloadSize: JSON.stringify(payload).length,
    });
    const failureDecisionSegment = tracer.getSegment()?.addNewSubsegment('determineFailureDestiny');
    const failureDecision = await dynamoService.getFailureRateDecisionForNewTask(taskId);
    failureDecisionSegment?.close();
    logger.info('Task failure destiny determined', {
      ...context,
      taskId,
      shouldFail: failureDecision.shouldFail,
      currentFailureRate: Math.round(failureDecision.currentFailureRate * 1000) / 10,
      targetFailureRate: Math.round(processingConfig.failureRate * 1000) / 10,
      totalProcessed: failureDecision.totalProcessed,
    });
    metrics.addMetadata('taskFailureDestiny', failureDecision.shouldFail.toString());
    metrics.addMetadata('currentFailureRate', failureDecision.currentFailureRate.toString());
    metrics.addMetadata('targetFailureRate', processingConfig.failureRate.toString());

    try {
      const createTaskSegment = tracer.getSegment()?.addNewSubsegment('createTaskRecord');
      await dynamoService.createTask({
        taskId,
        payload,
        status: TaskStatus.PENDING,
        createdAt: now,
        retryCount: 0,
        failureDestiny: failureDecision.shouldFail,
      });
      createTaskSegment?.close();
      logger.info('Task record created in database', {
        ...context,
        taskId,
      });
      metrics.addMetric('TaskRecordCreated', 'Count', 1);
    } catch (error) {
      if ((error as Error).message.includes('already exists')) {
        logger.warn('Duplicate task submission', {
          ...context,
          taskId,
        });
        metrics.addMetric('DuplicateTask', 'Count', 1);
        return badRequestResponse(`Task with ID ${taskId} already exists`);
      }
      logger.error(
        'Failed to create task record',
        {
          ...context,
          taskId,
        },
        error as Error
      );
      metrics.addMetric('DatabaseError', 'Count', 1);
      throw error;
    }

    try {
      const sqsSegment = tracer.getSegment()?.addNewSubsegment('sendToSQS');
      const messageId = await sqsService.sendTaskMessage({
        taskId,
        payload,
        createdAt: now,
        retryCount: 0,
      });
      sqsSegment?.close();
      logger.info('Task queued for processing', {
        ...context,
        taskId,
        messageId,
      });
      const processingTime = Date.now() - startTime;
      metrics.addMetric('TaskSubmitted', 'Count', 1);
      metrics.addMetric('SubmissionLatency', 'Milliseconds', processingTime);
      metrics.addMetric('PayloadSize', 'Bytes', JSON.stringify(payload).length);
      const response: TaskSubmissionResponse = {
        success: true,
        data: {
          taskId,
          status: 'queued',
          message: 'Task successfully submitted for processing',
        },
        timestamp: new Date().toISOString(),
      };
      logger.apiResponseSent(201, {
        ...context,
        taskId,
        processingTimeMs: processingTime,
      });

      return createdResponse(response.data, 'Task submitted successfully');
    } catch (error) {
      try {
        const cleanupSegment = tracer.getSegment()?.addNewSubsegment('cleanupTaskRecord');
        await dynamoService.updateTaskStatus(taskId, TaskStatus.FAILED, {
          lastError: `Failed to queue task: ${(error as Error).message}`,
          failedAt: new Date().toISOString(),
        });
        cleanupSegment?.close();
      } catch (cleanupError) {
        logger.error(
          'Failed to cleanup task record after SQS failure',
          {
            ...context,
            taskId,
          },
          cleanupError as Error
        );
        metrics.addMetric('CleanupError', 'Count', 1);
      }
      logger.error(
        'Failed to queue task',
        {
          ...context,
          taskId,
        },
        error as Error
      );
      metrics.addMetric('QueueError', 'Count', 1);
      throw error;
    }
  } catch (error) {
    logger.error('Unhandled error in task submission', context, error as Error);
    const processingTime = Date.now() - startTime;
    metrics.addMetric('SubmissionError', 'Count', 1);
    metrics.addMetric('ErrorLatency', 'Milliseconds', processingTime);
    return handleError(error);
  }
};

const submitTaskHandler = baseSubmitTaskHandler;

export const handler: middy.MiddyfiedHandler<APIGatewayProxyEvent, APIGatewayProxyResult> = middy(
  submitTaskHandler
)
  .use(injectLambdaContext(powertoolsLoggerInstance, { logEvent: true }))
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }))
  .use(
    httpCors({
      origin: '*',
      headers:
        'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Correlation-ID,X-Idempotency-Key',
      methods: 'POST,OPTIONS',
    })
  )
  .use(httpJsonBodyParser())
  .use(requestValidation(SubmitTaskRequestDto))
  .use(customIdempotencyMiddleware)
  .use(responseValidation(TaskSubmissionResponseDto))
  .use(validationErrorHandler)
  .use(httpErrorHandler());
