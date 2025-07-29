import { retryConfig as defaultRetryConfig } from '@/config';
import {
  IBackoffStrategy,
  RetryAttempt,
  RetryConfig,
  RetryMetrics,
  RetryStrategyType,
} from '@/types';
import { BackoffStrategyFactory } from '@/utils/backoffStrategies';
import { logger } from '@/utils/logger';

/**
 * Enhanced retry strategy utility with multiple backoff algorithms
 * and comprehensive retry management capabilities
 */
export class RetryStrategy {
  private attempts: RetryAttempt[] = [];
  private config: RetryConfig;

  constructor(config: RetryConfig = defaultRetryConfig) {
    this.config = config;
  }

  /**
   * Calculate delay for the next retry attempt using configured strategy
   * @param retryCount Current retry count (0-based)
   * @param errorType Optional error type for strategy selection
   * @returns Delay in milliseconds
   */
  calculateDelay(retryCount: number, _errorType?: string): number {
    const strategy = this.selectStrategy(_errorType);
    const backoffStrategy = BackoffStrategyFactory.getStrategy(strategy);
    const baseDelay = backoffStrategy.calculateDelay(retryCount, this.config);

    const finalDelay = this.applyJitter(baseDelay);

    this.recordAttempt(retryCount, finalDelay);

    logger.debug('Retry delay calculated', {
      retryCount,
      strategy,
      baseDelay,
      finalDelay,
      jitterEnabled: this.config.jitterEnabled,
      errorType: _errorType,
    });

    return finalDelay;
  }

  /**
   * Select retry strategy - always returns exponential backoff
   * @param errorType Optional error type (ignored, kept for compatibility)
   * @returns Always returns exponential strategy type
   */
  private selectStrategy(_errorType?: string): RetryStrategyType {
    return RetryStrategyType.EXPONENTIAL;
  }

  /**
   * Apply jitter to prevent thundering herd problem
   */
  private applyJitter(baseDelay: number): number {
    if (!this.config.jitterEnabled) {
      return baseDelay;
    }

    const jitterMaxMs = this.config.jitterMaxMs ?? 500;
    const jitter = Math.random() * jitterMaxMs;
    return Math.min(baseDelay + jitter, this.config.maxDelayMs);
  }

  /**
   * Record a retry attempt for metrics
   */
  private recordAttempt(attemptNumber: number, delayMs: number, error?: string): void {
    this.attempts.push({
      attemptNumber,
      delayMs,
      timestamp: new Date().toISOString(),
      error,
    });
  }

  /**
   * Check if retry should be attempted
   */
  shouldRetry(retryCount: number, error?: Error): boolean {
    if (retryCount >= this.config.maxRetries) {
      return false;
    }

    if (error) {
      if (error.message.includes('validation') || error.message.includes('invalid')) {
        return false;
      }

      if (error.message.includes('unauthorized') || error.message.includes('forbidden')) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get retry metrics for monitoring
   */
  getMetrics(): RetryMetrics {
    const totalAttempts = this.attempts.length;
    const totalDelayMs = this.attempts.reduce((sum, attempt) => sum + attempt.delayMs, 0);

    // Calculate average delay, handle edge case
    const averageDelayMs = totalAttempts > 0 ? totalDelayMs / totalAttempts : 0;

    return {
      totalAttempts,
      totalDelayMs,
      averageDelayMs,
      strategy: this.config.strategy,
      jitterApplied: this.config.jitterEnabled,
    };
  }

  /**
   * Reset retry attempts (useful for new operations)
   */
  reset(): void {
    this.attempts = [];
  }

  /**
   * Get all recorded attempts
   */
  getAttempts(): RetryAttempt[] {
    return [...this.attempts];
  }

  /**
   * Update retry configuration
   */
  updateConfig(newConfig: Partial<RetryConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get available retry strategies
   */
  static getAvailableStrategies(): RetryStrategyType[] {
    return BackoffStrategyFactory.getAvailableStrategies();
  }

  /**
   * Check if a strategy is supported
   */
  static isStrategySupported(strategy: RetryStrategyType): boolean {
    return BackoffStrategyFactory.isStrategySupported(strategy);
  }

  /**
   * Register a custom backoff strategy (for extensibility)
   */
  static registerCustomStrategy(strategyType: RetryStrategyType, strategy: IBackoffStrategy): void {
    BackoffStrategyFactory.registerStrategy(strategyType, strategy);
  }

  /**
   * Create a delay promise for async operations
   */
  async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute a function with retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context?: { taskId?: string; operationType?: string }
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await operation();

        if (attempt > 0) {
          logger.info('Operation succeeded after retries', {
            ...context,
            attempt,
            totalAttempts: attempt + 1,
            metrics: this.getMetrics(),
          });
        }

        return result;
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.config.maxRetries && this.shouldRetry(attempt, lastError)) {
          const delayMs = this.calculateDelay(attempt, lastError.message);

          logger.warn('Operation failed, retrying after delay', {
            ...context,
            attempt: attempt + 1,
            maxRetries: this.config.maxRetries,
            delayMs,
            errorMessage: lastError.message,
          });

          await this.delay(delayMs);
        } else {
          logger.error('Operation failed after all retries', {
            ...context,
            totalAttempts: attempt + 1,
            finalError: lastError.message,
            metrics: this.getMetrics(),
          });
          break;
        }
      }
    }

    throw lastError || new Error('Operation failed after retries');
  }
}

/**
 * Create a new retry strategy instance
 */
export function createRetryStrategy(config?: Partial<RetryConfig>): RetryStrategy {
  const finalConfig = config ? { ...defaultRetryConfig, ...config } : defaultRetryConfig;
  return new RetryStrategy(finalConfig);
}

/**
 * Utility function for simple exponential backoff delay calculation
 */
export function calculateExponentialBackoff(
  retryCount: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 30000,
  multiplier: number = 2,
  jitter: boolean = true
): number {
  const strategy = createRetryStrategy({
    baseDelayMs,
    maxDelayMs,
    backoffMultiplier: multiplier,
    jitterEnabled: jitter,
    strategy: RetryStrategyType.EXPONENTIAL,
    maxRetries: 10,
  });

  return strategy.calculateDelay(retryCount);
}
