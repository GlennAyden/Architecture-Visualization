import { z } from 'zod';

export const tokenNameSchema = z
  .string()
  .trim()
  .min(1, 'Token name is required')
  .max(80, 'Token name must be 80 characters or fewer');

export type TokenName = z.infer<typeof tokenNameSchema>;
