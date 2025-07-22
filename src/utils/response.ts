import { APIGatewayProxyResult } from 'aws-lambda';

import { ApiResponse } from '@/types';

export const HttpStatusCode = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const commonHeaders = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  ...corsHeaders,
};

function createApiResponse<T>(
  success: boolean,
  statusCode: number,
  data?: T,
  error?: string,
  message?: string
): ApiResponse<T> {
  return {
    success,
    data,
    error,
    message,
    timestamp: new Date().toISOString(),
  };
}

export function successResponse<T>(
  data: T,
  statusCode: number = HttpStatusCode.OK,
  message?: string
): APIGatewayProxyResult {
  const response = createApiResponse(true, statusCode, data, undefined, message);

  return {
    statusCode,
    headers: commonHeaders,
    body: JSON.stringify(response),
  };
}

export function createdResponse<T>(data: T, message?: string): APIGatewayProxyResult {
  return successResponse(data, HttpStatusCode.CREATED, message);
}

export function errorResponse(
  error: string,
  statusCode: number = HttpStatusCode.INTERNAL_SERVER_ERROR,
  details?: unknown
): APIGatewayProxyResult {
  const response = createApiResponse(false, statusCode, details, error);

  return {
    statusCode,
    headers: commonHeaders,
    body: JSON.stringify(response),
  };
}

export function badRequestResponse(error: string, details?: unknown): APIGatewayProxyResult {
  return errorResponse(error, HttpStatusCode.BAD_REQUEST, details);
}

export function handleError(error: unknown): APIGatewayProxyResult {
  if (error instanceof Error) {
    if (error.name === 'ValidationError') {
      return badRequestResponse(error.message);
    }
    return errorResponse(error.message);
  }
  return errorResponse('An unexpected error occurred');
}

export function getCorrelationId(headers: Record<string, string | undefined>): string {
  return (
    headers['x-correlation-id'] ||
    headers['X-Correlation-ID'] ||
    `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
  );
}
