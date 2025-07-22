import { Logger } from '@aws-lambda-powertools/logger';
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const logger = new Logger({ serviceName: 'idempotency-middleware' });

interface IdempotencyRecord {
  id: string;
  response: APIGatewayProxyResult;
  requestHash: string;
  expiration: number;
  createdAt: string;
}

interface IdempotencyOptions {
  tableName: string;
  expirationMinutes?: number;
  keyExtractor?: (event: APIGatewayProxyEvent) => string | null;
  requestHasher?: (event: APIGatewayProxyEvent) => string;
}

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });

const defaultKeyExtractor = (event: APIGatewayProxyEvent): string | null => {
  try {
    const body = JSON.parse(event.body || '{}');
    return body.taskId || null;
  } catch {
    return null;
  }
};

const defaultRequestHasher = (event: APIGatewayProxyEvent): string => {
  const body = event.body || '';
  let hash = 0;
  for (let i = 0; i < body.length; i++) {
    const char = body.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString();
};

export const idempotencyMiddleware = (options: IdempotencyOptions) => {
  const {
    tableName,
    expirationMinutes = 60,
    keyExtractor = defaultKeyExtractor,
    requestHasher = defaultRequestHasher,
  } = options;

  return {
    before: async (request: any) => {
      logger.info('Idempotency middleware - before hook called');

      const event: APIGatewayProxyEvent = request.event;

      const idempotencyKey = keyExtractor(event);
      logger.info('Idempotency key extracted', { idempotencyKey });

      if (!idempotencyKey) {
        logger.info('No idempotency key found, continuing normally');

        return;
      }

      const requestHash = requestHasher(event);

      try {
        const getCommand = new GetItemCommand({
          TableName: tableName,
          Key: marshall({ id: idempotencyKey }),
        });

        const result = await dynamoClient.send(getCommand);

        if (result.Item) {
          const record = unmarshall(result.Item) as IdempotencyRecord;

          if (Date.now() > record.expiration) {
            logger.info('Idempotency record expired, proceeding with new request', {
              idempotencyKey,
              expiredAt: new Date(record.expiration).toISOString(),
            });

            return;
          }

          if (record.requestHash !== requestHash) {
            logger.warn('Idempotency key reused with different request payload', {
              idempotencyKey,
              originalHash: record.requestHash,
              currentHash: requestHash,
            });

            const errorResponse: APIGatewayProxyResult = {
              statusCode: 422,
              headers: {
                'Content-Type': 'application/json',
                'X-Idempotency-Key': idempotencyKey,
              },
              body: JSON.stringify({
                error: 'Idempotency key conflict',
                message: 'The same idempotency key was used with a different request payload',
                idempotencyKey,
              }),
            };

            return errorResponse;
          }

          logger.info('Returning cached idempotent response', {
            idempotencyKey,
            cachedAt: record.createdAt,
          });

          return {
            ...record.response,
            headers: {
              ...record.response.headers,
              'X-Idempotency-Key': idempotencyKey,
              'X-Idempotency-Cached': 'true',
            },
          };
        }

        request.internal = request.internal || {};
        request.internal.idempotencyKey = idempotencyKey;
        request.internal.requestHash = requestHash;
      } catch (error) {
        logger.error('Error checking idempotency cache', {
          idempotencyKey,
          error: (error as Error).message,
        });
      }
    },

    after: async (request: any) => {
      logger.info('Idempotency middleware - after hook called');

      const idempotencyKey = request.internal?.idempotencyKey;
      const requestHash = request.internal?.requestHash;

      logger.info('After hook data', {
        idempotencyKey,
        requestHash,
        hasResponse: !!request.response,
      });

      if (!idempotencyKey || !request.response) {
        logger.info('No idempotency key or response, skipping cache storage');
        return;
      }

      try {
        const expirationTime = Date.now() + expirationMinutes * 60 * 1000;

        const record: IdempotencyRecord = {
          id: idempotencyKey,
          response: request.response,
          requestHash,
          expiration: expirationTime,
          createdAt: new Date().toISOString(),
        };

        const putCommand = new PutItemCommand({
          TableName: tableName,
          Item: marshall(record),
          ConditionExpression: 'attribute_not_exists(id)',
        });

        await dynamoClient.send(putCommand);

        logger.info('Stored idempotency record', {
          idempotencyKey,
          expiresAt: new Date(expirationTime).toISOString(),
        });

        if (request.response.headers) {
          request.response.headers['X-Idempotency-Key'] = idempotencyKey;
        } else {
          request.response.headers = { 'X-Idempotency-Key': idempotencyKey };
        }
      } catch (error) {
        if ((error as any).name === 'ConditionalCheckFailedException') {
          logger.info('Idempotency record already exists (race condition)', { idempotencyKey });
        } else {
          logger.error('Error storing idempotency record', {
            idempotencyKey,
            error: (error as Error).message,
          });
        }
      }
    },

    onError: async (request: any) => {
      logger.debug('Not caching error response for idempotency', {
        idempotencyKey: request.internal?.idempotencyKey,
      });
    },
  };
};
