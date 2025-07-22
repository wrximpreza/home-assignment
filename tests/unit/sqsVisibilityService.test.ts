import { SQSVisibilityService } from '@/services/sqsVisibilityService';
import { SQSClient } from '@aws-sdk/client-sqs';


jest.mock('@aws-sdk/client-sqs');


jest.mock('@/config', () => ({
  awsConfig: { region: 'us-east-1' },
  env: {
    TASK_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue',
  },
}));


jest.mock('@/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('SQSVisibilityService', () => {
  let service: SQSVisibilityService;
  let mockSend: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend = jest.fn();
    (SQSClient as jest.Mock).mockImplementation(() => ({
      send: mockSend,
    }));
    service = new SQSVisibilityService();
  });

  describe('getQueueAttributes', () => {
    it('should retrieve and cache queue attributes', async () => {
      const mockAttributes = {
        VisibilityTimeout: '180',
        MessageRetentionPeriod: '1209600',
      };

      mockSend.mockResolvedValue({
        Attributes: mockAttributes,
      });

      const result = await service.getQueueAttributes();

      expect(result).toEqual(mockAttributes);
      expect(mockSend).toHaveBeenCalledTimes(1);


      const result2 = await service.getQueueAttributes();
      expect(result2).toEqual(mockAttributes);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should handle errors when retrieving queue attributes', async () => {
      const error = new Error('Access denied');
      mockSend.mockRejectedValue(error);

      await expect(service.getQueueAttributes()).rejects.toThrow('Access denied');
    });
  });

  describe('calculateVisibilityTimeout', () => {
    beforeEach(() => {
      mockSend.mockResolvedValue({
        Attributes: {
          VisibilityTimeout: '180',
          MessageRetentionPeriod: '1209600',
        },
      });
    });

    it('should calculate visibility timeout for retry count 0', async () => {
      const timeout = await service.calculateVisibilityTimeout(0);
      expect(timeout).toBeGreaterThan(0);
      expect(timeout).toBeLessThanOrEqual(43200);
    });

    it('should calculate increasing timeout for higher retry counts', async () => {
      const timeout0 = await service.calculateVisibilityTimeout(0);
      const timeout1 = await service.calculateVisibilityTimeout(1);
      const timeout2 = await service.calculateVisibilityTimeout(2);

      expect(timeout1).toBeGreaterThan(timeout0);
      expect(timeout2).toBeGreaterThan(timeout1);
    });

    it('should respect maximum visibility timeout limit', async () => {
      const timeout = await service.calculateVisibilityTimeout(10);
      expect(timeout).toBeLessThanOrEqual(43200);
    });
  });

  describe('changeMessageVisibility', () => {
    beforeEach(() => {
      mockSend.mockResolvedValue({
        Attributes: { VisibilityTimeout: '180' },
      });
    });

    it('should change message visibility successfully', async () => {
      mockSend
        .mockResolvedValueOnce({ Attributes: { VisibilityTimeout: '180' } })
        .mockResolvedValueOnce({});

      const receiptHandle = 'test-receipt-handle-12345';
      await service.changeMessageVisibility(receiptHandle, 1);

      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should handle errors when changing visibility', async () => {
      mockSend
        .mockResolvedValueOnce({ Attributes: { VisibilityTimeout: '180' } })
        .mockRejectedValueOnce(new Error('Invalid receipt handle'));

      const receiptHandle = 'invalid-receipt-handle';
      await expect(service.changeMessageVisibility(receiptHandle, 1)).rejects.toThrow(
        'Invalid receipt handle'
      );
    });
  });

  describe('retryWithVisibilityTimeout', () => {
    beforeEach(() => {
      mockSend.mockResolvedValue({
        Attributes: { VisibilityTimeout: '180' },
      });
    });

    it('should return true for successful retry within max retries', async () => {
      mockSend
        .mockResolvedValueOnce({ Attributes: { VisibilityTimeout: '180' } })
        .mockResolvedValueOnce({});

      const result = await service.retryWithVisibilityTimeout('receipt-handle', 1, 3);
      expect(result).toBe(true);
    });

    it('should return false when max retries exceeded', async () => {
      const result = await service.retryWithVisibilityTimeout('receipt-handle', 3, 3);
      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      mockSend
        .mockResolvedValueOnce({ Attributes: { VisibilityTimeout: '180' } })
        .mockRejectedValueOnce(new Error('SQS error'));

      const result = await service.retryWithVisibilityTimeout('receipt-handle', 1, 3);
      expect(result).toBe(false);
    });
  });

  describe('getSQSRetryConfig', () => {
    it('should return SQS retry configuration', async () => {
      mockSend.mockResolvedValue({
        Attributes: {
          VisibilityTimeout: '300',
          MessageRetentionPeriod: '1209600',
        },
      });

      const config = await service.getSQSRetryConfig();

      expect(config).toEqual({
        visibilityTimeoutSeconds: 300,
        maxRetries: 3,
        useVisibilityTimeoutStrategy: true,
      });
    });
  });

  describe('resetMessageVisibility', () => {
    it('should reset message visibility to immediate', async () => {
      mockSend.mockResolvedValue({});

      await service.resetMessageVisibility('receipt-handle');

      expect(mockSend).toHaveBeenCalledTimes(1);

    });

    it('should handle errors when resetting visibility', async () => {
      mockSend.mockRejectedValue(new Error('SQS error'));

      await expect(service.resetMessageVisibility('receipt-handle')).rejects.toThrow('SQS error');
    });
  });
});
