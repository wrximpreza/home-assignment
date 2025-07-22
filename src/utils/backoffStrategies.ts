import { IBackoffStrategy, RetryConfig, RetryStrategyType } from '@/types';

/**
 * Exponential backoff strategy implementation
 * Delay increases exponentially: baseDelay * multiplier^retryCount
 * Can optionally use VisibilityTimeout for SQS-based retry coordination
 */
export class ExponentialBackoffStrategy implements IBackoffStrategy {
  calculateDelay(retryCount: number, config: RetryConfig): number {
    let delay = config.baseDelayMs * Math.pow(config.backoffMultiplier, retryCount);

    if (config.useVisibilityTimeout) {
      const visibilityMultiplier = config.visibilityTimeoutMultiplier || 1.5;
      const maxVisibilityDelay = 180 * 1000 * 0.8;
      delay = Math.min(delay, maxVisibilityDelay);

      delay = delay * visibilityMultiplier;
    }

    return Math.min(delay, config.maxDelayMs);
  }

  getName(): string {
    return RetryStrategyType.EXPONENTIAL;
  }
}

/**
 * Strategy factory for creating backoff strategies
 */
export class BackoffStrategyFactory {
  private static strategies = new Map<RetryStrategyType, IBackoffStrategy>([
    [RetryStrategyType.EXPONENTIAL, new ExponentialBackoffStrategy()],
  ]);

  /**
   * Get strategy instance by type
   */
  static getStrategy(strategyType: RetryStrategyType): IBackoffStrategy {
    const strategy = this.strategies.get(strategyType);
    if (!strategy) {
      throw new Error(`Unknown retry strategy: ${strategyType}`);
    }
    return strategy;
  }

  /**
   * Register a new strategy (for extensibility)
   */
  static registerStrategy(strategyType: RetryStrategyType, strategy: IBackoffStrategy): void {
    this.strategies.set(strategyType, strategy);
  }

  /**
   * Get all available strategy types
   */
  static getAvailableStrategies(): RetryStrategyType[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * Check if strategy is supported
   */
  static isStrategySupported(strategyType: RetryStrategyType): boolean {
    return this.strategies.has(strategyType);
  }
}
