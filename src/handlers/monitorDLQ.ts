import middy from '@middy/core';
import { SQSEvent, SQSRecord, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { MonitorDLQHandler, TaskMessage, TaskStatus, DLQMessage, DLQLogEntry } from '@/types';
import { validateEnvironment } from '@/config';
import { logger, createTaskContext } from '@/utils/logger';
import { dynamoService } from '@/services/dynamoService';
import { cloudWatchService } from '@/services/cloudWatchService';
function parseDLQMessage(record: SQSRecord): DLQMessage {
  let taskMessage: TaskMessage;
  try {
    taskMessage = JSON.parse(record.body);
  } catch (error) {
    throw new Error(`Failed to parse DLQ message body: ${(error as Error).message}`);
  }
  const failureReason =
    record.messageAttributes?.['failureReason']?.stringValue || 'Unknown failure';
  const originalMessageId =
    record.messageAttributes?.['originalMessageId']?.stringValue || record.messageId;
  return {
    ...taskMessage,
    failureReason,
    originalMessageId,
    failedAt: new Date().toISOString(),
  };
}

async function processDLQMessage(
  record: SQSRecord
): Promise<{ success: boolean; messageId: string; error?: Error; dlqLogEntry?: DLQLogEntry }> {
  let dlqMessage: DLQMessage;
  try {
    dlqMessage = parseDLQMessage(record);
  } catch (error) {
    logger.error(
      'Failed to parse DLQ message',
      {
        messageId: record.messageId,
        receiptHandle: record.receiptHandle,
      },
      error as Error
    );
    return { success: false, messageId: record.messageId, error: error as Error };
  }
  const { taskId, payload, retryCount, lastError, failureReason } = dlqMessage;
  const context = createTaskContext(taskId);

  logger.info('Processing DLQ message', {
    ...context,
    messageId: record.messageId,
    retryCount,
    failureReason,
    payloadSize: JSON.stringify(payload).length,
    payloadKeys: Object.keys(payload),
    sqsAttributes: {
      approximateReceiveCount: record.attributes?.ApproximateReceiveCount,
      sentTimestamp: record.attributes?.SentTimestamp,
    },
  });

  try {
    await dynamoService.updateTaskStatus(taskId, TaskStatus.DEAD_LETTER, {
      retryCount,
      lastError: lastError || failureReason,
      failedAt: dlqMessage.failedAt,
    });

    const dlqLogEntry = cloudWatchService.createDLQLogEntry(dlqMessage, record, {
      firstAttemptAt: dlqMessage.createdAt,
      lastAttemptAt: dlqMessage.failedAt,
      retryDelays: [],
    });

    await cloudWatchService.logComprehensiveDLQEntry(dlqLogEntry);
    await cloudWatchService.logDLQMessage(taskId, payload, lastError || failureReason, retryCount);
    const failureReport = {
      taskId,
      originalMessageId: dlqMessage.originalMessageId,
      failureReason,
      lastError,
      retryCount,
      failedAt: dlqMessage.failedAt,
      createdAt: dlqMessage.createdAt,
      errorClassification: dlqLogEntry.errorClassification,
      payload: {
        size: JSON.stringify(payload).length,
        keys: Object.keys(payload),
        data: payload,
        sanitizedKeys: Object.keys(dlqLogEntry.payload.sanitized || {}),
      },
      sqsMessageInfo: {
        messageId: record.messageId,
        receiptHandle: record.receiptHandle,
        approximateReceiveCount: record.attributes.ApproximateReceiveCount,
        sentTimestamp: record.attributes.SentTimestamp,
        approximateFirstReceiveTimestamp: record.attributes.ApproximateFirstReceiveTimestamp,
      },
      processingDuration: dlqLogEntry.processingMetrics.totalProcessingTime,
      environment: dlqLogEntry.environment,
    };

    logger.error('Task permanently failed - sent to DLQ', {
      ...context,
      failureReport,
      event: 'task_permanent_failure',
      severity: dlqLogEntry.errorClassification.severity,
      errorCategory: dlqLogEntry.errorClassification.category,
      isRetryable: dlqLogEntry.errorClassification.isRetryable,
      suggestedAction: dlqLogEntry.errorClassification.suggestedAction,
    });

    await Promise.allSettled([
      cloudWatchService.putMetric({
        MetricName: 'TaskPermanentFailure',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          {
            Name: 'FailureReason',
            Value: failureReason,
          },
          {
            Name: 'RetryCount',
            Value: retryCount.toString(),
          },
          {
            Name: 'ErrorCategory',
            Value: dlqLogEntry.errorClassification.category,
          },
          {
            Name: 'Severity',
            Value: dlqLogEntry.errorClassification.severity,
          },
        ],
      }),
      cloudWatchService.putMetric({
        MetricName: 'DLQTaskProcessingTime',
        Value: dlqLogEntry.processingMetrics.totalProcessingTime || 0,
        Unit: 'Milliseconds',
        Dimensions: [
          {
            Name: 'ErrorCategory',
            Value: dlqLogEntry.errorClassification.category,
          },
        ],
      }),
    ]);

    logger.dlqMessageProcessed(taskId, {
      ...context,
      processingResult: 'success',
      errorCategory: dlqLogEntry.errorClassification.category,
      severity: dlqLogEntry.errorClassification.severity,
    });

    return {
      success: true,
      messageId: record.messageId,
      dlqLogEntry,
    };
  } catch (error) {
    logger.error(
      'Failed to process DLQ message',
      {
        ...context,
        messageId: record.messageId,
      },
      error as Error
    );
    await cloudWatchService.putMetric({
      MetricName: 'DLQProcessingFailure',
      Value: 1,
      Unit: 'Count',
    });
    return { success: false, messageId: record.messageId, error: error as Error };
  }
}

