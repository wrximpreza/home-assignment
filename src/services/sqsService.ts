import {
  GetQueueAttributesCommand,
  SQSClient,
  SendMessageCommand,
  SendMessageCommandInput,
} from '@aws-sdk/client-sqs';

import { awsConfig, calculateBackoffDelay, env } from '@/config';
import { SQSVisibilityService } from '@/services/sqsVisibilityService';
import { RetryStrategyType, TaskMessage, TaskPayload } from '@/types';
import { logger } from '@/utils/logger';
import { createRetryStrategy } from '@/utils/retryStrategy';

export class SQSService {
  private readonly client: SQSClient;
  private readonly visibilityService: SQSVisibilityService;

  constructor() {
    this.client = new SQSClient(awsConfig);
    this.visibilityService = new SQSVisibilityService();
  }

  async sendTaskMessage(taskPayload: TaskPayload): Promise<string> {
    const message: TaskMessage = {
      taskId: taskPayload.taskId,
      payload: taskPayload.payload,
      retryCount: taskPayload.retryCount || 0,
      createdAt: taskPayload.createdAt,
      lastError: taskPayload.lastError,
    };
    const messageBody = JSON.stringify(message);

    if (
      env.STAGE === 'dev' &&
      (env.TASK_QUEUE_URL.includes('localhost') ||
        env.TASK_QUEUE_URL === 'http://localhost:9324/queue/TaskQueue')
    ) {
      logger.info('Local development mode - simulating SQS message send', {
        taskId: taskPayload.taskId,
        queueUrl: env.TASK_QUEUE_URL,
        messageBody: message,
        retryCount: taskPayload.retryCount || 0,
      });
      return 'local-dev-message-id-' + Date.now();
    }

    const params: SendMessageCommandInput = {
      QueueUrl: env.TASK_QUEUE_URL,
      MessageBody: messageBody,
      MessageAttributes: {
        TaskId: {
          DataType: 'String',
          StringValue: taskPayload.taskId,
        },
        RetryCount: {
          DataType: 'Number',
          StringValue: (taskPayload.retryCount || 0).toString(),
        },
        CreatedAt: {
          DataType: 'String',
          StringValue: taskPayload.createdAt,
        },
      },
    };

    if (taskPayload.retryCount && taskPayload.retryCount > 0) {
      const delaySeconds = Math.floor(calculateBackoffDelay(taskPayload.retryCount) / 1000);
      params.DelaySeconds = Math.min(delaySeconds, 900);
      logger.info('Scheduling retry with delay', {
        taskId: taskPayload.taskId,
        retryCount: taskPayload.retryCount,
        delaySeconds,
      });
    }

    try {
      const command = new SendMessageCommand(params);
      const result = await this.client.send(command);

      logger.info('Task message sent to queue', {
        taskId: taskPayload.taskId,
        messageId: result.MessageId,
        retryCount: taskPayload.retryCount || 0,
      });

      return result.MessageId || '';
    } catch (error) {
      logger.error(
        'Failed to send task message to queue',
        {
          taskId: taskPayload.taskId,
          queueUrl: env.TASK_QUEUE_URL,
        },
        error as Error
      );
      throw new Error(`Failed to send task to queue: ${(error as Error).message}`);
    }
  }

  async sendTaskMessageWithRetry(
    taskPayload: TaskPayload,
    maxRetries: number = 3
  ): Promise<string> {
    const operationRetryStrategy = createRetryStrategy({
      maxRetries,
      baseDelayMs: 1000,
      maxDelayMs: 15000,
      backoffMultiplier: 2,
      jitterEnabled: true,
      strategy: RetryStrategyType.EXPONENTIAL,
    });

    return operationRetryStrategy.executeWithRetry(() => this.sendTaskMessage(taskPayload), {
      taskId: taskPayload.taskId,
      operationType: 'SQS_SEND_MESSAGE',
    });
  }

