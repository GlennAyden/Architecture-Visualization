import { describe, expect, test } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const valid = {
  ARCHITECTURE_CONVEX_URL: 'https://dazzling-seahorse-444.convex.site',
  ARCHITECTURE_API_KEY: 'archv_abc',
  ARCHITECTURE_PROJECT_ID: 'projects:abc',
};

describe('loadConfig', () => {
  test('returns config for a valid env', () => {
    expect(loadConfig(valid)).toEqual({
      convexUrl: 'https://dazzling-seahorse-444.convex.site',
      apiKey: 'archv_abc',
      projectId: 'projects:abc',
    });
  });

  test('strips trailing slash from convexUrl', () => {
    const cfg = loadConfig({ ...valid, ARCHITECTURE_CONVEX_URL: 'https://x.convex.site/' });
    expect(cfg.convexUrl).toBe('https://x.convex.site');
  });

  test('rejects missing URL', () => {
    expect(() => loadConfig({ ...valid, ARCHITECTURE_CONVEX_URL: undefined })).toThrow(ConfigError);
  });

  test('rejects invalid URL', () => {
    expect(() => loadConfig({ ...valid, ARCHITECTURE_CONVEX_URL: 'not a url' })).toThrow(
      /not a valid URL/,
    );
  });

  test('rejects non-http(s) protocol', () => {
    expect(() => loadConfig({ ...valid, ARCHITECTURE_CONVEX_URL: 'ftp://x.com' })).toThrow(
      /must use http or https/,
    );
  });

  test('rejects .convex.cloud (common mistake)', () => {
    expect(() =>
      loadConfig({
        ...valid,
        ARCHITECTURE_CONVEX_URL: 'https://dazzling-seahorse-444.convex.cloud',
      }),
    ).toThrow(/\.convex\.site, not \.convex\.cloud/);
  });

  test('rejects missing API key', () => {
    expect(() => loadConfig({ ...valid, ARCHITECTURE_API_KEY: undefined })).toThrow(
      /API_KEY is required/,
    );
  });

  test('rejects API key without archv_ prefix', () => {
    expect(() => loadConfig({ ...valid, ARCHITECTURE_API_KEY: 'wrong' })).toThrow(
      /prefix "archv_"/,
    );
  });

  test('rejects missing project id', () => {
    expect(() => loadConfig({ ...valid, ARCHITECTURE_PROJECT_ID: undefined })).toThrow(
      /PROJECT_ID is required/,
    );
  });

  test('trims whitespace from each var', () => {
    const cfg = loadConfig({
      ARCHITECTURE_CONVEX_URL: '  https://x.convex.site  ',
      ARCHITECTURE_API_KEY: '  archv_z  ',
      ARCHITECTURE_PROJECT_ID: '  projects:z  ',
    });
    expect(cfg).toEqual({
      convexUrl: 'https://x.convex.site',
      apiKey: 'archv_z',
      projectId: 'projects:z',
    });
  });
});
