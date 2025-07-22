import {
  SQSEvent,
  SQSRecord,
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  SQSBatchResponse,
} from 'aws-lambda';

export interface TaskPayload {
  taskId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  retryCount?: number;
  lastError?: string;
}

export interface TaskRecord {
  taskId: string;
  payload: Record<string, unknown>;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  ttl?: number;
  retryCount: number;
  lastError?: string;
  completedAt?: string;
  failedAt?: string;
  failureDestiny?: boolean;
}

export enum TaskStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  DEAD_LETTER = 'DEAD_LETTER',
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

export interface TaskSubmissionResponse {
  taskId: string;
  status: string;
  message: string;
}

export interface ProcessingError extends Error {
  taskId?: string;
  retryCount?: number;
  isRetryable?: boolean;
}

export class RetryableError extends Error implements ProcessingError {
  public readonly taskId?: string;
  public readonly retryCount?: number;
  public readonly isRetryable = true;
  constructor(message: string, taskId?: string, retryCount?: number) {
    super(message);
    this.name = 'RetryableError';
    this.taskId = taskId;
    this.retryCount = retryCount;
  }
}

export class NonRetryableError extends Error implements ProcessingError {
  public readonly taskId?: string;
  public readonly retryCount?: number;
  public readonly isRetryable = false;
  constructor(message: string, taskId?: string, retryCount?: number) {
    super(message);
    this.name = 'NonRetryableError';
    this.taskId = taskId;
    this.retryCount = retryCount;
  }
}

export type SubmitTaskHandler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

export type ProcessTaskHandler = (event: SQSEvent) => Promise<SQSBatchResponse>;

export type MonitorDLQHandler = (event: SQSEvent) => Promise<SQSBatchResponse>;

export interface TaskMessage {
  taskId: string;
  payload: Record<string, unknown>;
  retryCount: number;
  createdAt: string;
  lastError?: string;
}

export interface DLQMessage extends TaskMessage {
  failureReason: string;
  originalMessageId: string;
  failedAt: string;
}

export interface DLQLogEntry {
  timestamp: string;
  taskId: string;
  originalMessageId: string;
  failureReason: string;
  lastError: string;
  retryCount: number;
  failedAt: string;
  createdAt: string;
  payload: {
    size: number;
    keys: string[];
    data: Record<string, unknown>;
    sanitized?: Record<string, unknown>;
  };
  sqsMessageInfo: {
    messageId: string;
    receiptHandle: string;
    approximateReceiveCount: string;
    sentTimestamp: string;
    approximateFirstReceiveTimestamp: string;
    messageAttributes?: Record<string, unknown>;
  };
  errorClassification: {
    category: 'VALIDATION' | 'NETWORK' | 'TIMEOUT' | 'RATE_LIMIT' | 'SYSTEM' | 'UNKNOWN';
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    isRetryable: boolean;
    suggestedAction: string;
  };
  processingMetrics: {
    totalProcessingTime?: number;
    firstAttemptAt: string;
    lastAttemptAt: string;
    retryDelays: number[];
  };
  environment: {
    stage: string;
    region: string;
    functionName: string;
    version: string;
  };
}

export interface DLQAnalytics {
  timeWindow: {
    start: string;
    end: string;
    durationMs: number;
  };
  summary: {
    totalMessages: number;
    uniqueTasks: number;
    averageRetryCount: number;
    maxRetryCount: number;
    totalPayloadSize: number;
    averagePayloadSize: number;
  };
  errorBreakdown: {
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
    byRetryCount: Record<string, number>;
    topErrors: Array<{
      error: string;
      count: number;
      percentage: number;
    }>;
  };
  trends: {
    messagesPerHour: number;
    peakHour?: string;
    errorRateIncrease?: number;
  };
}

export enum RetryStrategyType {
  EXPONENTIAL = 'exponential',
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterEnabled: boolean;
  jitterMaxMs?: number;
  strategy: RetryStrategyType;
  useVisibilityTimeout?: boolean;
  visibilityTimeoutMultiplier?: number;
}

export interface IBackoffStrategy {
  calculateDelay(retryCount: number, config: RetryConfig): number;
  getName(): string;
}

export interface SQSRetryConfig {
  visibilityTimeoutSeconds: number;
  maxRetries: number;
  useVisibilityTimeoutStrategy: boolean;
}

export interface RetryAttempt {
  attemptNumber: number;
  delayMs: number;
  timestamp: string;
  error?: string;
}

export interface RetryMetrics {
  totalAttempts: number;
  totalDelayMs: number;
  averageDelayMs: number;
  strategy: string;
  jitterApplied: boolean;
}

export interface ProcessingConfig {
  failureRate: number;
  processingTimeMs: number;
}

export interface TaskMetrics {
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  retriedTasks: number;
  deadLetterTasks: number;
  averageProcessingTime: number;
}

export interface CloudWatchMetric {
  MetricName: string;
  Value: number;
  Unit: string;
  Timestamp?: Date;
  Dimensions?: Array<{
    Name: string;
    Value: string;
  }>;
}

export interface Environment {
  STAGE: string;
  REGION: string;
  TASK_QUEUE_URL: string;
  TASK_DLQ_URL: string;
  TASK_TABLE_NAME: string;
}

export { SQSEvent, SQSRecord, APIGatewayProxyEvent, APIGatewayProxyResult, SQSBatchResponse };
