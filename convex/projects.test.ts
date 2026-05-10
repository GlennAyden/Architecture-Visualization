import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

// pnpm's nested node_modules confuses convex-test's auto-discovery; provide
// modules explicitly via Vite's `import.meta.glob`. Must include _generated.
const modules = import.meta.glob('./**/*.{ts,js}');

describe('projects', () => {
  test('list returns empty array for unauthenticated user', async () => {
    const t = convexTest(schema, modules);
    const result = await t.query(api.projects.list);
    expect(result).toEqual([]);
  });
});
