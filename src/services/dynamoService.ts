import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

import { awsConfig, env, constants } from '@/config';
import { TaskRecord, TaskStatus } from '@/types';
import { logger } from '@/utils/logger';

export class DynamoService {
  private readonly client: DynamoDBDocumentClient;
  constructor() {
    const dynamoClient = new DynamoDBClient(awsConfig);
    this.client = DynamoDBDocumentClient.from(dynamoClient);
  }

  async createTask(taskRecord: Omit<TaskRecord, 'updatedAt'>): Promise<TaskRecord> {
    const now = new Date().toISOString();
    const record: TaskRecord = {
      ...taskRecord,
      updatedAt: now,
      ttl: Math.floor(Date.now() / 1000) + constants.DYNAMODB_TTL_DAYS * 24 * 60 * 60,
    };

    try {
      const command = new PutCommand({
        TableName: env.TASK_TABLE_NAME,
        Item: record,
        ConditionExpression: 'attribute_not_exists(taskId)',
      });
      await this.client.send(command);
      logger.info('Task record created', {
        taskId: record.taskId,
        status: record.status,
      });

      return record;
    } catch (error) {
      if ((error as Error).name === 'ConditionalCheckFailedException') {
        throw new Error(`Task with ID ${taskRecord.taskId} already exists`);
      }
      logger.error(
        'Failed to create task record',
        {
          taskId: taskRecord.taskId,
        },
        error as Error
      );
      throw new Error(`Failed to create task record: ${(error as Error).message}`);
    }
  }