  /**
   * Enhanced retry method with configurable backoff strategies
   */
  async sendTaskMessageWithAdvancedRetry(
    taskPayload: TaskPayload,
    retryConfig?: {
      maxRetries?: number;
      strategy?: RetryStrategyType;
      baseDelayMs?: number;
      maxDelayMs?: number;
      jitterEnabled?: boolean;
      backoffMultiplier?: number;
      useVisibilityTimeout?: boolean;
      visibilityTimeoutMultiplier?: number;
    }
  ): Promise<string> {
    const config = {
      maxRetries: 3,
      strategy: RetryStrategyType.EXPONENTIAL,
      baseDelayMs: 1000,
      maxDelayMs: 15000,
      jitterEnabled: true,
      jitterMaxMs: 500,
      backoffMultiplier: 2,
      useVisibilityTimeout: false,
      visibilityTimeoutMultiplier: 1.2,
      ...retryConfig,
    };

    const operationRetryStrategy = createRetryStrategy(config);

    return operationRetryStrategy.executeWithRetry(() => this.sendTaskMessage(taskPayload), {
      taskId: taskPayload.taskId,
      operationType: 'SQS_SEND_MESSAGE_ADVANCED',
    });
  }

  async getQueueAttributes(queueUrl: string): Promise<Record<string, string>> {
    try {
      const command = new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['All'],
      });
      const result = await this.client.send(command);

      return result.Attributes || {};
    } catch (error) {
      logger.error(
        'Failed to get queue attributes',
        {
          queueUrl,
        },
        error as Error
      );
      return {};
    }
  }

  async getMainQueueDepth(): Promise<number> {
    const attributes = await this.getQueueAttributes(env.TASK_QUEUE_URL);
    const messageCount = attributes.ApproximateNumberOfMessages || '0';
    return parseInt(messageCount, 10);
  }

  async getDLQDepth(): Promise<number> {
    const attributes = await this.getQueueAttributes(env.TASK_DLQ_URL);
    const messageCount = attributes.ApproximateNumberOfMessages || '0';
    return parseInt(messageCount, 10);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.getQueueAttributes(env.TASK_QUEUE_URL);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send task message with VisibilityTimeout-based retry strategy
   */
  async sendTaskMessageWithVisibilityTimeout(
    taskPayload: TaskPayload,
    options?: {
      maxRetries?: number;
      baseDelayMs?: number;
      backoffMultiplier?: number;
    }
  ): Promise<string> {
    const config = {
      maxRetries: 3,
      baseDelayMs: 1000,
      backoffMultiplier: 2,
      ...options,
    };

    logger.info('Sending task message with VisibilityTimeout strategy', {
      taskId: taskPayload.taskId,
      retryCount: taskPayload.retryCount || 0,
      config,
    });

    return this.sendTaskMessageWithAdvancedRetry(taskPayload, {
      ...config,
      strategy: RetryStrategyType.EXPONENTIAL,
      useVisibilityTimeout: true,
      visibilityTimeoutMultiplier: 1.2,
      jitterEnabled: true,
      maxDelayMs: 30000,
    });
  }

  /**
   * Get SQS retry configuration for VisibilityTimeout strategy
   */
  async getSQSRetryConfig() {
    return this.visibilityService.getSQSRetryConfig();
  }

  /**
   * Change message visibility timeout for retry coordination
   */
  async changeMessageVisibility(receiptHandle: string, retryCount: number): Promise<void> {
    return this.visibilityService.changeMessageVisibility(receiptHandle, retryCount);
  }

  /**
   * Retry message using VisibilityTimeout strategy
   */
  async retryWithVisibilityTimeout(
    receiptHandle: string,
    retryCount: number,
    maxRetries: number = 3
  ): Promise<boolean> {
    return this.visibilityService.retryWithVisibilityTimeout(receiptHandle, retryCount, maxRetries);
  }

  /**
   * Reset message visibility (make it immediately available)
   */
  async resetMessageVisibility(receiptHandle: string): Promise<void> {
    return this.visibilityService.resetMessageVisibility(receiptHandle);
  }
}

export const sqsService = new SQSService();
