import { logger } from '@/utils/logger';
import { badRequestResponse } from '@/utils/response';
import middy from '@middy/core';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';

export interface ExtendedAPIGatewayProxyEvent extends APIGatewayProxyEvent {
  parsedBody?: unknown;
  validatedBody?: unknown;
}

export interface ValidationError extends Error {
  statusCode?: number;
}

export interface TaskSubmissionData {
  taskId: string;
  payload: Record<string, unknown>;
}

export function requestValidation<T>(
  schema: z.ZodSchema<T>
): middy.MiddlewareObj<APIGatewayProxyEvent, APIGatewayProxyResult> {
  return {
    before: async request => {
      try {
        const event = request.event;

        if (event.httpMethod === 'OPTIONS') {
          return;
        }

        if (!event.body) {
          logger.warn('Missing request body');
          const error: ValidationError = new Error('Request body is required');
          error.statusCode = 400;
          throw error;
        }

        let parsedBody: unknown;

        if (typeof event.body === 'string') {
          try {
            parsedBody = JSON.parse(event.body);
          } catch (parseError) {
            logger.warn('Invalid JSON in request body', {
              error: (parseError as Error).message,
              body: typeof event.body === 'string' ? event.body.substring(0, 100) : '[object]',
            });

            const error: ValidationError = new Error('Invalid JSON in request body');
            error.statusCode = 400;
            throw error;
          }
        } else {
          parsedBody = event.body;
        }

        const validatedData = schema.parse(parsedBody);
        (event as ExtendedAPIGatewayProxyEvent).validatedBody = validatedData;

        logger.debug('Request validation successful', {
          httpMethod: event.httpMethod,
          path: event.path,
          taskId: (validatedData as TaskSubmissionData).taskId,
        });
      } catch (error) {
        logger.warn('Request validation failed', {
          httpMethod: request.event.httpMethod,
          path: request.event.path,
          error: error instanceof z.ZodError ? error.errors : (error as Error).message,
        });

        if (error instanceof z.ZodError) {
          const firstError = error.errors[0];
          const errorMessage = firstError?.message || 'Validation failed';
          const field = firstError?.path.join('.') || 'unknown';

          const validationError: ValidationError = new Error(
            `Validation error in ${field}: ${errorMessage}`
          );
          validationError.statusCode = 400;
          throw validationError;
        }

        if (!(error as ValidationError).statusCode) {
          (error as ValidationError).statusCode = 400;
        }

        throw error;
      }
    },
  };
}

export function responseValidation<T>(
  schema: z.ZodSchema<T>
): middy.MiddlewareObj<APIGatewayProxyEvent, APIGatewayProxyResult> {
  return {
    after: async request => {
      try {
        if (request.response?.body) {
          const parsedResponse = JSON.parse(request.response.body);
          schema.parse(parsedResponse);

          logger.debug('Response validation successful', {
            statusCode: request.response.statusCode,
          });
        }
      } catch (error) {
        logger.error('Response validation failed', {
          statusCode: request.response?.statusCode,
          error: error instanceof z.ZodError ? error.errors : (error as Error).message,
          response:
            typeof request.response?.body === 'string'
              ? request.response.body.substring(0, 200)
              : '[object]',
        });

        if (process.env.NODE_ENV === 'development') {
          throw new Error(`Response validation failed: ${(error as Error).message}`);
        }
      }
    },
  };
}

export const validationErrorHandler: middy.MiddlewareObj<
  APIGatewayProxyEvent,
  APIGatewayProxyResult
> = {
  onError: async request => {
    const error = request.error as Error & { statusCode?: number };

    if (
      error.statusCode === 400 ||
      error.message.includes('Validation error') ||
      error.message.includes('Request body is required') ||
      error.message.includes('Invalid JSON')
    ) {
      logger.warn('Validation error caught by middleware', {
        error: error.message,
        statusCode: error.statusCode,
        httpMethod: request.event.httpMethod,
        path: request.event.path,
      });

      request.response = badRequestResponse(error.message);
      return;
    }
  },
};
