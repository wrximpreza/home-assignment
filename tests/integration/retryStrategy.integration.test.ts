import { SQSService } from '@/services/sqsService';
import { createRetryStrategy } from '@/utils/retryStrategy';
import { TaskPayload, RetryStrategyType } from '@/types';


jest.mock('@/config', () => ({
  env: {
    STAGE: 'test',
    REGION: 'us-east-1',
    TASK_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue',
    TASK_DLQ_URL: 'https://sqs.us-east-1.amazonaws.com/123456789/test-dlq',
    TASK_TABLE_NAME: 'test-table',
  },
  featureFlags: {
    enableDetailedLogging: false,
  },
  retryConfig: {
    maxRetries: 2,
    baseDelayMs: 500,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    jitterEnabled: true,
    strategy: 'exponential',
  },
}));


const mockSend = jest.fn();
jest.mock('@aws-sdk/client-sqs', () => {
  const mockSend = jest.fn();
  return {
    SQSClient: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    SendMessageCommand: jest.fn(),
    __mockSend: mockSend,
  };
});

describe('SQS Service Retry Strategy Integration', () => {
  let sqsService: SQSService;
  let mockSend: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    sqsService = new SQSService();


    const sqsModule = require('@aws-sdk/client-sqs');
    mockSend = sqsModule.__mockSend;
  });

  describe('sendTaskMessageWithRetry', () => {
    const testPayload: TaskPayload = {
      taskId: 'test-task-123',
      payload: { test: 'data' },
      createdAt: new Date().toISOString(),
      retryCount: 0,
    };

    it('should succeed on first attempt', async () => {
      mockSend.mockResolvedValue({ MessageId: 'msg-123' });

      const result = await sqsService.sendTaskMessageWithRetry(testPayload);

      expect(result).toBe('msg-123');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('Temporary SQS failure'))
        .mockRejectedValueOnce(new Error('Another temporary failure'))
        .mockResolvedValue({ MessageId: 'msg-456' });

      const result = await sqsService.sendTaskMessageWithRetry(testPayload, 3);

      expect(result).toBe('msg-456');
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('should fail after exhausting all retries', async () => {
      mockSend.mockRejectedValue(new Error('Persistent SQS failure'));

      await expect(sqsService.sendTaskMessageWithRetry(testPayload, 2))
        .rejects.toThrow('Persistent SQS failure');
      
      expect(mockSend).toHaveBeenCalledTimes(3);
    });
  });

  describe('sendTaskMessageWithAdvancedRetry', () => {
    const testPayload: TaskPayload = {
      taskId: 'test-task-advanced-123',
      payload: { test: 'advanced data' },
      createdAt: new Date().toISOString(),
      retryCount: 0,
    };

    it('should use exponential backoff strategy', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValue({ MessageId: 'msg-exponential' });

      const result = await sqsService.sendTaskMessageWithAdvancedRetry(testPayload, {
        strategy: RetryStrategyType.EXPONENTIAL,
        maxRetries: 2,
        baseDelayMs: 100,
      });

      expect(result).toBe('msg-exponential');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should use exponential backoff with VisibilityTimeout strategy', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValue({ MessageId: 'msg-visibility-timeout' });

      const result = await sqsService.sendTaskMessageWithAdvancedRetry(testPayload, {
        strategy: RetryStrategyType.EXPONENTIAL,
        maxRetries: 2,
        baseDelayMs: 100,
        useVisibilityTimeout: true,
        visibilityTimeoutMultiplier: 1.5,
      });

      expect(result).toBe('msg-visibility-timeout');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should send message with VisibilityTimeout strategy', async () => {
      mockSend.mockResolvedValue({ MessageId: 'msg-visibility-strategy' });

      const result = await sqsService.sendTaskMessageWithVisibilityTimeout(testPayload, {
        maxRetries: 3,
        baseDelayMs: 500,
        backoffMultiplier: 2,
      });

      expect(result).toBe('msg-visibility-strategy');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });





    it('should respect jitter configuration', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValue({ MessageId: 'msg-jitter' });

      const result = await sqsService.sendTaskMessageWithAdvancedRetry(testPayload, {
        strategy: RetryStrategyType.EXPONENTIAL,
        maxRetries: 2,
        baseDelayMs: 100,
        jitterEnabled: true,
      });

      expect(result).toBe('msg-jitter');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });
});

describe('Retry Strategy Standalone Integration', () => {
  it('should handle real-world retry scenarios', async () => {
    const retryStrategy = createRetryStrategy({
      maxRetries: 3,
      baseDelayMs: 50,
      maxDelayMs: 1000,
      backoffMultiplier: 2,
      jitterEnabled: false,
      strategy: RetryStrategyType.EXPONENTIAL,
    });

    let attemptCount = 0;
    const mockOperation = jest.fn().mockImplementation(() => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new Error(`Attempt ${attemptCount} failed`);
      }
      return Promise.resolve(`Success on attempt ${attemptCount}`);
    });

    const result = await retryStrategy.executeWithRetry(mockOperation, {
      taskId: 'integration-test-task',
      operationType: 'TEST_OPERATION',
    });

    expect(result).toBe('Success on attempt 3');
    expect(mockOperation).toHaveBeenCalledTimes(3);

    const metrics = retryStrategy.getMetrics();
    expect(metrics.totalAttempts).toBe(2);
    expect(metrics.strategy).toBe(RetryStrategyType.EXPONENTIAL);
  });

  it('should handle different error types appropriately', async () => {
    const retryStrategy = createRetryStrategy({
      maxRetries: 3,
      baseDelayMs: 50,
      strategy: RetryStrategyType.EXPONENTIAL,
    });


    const validationOperation = jest.fn().mockRejectedValue(new Error('validation failed'));
    
    await expect(retryStrategy.executeWithRetry(validationOperation))
      .rejects.toThrow('validation failed');
    expect(validationOperation).toHaveBeenCalledTimes(1);


    retryStrategy.reset();


    const networkOperation = jest.fn()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValue('network success');
    
    const result = await retryStrategy.executeWithRetry(networkOperation);
    expect(result).toBe('network success');
    expect(networkOperation).toHaveBeenCalledTimes(2);
  });

  it('should calculate exponential backoff delays correctly', () => {
    const exponentialStrategy = createRetryStrategy({
      baseDelayMs: 1000,
      backoffMultiplier: 2,
      strategy: RetryStrategyType.EXPONENTIAL,
      jitterEnabled: false,
      maxDelayMs: 30000,
      maxRetries: 3,
      jitterMaxMs: 0,
    });


    expect(exponentialStrategy.calculateDelay(0)).toBe(1000);
    expect(exponentialStrategy.calculateDelay(1)).toBe(2000);
    expect(exponentialStrategy.calculateDelay(2)).toBe(4000);
  });
});
