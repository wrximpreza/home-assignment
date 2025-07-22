import { awsConfig, env } from '@/config';
import { SQSRetryConfig } from '@/types';
import { logger } from '@/utils/logger';
import { createRetryStrategy } from '@/utils/retryStrategy';
import {
  ChangeMessageVisibilityCommand,
  GetQueueAttributesCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

/**
 * Service for managing SQS message visibility timeout for retry strategies
 */
export class SQSVisibilityService {
  private readonly client: SQSClient;
  private queueAttributes: { [key: string]: string } | null = null;

  constructor() {
    this.client = new SQSClient(awsConfig);
  }

  /**
   * Get queue attributes including VisibilityTimeout
   */
  async getQueueAttributes(): Promise<{ [key: string]: string }> {
    if (this.queueAttributes) {
      return this.queueAttributes;
    }

    try {
      const command = new GetQueueAttributesCommand({
        QueueUrl: env.TASK_QUEUE_URL,
        AttributeNames: ['VisibilityTimeout', 'MessageRetentionPeriod'],
      });

      const response = await this.client.send(command);
      this.queueAttributes = response.Attributes || {};

      logger.info('Retrieved SQS queue attributes', {
        queueUrl: env.TASK_QUEUE_URL,
        attributes: this.queueAttributes,
      });

      return this.queueAttributes;
    } catch (error) {
      logger.error('Failed to get queue attributes', {
        error: error instanceof Error ? error.message : 'Unknown error',
        queueUrl: env.TASK_QUEUE_URL,
      });
      throw error;
    }
  }

  /**
   * Calculate optimal visibility timeout based on retry strategy
   */
  async calculateVisibilityTimeout(retryCount: number): Promise<number> {
    const attributes = await this.getQueueAttributes();
    const defaultVisibilityTimeout = parseInt(attributes.VisibilityTimeout || '180');

    const retryStrategy = createRetryStrategy({
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      jitterEnabled: true,
      strategy: 'exponential' as any,
      useVisibilityTimeout: true,
      visibilityTimeoutMultiplier: 1.2,
    });

    const delayMs = retryStrategy.calculateDelay(retryCount);
    const visibilityTimeoutSeconds = Math.ceil(delayMs / 1000);

    const maxVisibilityTimeout = 43200;
    const finalTimeout = Math.min(Math.max(visibilityTimeoutSeconds, 1), maxVisibilityTimeout);

    logger.debug('Calculated visibility timeout', {
      retryCount,
      delayMs,
      visibilityTimeoutSeconds,
      finalTimeout,
      defaultVisibilityTimeout,
    });

    return finalTimeout;
  }

  /**
   * Change message visibility timeout for retry coordination
   */
  async changeMessageVisibility(receiptHandle: string, retryCount: number): Promise<void> {
    try {
      const visibilityTimeout = await this.calculateVisibilityTimeout(retryCount);

      const command = new ChangeMessageVisibilityCommand({
        QueueUrl: env.TASK_QUEUE_URL,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: visibilityTimeout,
      });

      await this.client.send(command);

      logger.info('Changed message visibility timeout', {
        receiptHandle: receiptHandle.substring(0, 20) + '...',
        retryCount,
        visibilityTimeout,
        queueUrl: env.TASK_QUEUE_URL,
      });
    } catch (error) {
      logger.error('Failed to change message visibility', {
        error: error instanceof Error ? error.message : 'Unknown error',
        receiptHandle: receiptHandle.substring(0, 20) + '...',
        retryCount,
      });

      throw error;
    }
  }

  /**
   * Implement retry strategy using visibility timeout
   */
  async retryWithVisibilityTimeout(
    receiptHandle: string,
    retryCount: number,
    maxRetries: number = 3
  ): Promise<boolean> {
    if (retryCount >= maxRetries) {
      logger.warn('Maximum retries exceeded, message will go to DLQ', {
        retryCount,
        maxRetries,
        receiptHandle: receiptHandle.substring(0, 20) + '...',
      });
      return false;
    }

    try {
      await this.changeMessageVisibility(receiptHandle, retryCount);

      logger.info('Message scheduled for retry using visibility timeout', {
        retryCount,
        maxRetries,
        receiptHandle: receiptHandle.substring(0, 20) + '...',
      });

      return true;
    } catch (error) {
      logger.error('Failed to schedule retry with visibility timeout', {
        error: error instanceof Error ? error.message : 'Unknown error',
        retryCount,
        receiptHandle: receiptHandle.substring(0, 20) + '...',
      });
      return false;
    }
  }

  /**
   * Get SQS retry configuration based on queue attributes
   */
  async getSQSRetryConfig(): Promise<SQSRetryConfig> {
    const attributes = await this.getQueueAttributes();

    return {
      visibilityTimeoutSeconds: parseInt(attributes.VisibilityTimeout || '180'),
      maxRetries: 3,
      useVisibilityTimeoutStrategy: true,
    };
  }

  /**
   * Reset message visibility (make it immediately available)
   */
  async resetMessageVisibility(receiptHandle: string): Promise<void> {
    try {
      const command = new ChangeMessageVisibilityCommand({
        QueueUrl: env.TASK_QUEUE_URL,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: 0,
      });

      await this.client.send(command);

      logger.info('Reset message visibility to immediate', {
        receiptHandle: receiptHandle.substring(0, 20) + '...',
      });
    } catch (error) {
      logger.error('Failed to reset message visibility', {
        error: error instanceof Error ? error.message : 'Unknown error',
        receiptHandle: receiptHandle.substring(0, 20) + '...',
      });
      throw error;
    }
  }
}