async function generateDLQReport(
  dlqMessages: DLQMessage[],
  dlqLogEntries: DLQLogEntry[]
): Promise<void> {
  if (dlqMessages.length === 0) {
    return;
  }

  const failuresByReason = dlqMessages.reduce(
    (acc, msg) => {
      const reason = msg.failureReason || 'Unknown';
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const failuresByRetryCount = dlqMessages.reduce(
    (acc, msg) => {
      const retryCount = msg.retryCount.toString();
      acc[retryCount] = (acc[retryCount] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const averageRetryCount =
    dlqMessages.reduce((sum, msg) => sum + msg.retryCount, 0) / dlqMessages.length;

  const dlqReport = {
    timestamp: new Date().toISOString(),
    totalFailedTasks: dlqMessages.length,
    failuresByReason,
    failuresByRetryCount,
    averageRetryCount: Math.round(averageRetryCount * 100) / 100,
    timeRange: {
      earliest: Math.min(...dlqMessages.map(msg => new Date(msg.createdAt).getTime())),
      latest: Math.max(...dlqMessages.map(msg => new Date(msg.createdAt).getTime())),
    },
  };

  logger.info('DLQ monitoring report generated', {
    dlqReport,
    event: 'dlq_monitoring_report',
  });

  if (dlqLogEntries.length > 0) {
    const analytics = cloudWatchService.generateDLQAnalytics(dlqLogEntries);

    logger.info('Enhanced DLQ analytics generated', {
      analytics: {
        summary: analytics.summary,
        errorBreakdown: analytics.errorBreakdown,
        trends: analytics.trends,
      },
      event: 'dlq_analytics_report',
    });

    await cloudWatchService.logDLQAnalytics(analytics);

    await Promise.allSettled([
      cloudWatchService.putMetric({
        MetricName: 'DLQBatchSize',
        Value: dlqMessages.length,
        Unit: 'Count',
      }),
      cloudWatchService.putMetric({
        MetricName: 'DLQAverageRetryCount',
        Value: averageRetryCount,
        Unit: 'Count',
      }),
      cloudWatchService.putMetric({
        MetricName: 'DLQUniqueTasksInBatch',
        Value: analytics.summary.uniqueTasks,
        Unit: 'Count',
      }),
      cloudWatchService.putMetric({
        MetricName: 'DLQAveragePayloadSize',
        Value: analytics.summary.averagePayloadSize,
        Unit: 'Bytes',
      }),

      ...Object.entries(analytics.errorBreakdown.byCategory).map(([category, count]) =>
        cloudWatchService.putMetric({
          MetricName: 'DLQErrorsByCategory',
          Value: count,
          Unit: 'Count',
          Dimensions: [
            {
              Name: 'ErrorCategory',
              Value: category,
            },
          ],
        })
      ),

      ...Object.entries(analytics.errorBreakdown.bySeverity).map(([severity, count]) =>
        cloudWatchService.putMetric({
          MetricName: 'DLQErrorsBySeverity',
          Value: count,
          Unit: 'Count',
          Dimensions: [
            {
              Name: 'Severity',
              Value: severity,
            },
          ],
        })
      ),
    ]);
  } else {
    await Promise.allSettled([
      cloudWatchService.putMetric({
        MetricName: 'DLQBatchSize',
        Value: dlqMessages.length,
        Unit: 'Count',
      }),
      cloudWatchService.putMetric({
        MetricName: 'DLQAverageRetryCount',
        Value: averageRetryCount,
        Unit: 'Count',
      }),
    ]);
  }
}

const monitorDLQHandler: MonitorDLQHandler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const startTime = Date.now();

  logger.info('Processing DLQ batch', {
    recordCount: event.Records.length,
    functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
    batchStartTime: new Date().toISOString(),
  });

  validateEnvironment();

  const dlqMessages: DLQMessage[] = [];
  const dlqLogEntries: DLQLogEntry[] = [];
  const results = await Promise.allSettled(event.Records.map(record => processDLQMessage(record)));

  const batchItemFailures: SQSBatchItemFailure[] = [];
  let successful = 0;
  let failed = 0;

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      if (result.value.success) {
        successful++;
        try {
          const dlqMessage = parseDLQMessage(event.Records[index]);
          dlqMessages.push(dlqMessage);

          if (result.value.dlqLogEntry) {
            dlqLogEntries.push(result.value.dlqLogEntry);
          }
        } catch {
          // Ignore parsing errors for reporting
        }
      } else {
        failed++;
        batchItemFailures.push({
          itemIdentifier: result.value.messageId,
        });
      }
    } else {
      failed++;
      batchItemFailures.push({
        itemIdentifier: event.Records[index]?.messageId || `unknown-${index}`,
      });
    }
  });

  const processingTime = Date.now() - startTime;

  logger.info('DLQ batch processing completed', {
    totalRecords: event.Records.length,
    successful,
    failed,
    partialFailures: batchItemFailures.length,
    processingTimeMs: processingTime,
    dlqLogEntriesCollected: dlqLogEntries.length,
    batchEndTime: new Date().toISOString(),
  });

  await generateDLQReport(dlqMessages, dlqLogEntries);

  await Promise.allSettled([
    cloudWatchService.putMetric({
      MetricName: 'DLQBatchProcessingTime',
      Value: processingTime,
      Unit: 'Milliseconds',
    }),
    cloudWatchService.putMetric({
      MetricName: 'DLQBatchSuccessRate',
      Value: event.Records.length > 0 ? (successful / event.Records.length) * 100 : 100,
      Unit: 'Percent',
    }),
  ]);

  if (batchItemFailures.length > 0) {
    logger.warn('Some DLQ records failed processing - using partial batch failure', {
      failedCount: batchItemFailures.length,
      failedMessageIds: batchItemFailures.map(failure => failure.itemIdentifier),
      successRate: event.Records.length > 0 ? (successful / event.Records.length) * 100 : 100,
    });
  }

  return {
    batchItemFailures,
  };
};
export const handler = middy(monitorDLQHandler);
