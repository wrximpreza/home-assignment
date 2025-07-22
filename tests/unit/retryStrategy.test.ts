import { RetryStrategy, createRetryStrategy, calculateExponentialBackoff } from '@/utils/retryStrategy';
import { RetryConfig, RetryStrategyType } from '@/types';
import { BackoffStrategyFactory } from '@/utils/backoffStrategies';

describe('RetryStrategy', () => {
  let retryStrategy: RetryStrategy;
  
  const defaultConfig: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitterEnabled: false,
    strategy: RetryStrategyType.EXPONENTIAL,
  };

  beforeEach(() => {
    retryStrategy = new RetryStrategy(defaultConfig);
  });

  describe('calculateDelay', () => {
    it('should calculate exponential backoff correctly', () => {
      const delay0 = retryStrategy.calculateDelay(0);
      const delay1 = retryStrategy.calculateDelay(1);
      const delay2 = retryStrategy.calculateDelay(2);

      expect(delay0).toBe(1000);
      expect(delay1).toBe(2000);
      expect(delay2).toBe(4000);
    });

    it('should respect maximum delay', () => {
      const configWithLowMax: RetryConfig = {
        ...defaultConfig,
        maxDelayMs: 3000,
      };
      const strategy = new RetryStrategy(configWithLowMax);

      const delay3 = strategy.calculateDelay(3);
      expect(delay3).toBe(3000);
    });





    it('should apply jitter when enabled', () => {
      const jitterConfig: RetryConfig = {
        ...defaultConfig,
        jitterEnabled: true,
        jitterMaxMs: 500,
      };
      const strategy = new RetryStrategy(jitterConfig);

      const delay1 = strategy.calculateDelay(0);
      const delay2 = strategy.calculateDelay(0);



      expect(delay1).toBeGreaterThanOrEqual(1000);
      expect(delay1).toBeLessThanOrEqual(1500);
      expect(delay2).toBeGreaterThanOrEqual(1000);
      expect(delay2).toBeLessThanOrEqual(1500);
    });

    it('should always use exponential strategy regardless of error type', () => {
      const strategy = new RetryStrategy(defaultConfig);


      const throttleDelay = strategy.calculateDelay(1, 'throttling error');
      expect(throttleDelay).toBe(2000);

      const networkDelay = strategy.calculateDelay(1, 'network timeout');
      expect(networkDelay).toBe(2000);

      const connectionDelay = strategy.calculateDelay(1, 'connection unavailable');
      expect(connectionDelay).toBe(2000);


      const noErrorDelay = strategy.calculateDelay(1);
      expect(noErrorDelay).toBe(2000);
    });
  });

  describe('shouldRetry', () => {
    it('should return true when retry count is below maximum', () => {
      expect(retryStrategy.shouldRetry(0)).toBe(true);
      expect(retryStrategy.shouldRetry(1)).toBe(true);
      expect(retryStrategy.shouldRetry(2)).toBe(true);
    });

    it('should return false when retry count reaches maximum', () => {
      expect(retryStrategy.shouldRetry(3)).toBe(false);
      expect(retryStrategy.shouldRetry(4)).toBe(false);
    });

    it('should return false for validation errors', () => {
      const validationError = new Error('validation failed');
      expect(retryStrategy.shouldRetry(0, validationError)).toBe(false);
    });

    it('should return false for authorization errors', () => {
      const authError = new Error('unauthorized access');
      expect(retryStrategy.shouldRetry(0, authError)).toBe(false);
    });

    it('should return true for retryable errors', () => {
      const networkError = new Error('network timeout');
      expect(retryStrategy.shouldRetry(0, networkError)).toBe(true);
    });
  });

  describe('executeWithRetry', () => {
    it('should succeed on first attempt', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      
      const result = await retryStrategy.executeWithRetry(mockOperation);
      
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const mockOperation = jest.fn()
        .mockRejectedValueOnce(new Error('temporary failure'))
        .mockResolvedValue('success');
      
      const result = await retryStrategy.executeWithRetry(mockOperation);
      
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it('should fail after exhausting all retries', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('persistent failure'));

      await expect(retryStrategy.executeWithRetry(mockOperation)).rejects.toThrow('persistent failure');
      expect(mockOperation).toHaveBeenCalledTimes(4);
    }, 10000);

    it('should not retry validation errors', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('validation failed'));
      
      await expect(retryStrategy.executeWithRetry(mockOperation)).rejects.toThrow('validation failed');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });
  });

  describe('getMetrics', () => {
    it('should return correct metrics after attempts', () => {
      retryStrategy.calculateDelay(0);
      retryStrategy.calculateDelay(1);
      retryStrategy.calculateDelay(2);

      const metrics = retryStrategy.getMetrics();

      expect(metrics.totalAttempts).toBe(3);
      expect(metrics.strategy).toBe('exponential');
      expect(metrics.jitterApplied).toBe(false);
      expect(metrics.averageDelayMs).toBe((1000 + 2000 + 4000) / 3);
    });
  });


});

describe('createRetryStrategy', () => {
  it('should create strategy with default config', () => {
    const strategy = createRetryStrategy();
    expect(strategy).toBeInstanceOf(RetryStrategy);
  });

  it('should create strategy with custom config', () => {
    const customConfig = {
      maxRetries: 5,
      baseDelayMs: 2000,
    };
    const strategy = createRetryStrategy(customConfig);
    expect(strategy).toBeInstanceOf(RetryStrategy);
  });
});

describe('calculateExponentialBackoff', () => {
  it('should calculate exponential backoff with default parameters', () => {
    const delay0 = calculateExponentialBackoff(0);
    const delay1 = calculateExponentialBackoff(1);


    expect(delay0).toBeGreaterThanOrEqual(1000);
    expect(delay0).toBeLessThanOrEqual(1500);
    expect(delay1).toBeGreaterThanOrEqual(2000);
    expect(delay1).toBeLessThanOrEqual(2500);
  });

  it('should calculate exponential backoff with custom parameters', () => {
    const delay = calculateExponentialBackoff(1, 500, 10000, 3, false);
    expect(delay).toBe(1500);
  });
});

describe('RetryStrategy static methods', () => {
  it('should return available strategies', () => {
    const strategies = RetryStrategy.getAvailableStrategies();
    expect(strategies).toContain(RetryStrategyType.EXPONENTIAL);
    expect(strategies).toHaveLength(1);
  });

  it('should check if strategy is supported', () => {
    expect(RetryStrategy.isStrategySupported(RetryStrategyType.EXPONENTIAL)).toBe(true);
  });
});

describe('BackoffStrategyFactory', () => {
  it('should get strategy by type', () => {
    const exponentialStrategy = BackoffStrategyFactory.getStrategy(RetryStrategyType.EXPONENTIAL);
    expect(exponentialStrategy.getName()).toBe(RetryStrategyType.EXPONENTIAL);
  });

  it('should throw error for unknown strategy', () => {
    expect(() => {
      BackoffStrategyFactory.getStrategy('unknown' as RetryStrategyType);
    }).toThrow('Unknown retry strategy: unknown');
  });
});
