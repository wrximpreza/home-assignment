import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';

import { env, featureFlags } from '@/config';

const powertoolsLoggerInstance = new Logger({
  serviceName: 'fault-tolerant-service',
  logLevel: featureFlags.enableDetailedLogging ? 'DEBUG' : 'INFO',
  environment: env.STAGE,
  persistentLogAttributes: {
    version: process.env.npm_package_version || '1.0.0',
    region: env.REGION,
    stage: env.STAGE,
  },
});

export const metrics = new Metrics({
  namespace: 'FaultTolerantService',
  serviceName: 'fault-tolerant-service',
  defaultDimensions: {
    stage: env.STAGE,
    region: env.REGION,
  },
});

export const tracer = new Tracer({
  serviceName: 'fault-tolerant-service',
  captureHTTPsRequests: true,
});

export interface LogContext {
  taskId?: string;
  correlationId?: string;
  retryCount?: number;
  stage?: string;
  functionName?: string;
  [key: string]: unknown;
}

export class PowertoolsLogger {
  private readonly powertoolsLogger: Logger;

  constructor() {
    this.powertoolsLogger = powertoolsLoggerInstance;
  }

  addContext(_context: LogContext): void {
    // Context is handled by AWS Lambda Powertools logger automatically
    // This method is kept for interface compatibility
  }

  error(message: string, context?: LogContext, error?: Error): void {
    const logData: Record<string, unknown> = {
      ...context,
      event: 'error',
    };

    if (error) {
      logData.error = {
        name: error.name,
        message: error.message,
        stack: featureFlags.enableDetailedLogging ? error.stack : undefined,
      };
    }

    this.powertoolsLogger.error(message, logData);
  }

  warn(message: string, context?: LogContext): void {
    this.powertoolsLogger.warn(message, {
      ...context,
      event: 'warning',
    });
  }

  info(message: string, context?: LogContext): void {
    this.powertoolsLogger.info(message, {
      ...context,
      event: 'info',
    });
  }

  debug(message: string, context?: LogContext): void {
    this.powertoolsLogger.debug(message, {
      ...context,
      event: 'debug',
    });
  }

  taskStarted(taskId: string, context?: LogContext): void {
    this.info('Task processing started', {
      ...context,
      taskId,
      event: 'task_started',
    });
  }

  taskCompleted(taskId: string, processingTimeMs: number, context?: LogContext): void {
    this.info('Task processing completed', {
      ...context,
      taskId,
      processingTimeMs,
      event: 'task_completed',
    });

    metrics.addMetric('TaskCompleted', 'Count', 1);
    metrics.addMetric('TaskProcessingTime', 'Milliseconds', processingTimeMs);
  }

  taskFailed(taskId: string, error: Error, context?: LogContext): void {
    this.error(
      'Task processing failed',
      {
        ...context,
        taskId,
        event: 'task_failed',
      },
      error
    );

    metrics.addMetric('TaskFailed', 'Count', 1);
  }

  taskRetried(taskId: string, retryCount: number, context?: LogContext): void {
    this.warn('Task retry attempted', {
      ...context,
      taskId,
      retryCount,
      event: 'task_retried',
    });

    metrics.addMetric('TaskRetried', 'Count', 1);
  }

  taskSentToDLQ(taskId: string, error: Error, context?: LogContext): void {
    this.error(
      'Task sent to DLQ',
      {
        ...context,
        taskId,
        event: 'task_dlq',
        severity: 'CRITICAL',
      },
      error
    );

    metrics.addMetric('TaskSentToDLQ', 'Count', 1);
  }

  dlqMessageProcessed(taskId: string, context?: LogContext): void {
    this.info('DLQ message processed', {
      ...context,
      taskId,
      event: 'dlq_processed',
    });
  }

  apiRequestReceived(method: string, path: string, context?: LogContext): void {
    this.info('API request received', {
      ...context,
      method,
      path,
      event: 'api_request',
    });
  }

  apiResponseSent(statusCode: number, context?: LogContext): void {
    // Log response with appropriate level based on status code
    const logLevel = statusCode >= 400 ? 'warn' : 'info';
    this[logLevel]('API response sent', {
      ...context,
      statusCode,
      event: 'api_response',
    });
  }
}

export const logger = new PowertoolsLogger();
export { powertoolsLoggerInstance };

export function createTaskContext(taskId: string, correlationId?: string): LogContext {
  return {
    taskId,
    correlationId,
    functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
    stage: process.env.STAGE,
  };
}

export function createApiContext(correlationId: string, userAgent?: string): LogContext {
  return {
    correlationId,
    userAgent,
    functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
    stage: process.env.STAGE,
  };
}

export function traced(target: unknown, propertyKey: string, descriptor: PropertyDescriptor): void {
  const originalMethod = descriptor.value;

  descriptor.value = function (...args: unknown[]) {
    const segment = tracer.getSegment();
    const className = (target as { constructor: { name: string } }).constructor.name;
    const subsegment = segment?.addNewSubsegment(`${className}.${propertyKey}`);

    try {
      const result = originalMethod.apply(this, args);

      if (result instanceof Promise) {
        return result
          .then(res => {
            subsegment?.close();
            return res;
          })
          .catch(error => {
            subsegment?.addError(error);
            subsegment?.close();
            throw error;
          });
      }

      subsegment?.close();
      return result;
    } catch (error) {
      subsegment?.addError(error as Error);
      subsegment?.close();
      throw error;
    }
  };
}
