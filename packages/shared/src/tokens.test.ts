import { describe, expect, test } from 'vitest';
import { tokenNameSchema } from './tokens';

describe('tokenNameSchema', () => {
  test('accepts a normal label', () => {
    expect(tokenNameSchema.parse('Claude Code laptop')).toBe('Claude Code laptop');
  });

  test('trims surrounding whitespace', () => {
    expect(tokenNameSchema.parse('  laptop  ')).toBe('laptop');
  });

  test('rejects empty', () => {
    expect(() => tokenNameSchema.parse('   ')).toThrow(/Token name is required/);
  });

  test('rejects names longer than 80 chars', () => {
    expect(() => tokenNameSchema.parse('a'.repeat(81))).toThrow(/80 characters/);
  });
});
