import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import middy from '@middy/core';
import { SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';

import {
  calculateBackoffDelay,
  isRetryable,
  processingConfig,
  retryConfig,
  validateEnvironment,
} from '@/config';
import { dynamoService } from '@/services/dynamoService';
import {
  NonRetryableError,
  ProcessTaskHandler,
  RetryableError,
  TaskMessage,
  TaskStatus,
} from '@/types';
import {
  createTaskContext,
  logger,
  metrics,
  powertoolsLoggerInstance,
  tracer,
} from '@/utils/logger';

async function simulateTaskProcessing(
  taskId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const segment = tracer.getSegment();
  const subsegment = segment?.addNewSubsegment('simulateTaskProcessing');

  const startTime = Date.now();
  logger.info('Starting task processing simulation', {
    taskId,
    payloadKeys: Object.keys(payload),
  });
  metrics.addMetadata('taskId', taskId);
  metrics.addMetadata('payloadSize', JSON.stringify(payload).length.toString());

  try {
    await new Promise(resolve => setTimeout(resolve, processingConfig.processingTimeMs));
    const shouldFail = await dynamoService.isTaskDestinedToFail(taskId);

    metrics.addMetadata('shouldFail', shouldFail.toString());
    metrics.addMetadata('targetFailureRate', processingConfig.failureRate.toString());
    metrics.addMetadata('failureMethod', 'destiny-based');
    metrics.addMetadata('note', 'Failure destiny determined at task creation');

    logger.info('Task failure destiny check', {
      taskId,
      shouldFail,
      targetFailureRate: Math.round(processingConfig.failureRate * 1000) / 10,
      method: 'destiny-based',
      note: 'Failure destiny was determined when task was created and applies to all retry attempts',
    });

    if (shouldFail) {
      const errorTypes = [
        { type: 'NetworkTimeoutError', retryable: true },
        { type: 'ServiceUnavailableError', retryable: true },
        { type: 'ProcessingError', retryable: true },
        { type: 'ValidationError', retryable: false },
        { type: 'ResourceNotFoundError', retryable: false },
      ];

      let selectedError: { type: string; retryable: boolean };
      let errorIndex = -1;

      // Special handling for force-fail tasks
      if (taskId.includes('force-fail-retry')) {
        selectedError = { type: 'ServiceUnavailableError', retryable: true };
        errorIndex = 1;
        logger.info('Force-fail-retry task assigned retryable error', {
          taskId,
          errorType: selectedError.type,
        });
      } else {
        // Use simple hash to determine error type consistently
        let hash = 5381;
        for (let i = 0; i < taskId.length; i++) {
          hash = (hash << 5) + hash + taskId.charCodeAt(i);
        }
        errorIndex = Math.abs(hash) % errorTypes.length;
        selectedError = errorTypes[errorIndex];
      }

      const errorMessage = `Simulated ${selectedError.type} during task processing (DynamoDB-controlled failure)`;
      metrics.addMetadata('errorType', selectedError.type);
      metrics.addMetadata('isRetryable', selectedError.retryable.toString());
      metrics.addMetadata('errorIndex', errorIndex.toString());
      logger.warn('Simulating task failure (task destined to always fail)', {
        taskId,
        errorType: selectedError.type,
        isRetryable: selectedError.retryable,
        targetFailureRate: processingConfig.failureRate,
        errorIndex,
        note: 'This task was marked to fail when created and will fail on every retry',
      });

      if (selectedError.retryable) {
        throw new RetryableError(errorMessage, taskId);
      } else {
        throw new NonRetryableError(errorMessage, taskId);
      }
    }

    const processingTime = Date.now() - startTime;
    logger.info('Task processing completed successfully', {
      taskId,
      processingTimeMs: processingTime,
      note: 'Task was not destined to fail, completed successfully',
    });
    metrics.addMetric('TaskProcessingSuccess', 'Count', 1);
    metrics.addMetric('ProcessingDuration', 'Milliseconds', processingTime);
    subsegment?.close();
  } catch (error) {
    const processingTime = Date.now() - startTime;
    metrics.addMetric('TaskProcessingFailure', 'Count', 1);
    metrics.addMetric('FailedProcessingDuration', 'Milliseconds', processingTime);
    subsegment?.addError(error as Error);
    subsegment?.close();
    throw error;
  }
}

async function processTaskMessage(
  record: SQSRecord
): Promise<{ success: boolean; messageId: string; error?: Error }> {
  const segment = tracer.getSegment();
  const subsegment = segment?.addNewSubsegment('processTaskMessage');
  let taskMessage: TaskMessage;
  try {
    taskMessage = JSON.parse(record.body);
  } catch (error) {
    logger.error(
      'Failed to parse SQS message body',
      {
        messageId: record.messageId,
      },
      error as Error
    );
    metrics.addMetric('MessageParseError', 'Count', 1);
    subsegment?.addError(error as Error);
    subsegment?.close();
    return {
      success: false,
      messageId: record.messageId,
      error: new NonRetryableError('Invalid message format'),
    };
  }
  const { taskId, payload } = taskMessage;

  const approximateReceiveCount = record.attributes?.ApproximateReceiveCount || '1';
  const actualRetryCount = parseInt(approximateReceiveCount, 10) - 1;

  logger.info('SQS retry count information', {
    taskId,
    messageId: record.messageId,
    approximateReceiveCount,
    actualRetryCount,
    allAttributes: record.attributes,
  });

  const context = createTaskContext(taskId);
  logger.addContext({ taskId, retryCount: actualRetryCount });
  metrics.addMetadata('taskId', taskId);
  metrics.addMetadata('retryCount', actualRetryCount.toString());
  logger.taskStarted(taskId, {
    ...context,
    retryCount: actualRetryCount,
    messageId: record.messageId,
  });

  try {
    const updateStatusSegment = subsegment?.addNewSubsegment('updateTaskStatusProcessing');
    await dynamoService.updateTaskStatus(taskId, TaskStatus.PROCESSING, {
      retryCount: actualRetryCount,
    });
    updateStatusSegment?.close();
    const processingSegment = subsegment?.addNewSubsegment('taskProcessing');
    await simulateTaskProcessing(taskId, payload);
    processingSegment?.close();
    const completeSegment = subsegment?.addNewSubsegment('updateTaskStatusCompleted');
    await dynamoService.updateTaskStatus(taskId, TaskStatus.COMPLETED, {
      completedAt: new Date().toISOString(),
      retryCount: actualRetryCount,
    });
    completeSegment?.close();
    logger.taskCompleted(taskId, processingConfig.processingTimeMs, context);
    metrics.addMetric('TaskCompleted', 'Count', 1);
    subsegment?.close();
    return { success: true, messageId: record.messageId };
  } catch (error) {
    const processingError = error as Error;
    const isRetryableFailure =
      error instanceof RetryableError ||
      (!(error instanceof NonRetryableError) && isRetryable(actualRetryCount));
    logger.taskFailed(taskId, processingError, context);
    metrics.addMetric('TaskFailed', 'Count', 1);
    metrics.addMetadata('errorName', processingError.name);
    metrics.addMetadata('isRetryable', isRetryableFailure.toString());
    if (isRetryableFailure) {
      const nextRetryDelay = calculateBackoffDelay(actualRetryCount + 1);
      const baseDelay =
        retryConfig.baseDelayMs * Math.pow(retryConfig.backoffMultiplier, actualRetryCount + 1);
      const jitterAmount = retryConfig.jitterEnabled
        ? Math.random() * (retryConfig.jitterMaxMs ?? 500)
        : 0;

      logger.info('Task failed but is retryable, will be retried by SQS', {
        taskId,
        retryCount: actualRetryCount,
        maxRetries: retryConfig.maxRetries,
        errorMessage: processingError.message,
        nextRetryDelay,
        retryStrategy: retryConfig.strategy,
        jitterEnabled: retryConfig.jitterEnabled,
        baseDelay,
        jitterAmount,
        backoffMultiplier: retryConfig.backoffMultiplier,
      });

      metrics.addMetric('TaskRetryScheduled', 'Count', 1);
      metrics.addMetric('RetryDelay', 'Milliseconds', nextRetryDelay);
      metrics.addMetadata('retryCount', actualRetryCount.toString());
      metrics.addMetadata('retryStrategy', retryConfig.strategy);

      subsegment?.addError(processingError);
      subsegment?.close();
      return { success: false, messageId: record.messageId, error: processingError };
    } else {
      const failedUpdateSegment = subsegment?.addNewSubsegment('updateTaskStatusFailed');
      await dynamoService.updateTaskStatus(taskId, TaskStatus.FAILED, {
        lastError: processingError.message,
        failedAt: new Date().toISOString(),
        retryCount: actualRetryCount,
      });
      failedUpdateSegment?.close();
      logger.taskSentToDLQ(taskId, processingError, context);
      metrics.addMetric('TaskSentToDLQ', 'Count', 1);
      subsegment?.addError(processingError);
      subsegment?.close();
      return { success: false, messageId: record.messageId, error: processingError };
    }
  }
}

const processTaskHandler: ProcessTaskHandler = async (
  event: SQSEvent
): Promise<SQSBatchResponse> => {
  logger.info('Processing SQS batch', {
    recordCount: event.Records.length,
    functionName: process.env['AWS_LAMBDA_FUNCTION_NAME'] || 'processTask',
  });
  metrics.addMetadata('batchSize', event.Records.length.toString());
  validateEnvironment();
  const results = await Promise.allSettled(event.Records.map(record => processTaskMessage(record)));
  const batchItemFailures: SQSBatchItemFailure[] = [];
  let successful = 0;
  let failed = 0;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      if (result.value.success) {
        successful++;
      } else {
        failed++;
        batchItemFailures.push({
          itemIdentifier: result.value.messageId,
        });
      }
    } else {
      failed++;
      batchItemFailures.push({
        itemIdentifier: event.Records[index]?.messageId || `unknown-${index}`,
      });
    }
  });
  logger.info('SQS batch processing completed', {
    totalRecords: event.Records.length,
    successful,
    failed,
    partialFailures: batchItemFailures.length,
  });
  metrics.addMetric('BatchProcessed', 'Count', 1);
  metrics.addMetric('BatchSuccessful', 'Count', successful);
  metrics.addMetric('BatchFailed', 'Count', failed);
  metrics.addMetric('BatchSuccessRate', 'Percent', (successful / event.Records.length) * 100);
  if (batchItemFailures.length > 0) {
    logger.warn('Some records failed processing - using partial batch failure', {
      failedCount: batchItemFailures.length,
      failedMessageIds: batchItemFailures.map(failure => failure.itemIdentifier),
    });
    metrics.addMetric('PartialBatchFailure', 'Count', 1);
  }
  return {
    batchItemFailures,
  };
};

export const handler = middy(processTaskHandler)
  .use(injectLambdaContext(powertoolsLoggerInstance, { logEvent: true }))
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }));
