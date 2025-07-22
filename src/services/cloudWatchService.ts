import { awsConfig, cloudWatchConfig, env } from '@/config';
import {
  CloudWatchMetric,
  DLQAnalytics,
  DLQLogEntry,
  DLQMessage,
  SQSRecord,
  TaskMetrics,
} from '@/types';
import { logger } from '@/utils/logger';
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  PutLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
export class CloudWatchService {
  private readonly client: CloudWatchLogsClient;
  private readonly dlqLogGroupName: string;
  private readonly dlqLogStreamName: string;
  private logStreamInitialized: boolean = false;

  constructor() {
    this.client = new CloudWatchLogsClient(awsConfig);
    this.dlqLogGroupName = `/aws/lambda/fault-tolerant-service-${env.STAGE}-dlq`;
    this.dlqLogStreamName = `dlq-monitoring-${new Date().toISOString().split('T')[0]}`;
  }

  async putMetric(metric: CloudWatchMetric): Promise<void> {
    try {
      const metricData = {
        timestamp: metric.Timestamp || new Date(),
        metricName: metric.MetricName,
        value: metric.Value,
        unit: metric.Unit,
        dimensions: metric.Dimensions || cloudWatchConfig.defaultDimensions,
        namespace: cloudWatchConfig.namespace,
      };
      logger.info('Custom metric recorded', {
        metric: metricData,
        event: 'custom_metric',
      });
    } catch (error) {
      logger.error(
        'Failed to put custom metric',
        {
          metricName: metric.MetricName,
        },
        error as Error
      );
    }
  }

  async recordTaskMetrics(metrics: TaskMetrics): Promise<void> {
    const baseMetrics: CloudWatchMetric[] = [
      {
        MetricName: 'TotalTasks',
        Value: metrics.totalTasks,
        Unit: 'Count',
      },
      {
        MetricName: 'SuccessfulTasks',
        Value: metrics.successfulTasks,
        Unit: 'Count',
      },
      {
        MetricName: 'FailedTasks',
        Value: metrics.failedTasks,
        Unit: 'Count',
      },
      {
        MetricName: 'RetriedTasks',
        Value: metrics.retriedTasks,
        Unit: 'Count',
      },
      {
        MetricName: 'DeadLetterTasks',
        Value: metrics.deadLetterTasks,
        Unit: 'Count',
      },
      {
        MetricName: 'AverageProcessingTime',
        Value: metrics.averageProcessingTime,
        Unit: 'Milliseconds',
      },
    ];

    const successRate =
      metrics.totalTasks > 0 ? (metrics.successfulTasks / metrics.totalTasks) * 100 : 0;
    const failureRate =
      metrics.totalTasks > 0 ? (metrics.failedTasks / metrics.totalTasks) * 100 : 0;
    const derivedMetrics: CloudWatchMetric[] = [
      {
        MetricName: 'SuccessRate',
        Value: successRate,
        Unit: 'Percent',
      },
      {
        MetricName: 'FailureRate',
        Value: failureRate,
        Unit: 'Percent',
      },
    ];

    const allMetrics = [...baseMetrics, ...derivedMetrics];
    await Promise.allSettled(allMetrics.map(metric => this.putMetric(metric)));
  }

  async recordTaskDuration(taskId: string, durationMs: number): Promise<void> {
    await this.putMetric({
      MetricName: 'TaskProcessingDuration',
      Value: durationMs,
      Unit: 'Milliseconds',
      Dimensions: [
        ...cloudWatchConfig.defaultDimensions,
        {
          Name: 'TaskId',
          Value: taskId,
        },
      ],
    });
  }

