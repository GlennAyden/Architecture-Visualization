// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createLocalAuthStore } from './auth-store.js';

describe('local auth store', () => {
  const tempDirs: string[] = [];
  const stores: Array<{ close(): void }> = [];

  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.close();
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function dbPath() {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'arch-viz-auth-'));
    tempDirs.push(dir);
    return path.join(dir, 'auth.sqlite');
  }

  test('creates only the first local admin user because setup must close after bootstrap', async () => {
    const store = createLocalAuthStore({ dbPath: dbPath() });
    stores.push(store);

    expect(store.hasUsers()).toBe(false);
    const user = await store.createFirstUser({
      email: ' Glenn@Example.COM ',
      password: 'super-secret',
    });

    expect(user.email).toBe('glenn@example.com');
    expect(store.hasUsers()).toBe(true);
    await expect(
      store.createFirstUser({ email: 'second@example.com', password: 'super-secret' }),
    ).rejects.toThrow(/already exists/i);
  });

  test('creates sessions only for a valid password so stolen emails are not enough', async () => {
    const store = createLocalAuthStore({ dbPath: dbPath() });
    stores.push(store);
    await store.createFirstUser({ email: 'glenn@example.com', password: 'super-secret' });

    await expect(
      store.createSession({ email: 'glenn@example.com', password: 'wrong-password' }),
    ).resolves.toBeNull();

    const session = await store.createSession({
      email: 'GLENN@example.com',
      password: 'super-secret',
    });

    expect(session?.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(session?.user.email).toBe('glenn@example.com');
    expect(store.getSession(session!.token)?.user.email).toBe('glenn@example.com');
  });

  test('rejects expired sessions so old browser cookies cannot mint Convex JWTs', async () => {
    let now = Date.UTC(2026, 0, 1);
    const store = createLocalAuthStore({
      dbPath: dbPath(),
      now: () => now,
      sessionDays: 1,
    });
    stores.push(store);
    await store.createFirstUser({ email: 'glenn@example.com', password: 'super-secret' });
    const session = await store.createSession({
      email: 'glenn@example.com',
      password: 'super-secret',
    });

    now += 24 * 60 * 60 * 1000 + 1;

    expect(store.getSession(session!.token)).toBeNull();
  });

  test('deletes sessions so logout revokes the current cookie token', async () => {
    const store = createLocalAuthStore({ dbPath: dbPath() });
    stores.push(store);
    await store.createFirstUser({ email: 'glenn@example.com', password: 'super-secret' });
    const session = await store.createSession({
      email: 'glenn@example.com',
      password: 'super-secret',
    });

    expect(store.getSession(session!.token)).not.toBeNull();
    store.deleteSession(session!.token);

    expect(store.getSession(session!.token)).toBeNull();
  });
});
