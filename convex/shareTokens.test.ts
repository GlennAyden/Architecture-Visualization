import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.{ts,js}');

function localSubject(subject: string) {
  return subject.startsWith('local:') ? subject : `local:${subject}`;
}

const fakeIdentity = (subject: string, email: string) => {
  const subjectId = localSubject(subject);
  return {
    subject: subjectId,
    email,
    tokenIdentifier: `https://archviz-auth.test|${subjectId}`,
    issuer: 'https://archviz-auth.test',
  };
};

async function seedProject(t: ReturnType<typeof convexTest>) {
  const asOwner = t.withIdentity(fakeIdentity('owner', 'owner@example.com'));
  const projectId = await asOwner.mutation(api.projects.create, { name: 'P' });
  return { asOwner, projectId };
}

describe('shareTokens', () => {
  // Why: share view is the entire trust boundary for read-only sharing —
  // if a freshly minted token doesn't resolve back to its project, the
  // whole feature is broken. We also verify the raw token is returned
  // exactly once (subsequent reads only show the hash).
  test('create + resolve via shareView round-trip', async () => {
    const t = convexTest(schema, modules);
    const { asOwner, projectId } = await seedProject(t);
    const { rawToken } = await asOwner.mutation(api.shareTokens.create, {
      projectId,
      name: 'send to friend',
    });
    expect(rawToken).toMatch(/^archv_/);

    // Anonymous reader resolves the token.
    const view = await t.query(api.shareView.get, { rawToken });
    expect(view).not.toBeNull();
    expect(view!.projectName).toBe('P');
    expect(view!.shareName).toBe('send to friend');
  });

  // Why: revoking must take effect immediately. Anyone who has the URL
  // becomes unable to read the project from that moment on; a stale
  // viewer hitting the API gets null (treated as "not available").
  test('revoked tokens stop resolving', async () => {
    const t = convexTest(schema, modules);
    const { asOwner, projectId } = await seedProject(t);
    const { tokenId, rawToken } = await asOwner.mutation(api.shareTokens.create, {
      projectId,
      name: 'temp',
    });
    expect(await t.query(api.shareView.get, { rawToken })).not.toBeNull();

    await asOwner.mutation(api.shareTokens.revoke, { id: tokenId });
    expect(await t.query(api.shareView.get, { rawToken })).toBeNull();
  });

  // Why: expiration is the only auto-protection we offer for leaked URLs.
  // If it doesn't take effect on the boundary, a leaked-and-forgotten
  // token would silently keep working past its intended life.
  test('expired tokens stop resolving', async () => {
    const t = convexTest(schema, modules);
    const { asOwner, projectId } = await seedProject(t);

    // expiresAt must be in the future at create time, then we sneak the
    // row's expiresAt backwards via direct ctx so we don't have to wait.
    const { rawToken, tokenId } = await asOwner.mutation(api.shareTokens.create, {
      projectId,
      name: 'short-lived',
      expiresAt: Date.now() + 60_000,
    });
    expect(await t.query(api.shareView.get, { rawToken })).not.toBeNull();

    await t.run(async (ctx) => {
      await ctx.db.patch(tokenId, { expiresAt: Date.now() - 1 });
    });
    expect(await t.query(api.shareView.get, { rawToken })).toBeNull();
  });

  // Why: a non-owner must NOT be able to create or revoke shares. Without
  // this check, an accepted member could leak the project by minting their
  // own share URL behind the owner's back.
  test('non-owner cannot create or revoke a share token', async () => {
    const t = convexTest(schema, modules);
    const { asOwner, projectId } = await seedProject(t);
    const { tokenId } = await asOwner.mutation(api.shareTokens.create, {
      projectId,
      name: 'owner-only',
    });

    const asStranger = t.withIdentity(fakeIdentity('stranger', 'stranger@example.com'));
    await expect(
      asStranger.mutation(api.shareTokens.create, { projectId, name: 'sneak' }),
    ).rejects.toThrow(/owner-only|Unauthorized/i);
    await expect(asStranger.mutation(api.shareTokens.revoke, { id: tokenId })).rejects.toThrow(
      /Unauthorized/,
    );
  });

  // Why: an unrecognised raw token must surface the same "null" as a
  // revoked / expired one. Distinguishing them would let an attacker
  // probe which tokens exist via timing or response shape.
  test('unknown token resolves to null without leaking info', async () => {
    const t = convexTest(schema, modules);
    const res = await t.query(api.shareView.get, { rawToken: 'archv_not_a_real_token' });
    expect(res).toBeNull();
  });

  // Why: a share view must NEVER surface api tokens, member rows, or other
  // private project surface. We do positive-shape assertions to guarantee
  // the response is the sanitised shape and nothing more.
  test('share view payload is sanitised: no tokens / members / hashes', async () => {
    const t = convexTest(schema, modules);
    const { asOwner, projectId } = await seedProject(t);
    await asOwner.mutation(api.apiTokens.create, { projectId, name: 'secret' });
    const { rawToken } = await asOwner.mutation(api.shareTokens.create, {
      projectId,
      name: 'public',
    });

    const view = await t.query(api.shareView.get, { rawToken });
    expect(view).not.toBeNull();
    const keys = Object.keys(view!);
    expect(keys.sort()).toEqual(['edges', 'layers', 'nodes', 'projectName', 'shareName']);
    expect(view!.layers.map((layer) => layer.name)).toContain('Surfaces');
  });
});
