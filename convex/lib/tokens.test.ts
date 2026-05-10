import { describe, expect, test } from 'vitest';
import { generateRawToken, hashToken, TOKEN_PREFIX } from './tokens';

describe('generateRawToken', () => {
  test('returns a string starting with the archv_ prefix', () => {
    const tok = generateRawToken();
    expect(tok.startsWith(TOKEN_PREFIX)).toBe(true);
  });

  test('produces unique values across calls', () => {
    const tokens = new Set();
    for (let i = 0; i < 100; i++) tokens.add(generateRawToken());
    expect(tokens.size).toBe(100);
  });

  test('payload is base64url and at least 40 chars', () => {
    const tok = generateRawToken();
    const payload = tok.slice(TOKEN_PREFIX.length);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(payload.length).toBeGreaterThanOrEqual(40);
  });
});

describe('hashToken', () => {
  test('returns a deterministic 64-char hex string', async () => {
    const a = await hashToken('archv_abc');
    const b = await hashToken('archv_abc');
    expect(a).toEqual(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test('different inputs produce different hashes', async () => {
    const a = await hashToken('archv_a');
    const b = await hashToken('archv_b');
    expect(a).not.toEqual(b);
  });
});
