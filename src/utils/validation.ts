import { constants } from '@/config';

export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export const validateTaskId = (taskId: string): void => {
  if (!taskId || typeof taskId !== 'string') {
    throw new ValidationError('Task ID is required and must be a string', 'taskId');
  }

  if (taskId.length === 0) {
    throw new ValidationError('Task ID cannot be empty', 'taskId');
  }

  if (taskId.length > constants.MAX_TASK_ID_LENGTH) {
    throw new ValidationError(
      `Task ID cannot exceed ${constants.MAX_TASK_ID_LENGTH} characters`,
      'taskId'
    );
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) {
    throw new ValidationError(
      'Task ID can only contain alphanumeric characters, hyphens, and underscores',
      'taskId'
    );
  }
};

export const validatePayload = (payload: unknown): void => {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Payload is required and must be an object', 'payload');
  }

  const payloadSize = JSON.stringify(payload).length;

  if (payloadSize > constants.MAX_PAYLOAD_SIZE) {
    throw new ValidationError(
      `Payload size (${payloadSize} bytes) exceeds maximum allowed size (${constants.MAX_PAYLOAD_SIZE} bytes)`,
      'payload'
    );
  }
};

export const validateFailureRate = (rate: number): void => {
  if (typeof rate !== 'number' || isNaN(rate)) {
    throw new ValidationError('Failure rate must be a valid number', 'failureRate');
  }

  if (rate < 0 || rate > 1) {
    throw new ValidationError('Failure rate must be between 0 and 1', 'failureRate');
  }
};

export const sanitizeInput = (input: string): string => {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim();
};

export const isValidUUID = (uuid: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

export const validateEnvironmentVariable = (name: string, value: string | undefined): string => {
  if (!value || value.trim() === '') {
    throw new ValidationError(`Environment variable ${name} is required but not set`);
  }
  return value.trim();
};
