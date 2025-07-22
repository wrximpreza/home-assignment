import { z } from 'zod';

export const SubmitTaskRequestDto = z.object({
  taskId: z
    .string()
    .min(1, 'Task ID is required')
    .max(255, 'Task ID must be less than 255 characters')
    .regex(
      /^[a-zA-Z0-9-_]+$/,
      'Task ID can only contain alphanumeric characters, hyphens, and underscores'
    ),
  payload: z.record(z.unknown()).refine(
    (payload: Record<string, unknown>) => {
      const payloadSize = JSON.stringify(payload).length;
      return payloadSize <= 256 * 1024;
    },
    {
      message: 'Payload size must be less than 256KB',
    }
  ),
});

export const TaskSubmissionResponseDto = z.object({
  success: z.boolean(),
  data: z.object({
    taskId: z.string(),
    status: z.enum(['queued']),
    message: z.string(),
  }),
  timestamp: z.string(),
});

export type SubmitTaskRequest = z.infer<typeof SubmitTaskRequestDto>;
export type TaskSubmissionResponse = z.infer<typeof TaskSubmissionResponseDto>;
