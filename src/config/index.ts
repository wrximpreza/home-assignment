import { Environment, ProcessingConfig, RetryConfig, RetryStrategyType } from '@/types';

export const env: Environment = {
  STAGE: process.env.STAGE || 'dev',
  REGION: process.env.REGION || 'us-east-1',
  TASK_QUEUE_URL: process.env.TASK_QUEUE_URL || 'http://localhost:9324/queue/TaskQueue',
  TASK_DLQ_URL: process.env.TASK_DLQ_URL || 'http://localhost:9324/queue/TaskDeadLetterQueue',
  TASK_TABLE_NAME: process.env.TASK_TABLE_NAME || 'fault-tolerant-service-dev-TaskTable',
};

export const retryConfig: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitterEnabled: true,
  strategy: RetryStrategyType.EXPONENTIAL,
  useVisibilityTimeout: false,
  visibilityTimeoutMultiplier: 1.2,
};

export const processingConfig: ProcessingConfig = {
  failureRate: parseFloat(process.env.FAILURE_RATE || '0.3'),
  processingTimeMs: 500,
};

export const awsConfig = {
  region: env.REGION,
  maxRetries: 3,
  retryDelayOptions: {
    customBackoff: (retryCount: number): number => {
      return Math.min(retryConfig.baseDelayMs * Math.pow(2, retryCount), retryConfig.maxDelayMs);
    },
  },
};

export const cloudWatchConfig = {
  namespace: 'FaultTolerantService',
  defaultDimensions: [
    {
      Name: 'Stage',
      Value: env.STAGE,
    },
    {
      Name: 'Service',
      Value: 'fault-tolerant-service',
    },
  ],
};

export const constants = {
  MAX_TASK_ID_LENGTH: 255,
  MAX_PAYLOAD_SIZE: 256 * 1024,
  DYNAMODB_TTL_DAYS: 30,

  SECONDS_PER_DAY: 24 * 60 * 60,
  MILLISECONDS_PER_SECOND: 1000,

  SQS_MAX_DELAY_SECONDS: 900,

  FAILURE_RATE_PRECISION: 1000,
} as const;

export const featureFlags = {
  enableDetailedLogging: env.STAGE === 'dev',
} as const;

export function validateEnvironment(): void {
  const requiredVars = ['TASK_QUEUE_URL', 'TASK_DLQ_URL', 'TASK_TABLE_NAME'] as const;
  const missingVars = requiredVars.filter(varName => !env[varName] || env[varName].trim() === '');

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  const failureRate = processingConfig.failureRate;

  if (isNaN(failureRate) || failureRate < 0 || failureRate > 1) {
    throw new Error(
      `FAILURE_RATE must be a number between 0 and 1, got: ${process.env.FAILURE_RATE}`
    );
  }
}

/**
 * Calculate backoff delay using exponential backoff strategy
 * @param retryCount The current retry attempt (0-based)
 * @param config Optional retry configuration override
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(
  retryCount: number,
  config: RetryConfig = retryConfig
): number {
  // Calculate exponential backoff
  const baseDelay = config.baseDelayMs * Math.pow(config.backoffMultiplier, retryCount);
  const cappedDelay = Math.min(baseDelay, config.maxDelayMs);

  // Add jitter if enabled to prevent thundering herd
  if (config.jitterEnabled) {
    const jitterMaxMs = config.jitterMaxMs ?? 500;
    const jitter = Math.random() * jitterMaxMs;
    return Math.min(cappedDelay + jitter, config.maxDelayMs);
  }

  return cappedDelay;
}

export function isRetryable(retryCount: number): boolean {
  return retryCount < retryConfig.maxRetries;
}