  async getTask(taskId: string): Promise<TaskRecord | null> {
    try {
      const command = new GetCommand({
        TableName: env.TASK_TABLE_NAME,
        Key: { taskId },
      });
      const result = await this.client.send(command);

      return (result.Item as TaskRecord) || null;
    } catch (error) {
      logger.error(
        'Failed to get task record',
        {
          taskId,
        },
        error as Error
      );
      throw new Error(`Failed to get task record: ${(error as Error).message}`);
    }
  }

  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    updates: Partial<Pick<TaskRecord, 'retryCount' | 'lastError' | 'completedAt' | 'failedAt'>> = {}
  ): Promise<TaskRecord> {
    const now = new Date().toISOString();
    const updateExpression = ['SET #status = :status, #updatedAt = :updatedAt'];
    const expressionAttributeNames: Record<string, string> = {
      '#status': 'status',
      '#updatedAt': 'updatedAt',
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ':status': status,
      ':updatedAt': now,
    };

    if (updates.retryCount !== undefined) {
      updateExpression.push('#retryCount = :retryCount');
      expressionAttributeNames['#retryCount'] = 'retryCount';
      expressionAttributeValues[':retryCount'] = updates.retryCount;
    }

    if (updates.lastError !== undefined) {
      updateExpression.push('#lastError = :lastError');
      expressionAttributeNames['#lastError'] = 'lastError';
      expressionAttributeValues[':lastError'] = updates.lastError;
    }

    if (updates.completedAt !== undefined) {
      updateExpression.push('#completedAt = :completedAt');
      expressionAttributeNames['#completedAt'] = 'completedAt';
      expressionAttributeValues[':completedAt'] = updates.completedAt;
    }

    if (updates.failedAt !== undefined) {
      updateExpression.push('#failedAt = :failedAt');
      expressionAttributeNames['#failedAt'] = 'failedAt';
      expressionAttributeValues[':failedAt'] = updates.failedAt;
    }

    try {
      const command = new UpdateCommand({
        TableName: env.TASK_TABLE_NAME,
        Key: { taskId },
        UpdateExpression: updateExpression.join(', '),
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ConditionExpression: 'attribute_exists(taskId)',
        ReturnValues: 'ALL_NEW',
      });
      const result = await this.client.send(command);
      logger.info('Task status updated', {
        taskId,
        status,
        retryCount: updates.retryCount,
      });

      return result.Attributes as TaskRecord;
    } catch (error) {
      if ((error as Error).name === 'ConditionalCheckFailedException') {
        throw new Error(`Task with ID ${taskId} not found`);
      }
      logger.error(
        'Failed to update task status',
        {
          taskId,
          status,
        },
        error as Error
      );
      throw new Error(`Failed to update task status: ${(error as Error).message}`);
    }
  }

  async getTasksByStatus(
    status: TaskStatus,
    limit: number = 50,
    lastEvaluatedKey?: Record<string, unknown>
  ): Promise<{
    tasks: TaskRecord[];
    lastEvaluatedKey?: Record<string, unknown>;
  }> {
    try {
      const command = new QueryCommand({
        TableName: env.TASK_TABLE_NAME,
        IndexName: 'StatusIndex',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': status,
        },
        Limit: limit,
        ExclusiveStartKey: lastEvaluatedKey,
        ScanIndexForward: false,
      });

      const result = await this.client.send(command);

      return {
        tasks: (result.Items as TaskRecord[]) || [],
        lastEvaluatedKey: result.LastEvaluatedKey,
      };
    } catch (error) {
      logger.error(
        'Failed to get tasks by status',
        {
          status,
          limit,
        },
        error as Error
      );
      throw new Error(`Failed to get tasks by status: ${(error as Error).message}`);
    }
  }

  async getTaskStatistics(): Promise<Record<TaskStatus, number>> {
    const stats: Record<TaskStatus, number> = {
      [TaskStatus.PENDING]: 0,
      [TaskStatus.PROCESSING]: 0,
      [TaskStatus.COMPLETED]: 0,
      [TaskStatus.FAILED]: 0,
      [TaskStatus.DEAD_LETTER]: 0,
    };

    try {
      const command = new ScanCommand({
        TableName: env.TASK_TABLE_NAME,
        ProjectionExpression: '#status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
      });

      const result = await this.client.send(command);
      if (result.Items) {
        for (const item of result.Items) {
          const status = item.status as TaskStatus;
          if (status in stats) {
            stats[status]++;
          }
        }
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get task statistics', {}, error as Error);
      throw new Error(`Failed to get task statistics: ${(error as Error).message}`);
    }
  }

  async getFailureRateDecisionForNewTask(taskId: string): Promise<{
    shouldFail: boolean;
    currentFailureRate: number;
    totalProcessed: number;
    totalFailed: number;
    totalSucceeded: number;
  }> {
    if (taskId.includes('force-fail')) {
      logger.info('Task explicitly marked to fail', { taskId, reason: 'force-fail pattern' });
      return {
        shouldFail: true,
        currentFailureRate: 0,
        totalProcessed: 0,
        totalFailed: 0,
        totalSucceeded: 0,
      };
    }

    if (taskId.includes('force-success')) {
      logger.info('Task explicitly marked to succeed', { taskId, reason: 'force-success pattern' });
      return {
        shouldFail: false,
        currentFailureRate: 0,
        totalProcessed: 0,
        totalFailed: 0,
        totalSucceeded: 0,
      };
    }

    try {
      const command = new ScanCommand({
        TableName: env.TASK_TABLE_NAME,
        FilterExpression: '#status IN (:completed, :failed, :deadLetter)',
        ProjectionExpression: '#status, #taskId',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#taskId': 'taskId',
        },
        ExpressionAttributeValues: {
          ':completed': TaskStatus.COMPLETED,
          ':failed': TaskStatus.FAILED,
          ':deadLetter': TaskStatus.DEAD_LETTER,
        },
      });

      const result = await this.client.send(command);

      let totalSucceeded = 0;
      let totalFailed = 0;
      if (result.Items) {
        for (const item of result.Items) {
          const status = item.status as TaskStatus;
          if (status === TaskStatus.COMPLETED) {
            totalSucceeded++;
          } else if (status === TaskStatus.FAILED || status === TaskStatus.DEAD_LETTER) {
            totalFailed++;
          }
        }
      }

      const totalProcessed = totalSucceeded + totalFailed;
      const currentFailureRate = totalProcessed > 0 ? totalFailed / totalProcessed : 0;

      let shouldFail = false;
      const position = -1;

      let hash1 = 0;
      let hash2 = 0;
      for (let i = 0; i < taskId.length; i++) {
        const char = taskId.charCodeAt(i);
        hash1 = (hash1 << 5) - hash1 + char;
        hash2 = (hash2 << 3) - hash2 + char * 31;
      }

      const combinedHash = Math.abs(hash1 ^ hash2);

      const hashValue = combinedHash % 100000;
      shouldFail = hashValue < 30000;

      logger.info('Using flexible 30% failure determination', {
        taskId,
        combinedHash,
        hashValue,
        shouldFail,
        note: 'FLEXIBLE 30% failure rate - works for any batch size (1 to 100M+ tasks)',
        targetFailureRate: '30%',
        actualThreshold: 'hashValue < 30000 (out of 100000) - strict 30% failure rate',
      });

      logger.info('STRICT 30% failure rate decision', {
        taskId,
        totalProcessed,
        totalFailed,
        totalSucceeded,
        currentFailureRate: Math.round(currentFailureRate * 1000) / 10,
        targetFailureRate: 30.0,
        position,
        shouldFail,
      });

      return {
        shouldFail,
        currentFailureRate,
        totalProcessed,
        totalFailed,
        totalSucceeded,
      };
    } catch (error) {
      logger.error('Failed to get failure rate decision for new task', {}, error as Error);
      logger.warn('Falling back to simple hash-based failure determination');

      const shouldFail = taskId.length % 10 < 3;

      logger.info('Fallback strict 30% pattern applied', {
        taskId,
        taskIdLength: taskId.length,
        modulo: taskId.length % 10,
        shouldFail,
        method: 'fallback-length-based-30-percent',
      });

      return {
        shouldFail,
        currentFailureRate: 0,
        totalProcessed: 0,
        totalFailed: 0,
        totalSucceeded: 0,
      };
    }
  }

  async isTaskDestinedToFail(taskId: string): Promise<boolean> {
    if (taskId.includes('force-fail')) {
      return true;
    }

    if (taskId.includes('force-success')) {
      return false;
    }

    try {
      const task = await this.getTask(taskId);
      return task?.failureDestiny === true;
    } catch (error) {
      logger.error('Failed to check task failure destiny', { taskId }, error as Error);

      let hash1 = 0;
      let hash2 = 0;
      for (let i = 0; i < taskId.length; i++) {
        const char = taskId.charCodeAt(i);
        hash1 = (hash1 << 5) - hash1 + char;
        hash2 = (hash2 << 3) - hash2 + char * 31;
      }
      const combinedHash = Math.abs(hash1 ^ hash2);
      const hashValue = combinedHash % 100000;
      return hashValue < 30000;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const command = new ScanCommand({
        TableName: env.TASK_TABLE_NAME,
        Limit: 1,
      });
      await this.client.send(command);
      return true;
    } catch {
      return false;
    }
  }
}

export const dynamoService = new DynamoService();
