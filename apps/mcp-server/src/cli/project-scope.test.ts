import { describe, expect, test } from 'vitest';
import { ConfigError, type McpConfig } from '../config.js';
import { assertProjectScope } from './project-scope.js';

const baseConfig: McpConfig = {
  convexUrl: 'https://x.convex.site',
  apiKey: 'archv_test',
  projectId: 'projects:prod',
};

describe('assertProjectScope', () => {
  test('accepts a token whose server scope matches the configured project', () => {
    // WHY: scan commands write through the token's server-side scope, not by
    // trusting local env alone. This assertion keeps the local project id and
    // token scope from silently diverging.
    expect(() =>
      assertProjectScope(baseConfig, {
        projectId: 'projects:prod',
        projectName: 'expandly.id',
        tokenName: 'production scanner',
      }),
    ).not.toThrow();
  });

  test('rejects when ARCHITECTURE_PROJECT_ID and token scope point to different projects', () => {
    expect(() =>
      assertProjectScope(baseConfig, {
        projectId: 'projects:test',
        projectName: 'Test 1',
      }),
    ).toThrow(ConfigError);
  });

  test('rejects when an explicit expected production project name does not match', () => {
    expect(() =>
      assertProjectScope(
        { ...baseConfig, expectedProjectName: 'expandly.id' },
        {
          projectId: 'projects:prod',
          projectName: 'Test 1',
        },
      ),
    ).toThrow(/expected project name/);
  });

  test('rejects when an explicit expected production project id does not match', () => {
    expect(() =>
      assertProjectScope(
        { ...baseConfig, expectedProjectId: 'projects:expandly' },
        {
          projectId: 'projects:prod',
          projectName: 'expandly.id',
        },
      ),
    ).toThrow(/expected project id/);
  });
});
