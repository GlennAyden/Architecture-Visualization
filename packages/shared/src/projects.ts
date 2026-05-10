import { z } from 'zod';

export const projectNameSchema = z
  .string()
  .trim()
  .min(1, 'Project name is required')
  .max(80, 'Project name must be 80 characters or fewer');

export type ProjectName = z.infer<typeof projectNameSchema>;

export const projectSlugSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, digits, and hyphens')
  .min(1)
  .max(80);

/**
 * Generates a URL-safe slug from a project name.
 * Used to keep slug generation logic identical across web (form) and Convex (mutation).
 */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