  async recordTaskFailure(taskId: string, errorType: string, retryCount: number): Promise<void> {
    await Promise.allSettled([
      this.putMetric({
        MetricName: 'TaskFailure',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          ...cloudWatchConfig.defaultDimensions,
          {
            Name: 'ErrorType',
            Value: errorType,
          },
        ],
      }),
      this.putMetric({
        MetricName: 'TaskRetryCount',
        Value: retryCount,
        Unit: 'Count',
        Dimensions: [
          ...cloudWatchConfig.defaultDimensions,
          {
            Name: 'TaskId',
            Value: taskId,
          },
        ],
      }),
    ]);
  }

  async recordQueueDepth(queueName: string, depth: number): Promise<void> {
    await this.putMetric({
      MetricName: 'QueueDepth',
      Value: depth,
      Unit: 'Count',
      Dimensions: [
        ...cloudWatchConfig.defaultDimensions,
        {
          Name: 'QueueName',
          Value: queueName,
        },
      ],
    });
  }

  async recordApiRequest(
    endpoint: string,
    method: string,
    statusCode: number,
    durationMs: number
  ): Promise<void> {
    await Promise.allSettled([
      this.putMetric({
        MetricName: 'ApiRequest',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          ...cloudWatchConfig.defaultDimensions,
          {
            Name: 'Endpoint',
            Value: endpoint,
          },
          {
            Name: 'Method',
            Value: method,
          },
          {
            Name: 'StatusCode',
            Value: statusCode.toString(),
          },
        ],
      }),
      this.putMetric({
        MetricName: 'ApiResponseTime',
        Value: durationMs,
        Unit: 'Milliseconds',
        Dimensions: [
          ...cloudWatchConfig.defaultDimensions,
          {
            Name: 'Endpoint',
            Value: endpoint,
          },
        ],
      }),
    ]);
  }

  /**
   * Initialize CloudWatch Logs stream for DLQ monitoring
   */
  private async initializeDLQLogStream(): Promise<void> {
    if (this.logStreamInitialized) {
      return;
    }

    try {
      try {
        await this.client.send(
          new CreateLogGroupCommand({
            logGroupName: this.dlqLogGroupName,
          })
        );
      } catch (error) {
        if ((error as Error).name !== 'ResourceAlreadyExistsException') {
          logger.warn('Failed to create DLQ log group', { error: (error as Error).message });
        }
      }

      try {
        await this.client.send(
          new CreateLogStreamCommand({
            logGroupName: this.dlqLogGroupName,
            logStreamName: this.dlqLogStreamName,
          })
        );
      } catch (error) {
        if ((error as Error).name !== 'ResourceAlreadyExistsException') {
          logger.warn('Failed to create DLQ log stream', { error: (error as Error).message });
        }
      }

      this.logStreamInitialized = true;
    } catch (error) {
      logger.error('Failed to initialize DLQ log stream', {}, error as Error);
    }
  }

  /**
   * Classify error for better monitoring and alerting
   */
  private classifyError(
    errorMessage: string,
    retryCount: number
  ): DLQLogEntry['errorClassification'] {
    const message = errorMessage.toLowerCase();

    if (
      message.includes('validation') ||
      message.includes('invalid') ||
      message.includes('malformed')
    ) {
      return {
        category: 'VALIDATION',
        severity: 'MEDIUM',
        isRetryable: false,
        suggestedAction: 'Review and fix input data validation',
      };
    }

    if (
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('timeout')
    ) {
      return {
        category: 'NETWORK',
        severity: retryCount > 2 ? 'HIGH' : 'MEDIUM',
        isRetryable: true,
        suggestedAction: 'Check network connectivity and service availability',
      };
    }

    if (message.includes('throttl') || message.includes('rate') || message.includes('limit')) {
      return {
        category: 'RATE_LIMIT',
        severity: 'MEDIUM',
        isRetryable: true,
        suggestedAction: 'Implement exponential backoff or reduce request rate',
      };
    }

    if (message.includes('system') || message.includes('internal') || message.includes('server')) {
      return {
        category: 'SYSTEM',
        severity: 'HIGH',
        isRetryable: true,
        suggestedAction: 'Check system health and resource availability',
      };
    }

    return {
      category: 'UNKNOWN',
      severity: retryCount > 1 ? 'HIGH' : 'MEDIUM',
      isRetryable: retryCount < 3,
      suggestedAction: 'Manual investigation required',
    };
  }

  /**
   * Sanitize payload for logging (remove sensitive data)
   */
  private sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth', 'credential'];
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(payload)) {
      const keyLower = key.toLowerCase();
      if (sensitiveKeys.some(sensitive => keyLower.includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizePayload(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Enhanced DLQ message logging with comprehensive details
   */
  async logDLQMessage(
    taskId: string,
    payload: Record<string, unknown>,
    errorMessage: string,
    retryCount: number
  ): Promise<void> {
    const dlqLogData = {
      timestamp: new Date().toISOString(),
      taskId,
      payload,
      errorMessage,
      retryCount,
      event: 'dlq_message',
      severity: 'ERROR',
    };

    logger.error('Task sent to DLQ', dlqLogData);

    await this.putMetric({
      MetricName: 'DLQMessage',
      Value: 1,
      Unit: 'Count',
      Dimensions: [
        ...cloudWatchConfig.defaultDimensions,
        {
          Name: 'TaskId',
          Value: taskId,
        },
      ],
    });
  }

  /**
   * Log comprehensive DLQ entry with detailed analysis
   */
  async logComprehensiveDLQEntry(dlqEntry: DLQLogEntry): Promise<void> {
    try {
      await this.initializeDLQLogStream();

      const logEvent = {
        timestamp: new Date(dlqEntry.timestamp).getTime(),
        message: JSON.stringify(dlqEntry, null, 2),
      };

      await this.client.send(
        new PutLogEventsCommand({
          logGroupName: this.dlqLogGroupName,
          logStreamName: this.dlqLogStreamName,
          logEvents: [logEvent],
        })
      );

      logger.error('Comprehensive DLQ entry logged', {
        taskId: dlqEntry.taskId,
        errorCategory: dlqEntry.errorClassification.category,
        severity: dlqEntry.errorClassification.severity,
        retryCount: dlqEntry.retryCount,
        payloadSize: dlqEntry.payload.size,
        event: 'comprehensive_dlq_log',
      });

      await Promise.allSettled([
        this.putMetric({
          MetricName: 'DLQMessageDetailed',
          Value: 1,
          Unit: 'Count',
          Dimensions: [
            ...cloudWatchConfig.defaultDimensions,
            {
              Name: 'ErrorCategory',
              Value: dlqEntry.errorClassification.category,
            },
            {
              Name: 'Severity',
              Value: dlqEntry.errorClassification.severity,
            },
          ],
        }),
        this.putMetric({
          MetricName: 'DLQPayloadSize',
          Value: dlqEntry.payload.size,
          Unit: 'Bytes',
          Dimensions: [
            ...cloudWatchConfig.defaultDimensions,
            {
              Name: 'TaskId',
              Value: dlqEntry.taskId,
            },
          ],
        }),
        this.putMetric({
          MetricName: 'DLQRetryCount',
          Value: dlqEntry.retryCount,
          Unit: 'Count',
          Dimensions: [
            ...cloudWatchConfig.defaultDimensions,
            {
              Name: 'ErrorCategory',
              Value: dlqEntry.errorClassification.category,
            },
          ],
        }),
      ]);
    } catch (error) {
      logger.error(
        'Failed to log comprehensive DLQ entry',
        {
          taskId: dlqEntry.taskId,
        },
        error as Error
      );
    }
  }

  /**
   * Create comprehensive DLQ log entry from DLQ message
   */
  createDLQLogEntry(
    dlqMessage: DLQMessage,
    sqsRecord: SQSRecord,
    processingMetrics?: {
      totalProcessingTime?: number;
      firstAttemptAt: string;
      lastAttemptAt: string;
      retryDelays: number[];
    }
  ): DLQLogEntry {
    const errorClassification = this.classifyError(
      dlqMessage.lastError || dlqMessage.failureReason,
      dlqMessage.retryCount
    );

    return {
      timestamp: new Date().toISOString(),
      taskId: dlqMessage.taskId,
      originalMessageId: dlqMessage.originalMessageId,
      failureReason: dlqMessage.failureReason,
      lastError: dlqMessage.lastError || dlqMessage.failureReason,
      retryCount: dlqMessage.retryCount,
      failedAt: dlqMessage.failedAt,
      createdAt: dlqMessage.createdAt,
      payload: {
        size: JSON.stringify(dlqMessage.payload).length,
        keys: Object.keys(dlqMessage.payload),
        data: dlqMessage.payload,
        sanitized: this.sanitizePayload(dlqMessage.payload),
      },
      sqsMessageInfo: {
        messageId: sqsRecord.messageId,
        receiptHandle: sqsRecord.receiptHandle,
        approximateReceiveCount: sqsRecord.attributes?.ApproximateReceiveCount || '1',
        sentTimestamp: sqsRecord.attributes?.SentTimestamp || '',
        approximateFirstReceiveTimestamp:
          sqsRecord.attributes?.ApproximateFirstReceiveTimestamp || '',
        messageAttributes: sqsRecord.messageAttributes || {},
      },
      errorClassification,
      processingMetrics: processingMetrics || {
        firstAttemptAt: dlqMessage.createdAt,
        lastAttemptAt: dlqMessage.failedAt,
        retryDelays: [],
      },
      environment: {
        stage: env.STAGE,
        region: env.REGION,
        functionName: process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
        version: process.env.npm_package_version || '1.0.0',
      },
    };
  }

  /**
   * Generate DLQ analytics from multiple DLQ entries
   */
  generateDLQAnalytics(dlqEntries: DLQLogEntry[], timeWindowMs: number = 3600000): DLQAnalytics {
    const now = new Date();
    const windowStart = new Date(now.getTime() - timeWindowMs);

    const entriesInWindow = dlqEntries.filter(entry => new Date(entry.timestamp) >= windowStart);

    const uniqueTasks = new Set(entriesInWindow.map(entry => entry.taskId)).size;
    const totalPayloadSize = entriesInWindow.reduce((sum, entry) => sum + entry.payload.size, 0);
    const retryCountSum = entriesInWindow.reduce((sum, entry) => sum + entry.retryCount, 0);
    const maxRetryCount = Math.max(...entriesInWindow.map(entry => entry.retryCount), 0);

    const byCategory = entriesInWindow.reduce(
      (acc, entry) => {
        acc[entry.errorClassification.category] =
          (acc[entry.errorClassification.category] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const bySeverity = entriesInWindow.reduce(
      (acc, entry) => {
        acc[entry.errorClassification.severity] =
          (acc[entry.errorClassification.severity] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const byRetryCount = entriesInWindow.reduce(
      (acc, entry) => {
        const key = entry.retryCount.toString();
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const errorCounts = entriesInWindow.reduce(
      (acc, entry) => {
        const error = entry.lastError.substring(0, 100);
        acc[error] = (acc[error] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const topErrors = Object.entries(errorCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([error, count]) => ({
        error,
        count,
        percentage: (count / entriesInWindow.length) * 100,
      }));

    return {
      timeWindow: {
        start: windowStart.toISOString(),
        end: now.toISOString(),
        durationMs: timeWindowMs,
      },
      summary: {
        totalMessages: entriesInWindow.length,
        uniqueTasks,
        averageRetryCount: entriesInWindow.length > 0 ? retryCountSum / entriesInWindow.length : 0,
        maxRetryCount,
        totalPayloadSize,
        averagePayloadSize:
          entriesInWindow.length > 0 ? totalPayloadSize / entriesInWindow.length : 0,
      },
      errorBreakdown: {
        byCategory,
        bySeverity,
        byRetryCount,
        topErrors,
      },
      trends: {
        messagesPerHour: (entriesInWindow.length / timeWindowMs) * 3600000,
        peakHour: undefined,
        errorRateIncrease: undefined,
      },
    };
  }

  /**
   * Log DLQ analytics to CloudWatch
   */
  async logDLQAnalytics(analytics: DLQAnalytics): Promise<void> {
    try {
      await this.initializeDLQLogStream();

      const logEvent = {
        timestamp: new Date().getTime(),
        message: JSON.stringify(
          {
            event: 'dlq_analytics',
            analytics,
          },
          null,
          2
        ),
      };

      await this.client.send(
        new PutLogEventsCommand({
          logGroupName: this.dlqLogGroupName,
          logStreamName: this.dlqLogStreamName,
          logEvents: [logEvent],
        })
      );

      logger.info('DLQ analytics generated', {
        totalMessages: analytics.summary.totalMessages,
        uniqueTasks: analytics.summary.uniqueTasks,
        averageRetryCount: analytics.summary.averageRetryCount,
        timeWindowHours: analytics.timeWindow.durationMs / 3600000,
        event: 'dlq_analytics',
      });

      await Promise.allSettled([
        this.putMetric({
          MetricName: 'DLQAnalyticsGenerated',
          Value: 1,
          Unit: 'Count',
        }),
        this.putMetric({
          MetricName: 'DLQUniqueTasksInWindow',
          Value: analytics.summary.uniqueTasks,
          Unit: 'Count',
        }),
        this.putMetric({
          MetricName: 'DLQMessagesPerHour',
          Value: analytics.trends.messagesPerHour,
          Unit: 'Count/Second',
        }),
      ]);
    } catch (error) {
      logger.error('Failed to log DLQ analytics', {}, error as Error);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.putMetric({
        MetricName: 'HealthCheck',
        Value: 1,
        Unit: 'Count',
      });
      return true;
    } catch {
      return false;
    }
  }
}

export const cloudWatchService = new CloudWatchService();
