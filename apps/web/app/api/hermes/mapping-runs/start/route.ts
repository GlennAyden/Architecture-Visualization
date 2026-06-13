import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { createHash, randomBytes } from 'node:crypto';

import { api } from '../../../../../../../convex/_generated/api';
import type { Id } from '../../../../../../../convex/_generated/dataModel';
import { callAuthBackend, getSessionTokenFromCookie } from '@/lib/auth/proxy';

export const runtime = 'nodejs';

interface StartMappingBody {
  projectId?: string;
  scope?: 'orphans' | 'project';
}

function convexSiteUrl(convexUrl: string) {
  return process.env.ARCHVIZ_CONVEX_SITE_URL ?? convexUrl.replace('.convex.cloud', '.convex.site');
}

function generateSubmitToken() {
  return `archv_run_${randomBytes(32).toString('base64url')}`;
}

function hashSubmitToken(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as StartMappingBody;
  const projectId = body.projectId?.trim();
  const scope = body.scope ?? 'orphans';

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }

  const sessionToken = await getSessionTokenFromCookie();
  const tokenResult = await callAuthBackend('/auth/convex-token', { sessionToken });
  if (tokenResult.status !== 200 || !tokenResult.data.token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return NextResponse.json({ error: 'Convex URL is not configured' }, { status: 503 });
  }

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(tokenResult.data.token);

  const submitToken = generateSubmitToken();
  const run = await client.mutation(api.hermesMappingRuns.start, {
    projectId: projectId as Id<'projects'>,
    source: 'canvas',
    scope,
    submitTokenHash: hashSubmitToken(submitToken),
  });

  try {
    const context = await client.query(api.hermesMappingRuns.buildContext, {
      projectId: projectId as Id<'projects'>,
      runId: run.runId,
    });
    const backendResult = await callAuthBackend('/hermes/mapping-runs/start', {
      runId: run.runId,
      submitToken,
      convexSiteUrl: convexSiteUrl(convexUrl),
      context,
    });

    if (backendResult.status < 200 || backendResult.status >= 300) {
      const message = backendResult.data.error ?? 'Hermes backend handoff failed';
      await client.mutation(api.hermesMappingRuns.markFailed, {
        runId: run.runId,
        errorMessage: message,
      });
      return NextResponse.json({ error: message, runId: run.runId }, { status: 502 });
    }

    await client.mutation(api.hermesMappingRuns.markRunning, { runId: run.runId });
    return NextResponse.json({ runId: run.runId, status: 'queued' }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Hermes mapping could not start';
    await client.mutation(api.hermesMappingRuns.markFailed, {
      runId: run.runId,
      errorMessage: message,
    });
    return NextResponse.json({ error: message, runId: run.runId }, { status: 502 });
  }
}
