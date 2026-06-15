import { NextRequest, NextResponse } from 'next/server';

import { callAuthBackend, getSessionTokenFromCookie } from '@/lib/auth/proxy';

export const runtime = 'nodejs';

type RescanJobStatus = 'queued' | 'running' | 'completed' | 'failed';

interface RescanJob {
  jobId: string;
  projectId: string;
  status: RescanJobStatus;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  errorMessage?: string;
  steps: Array<{
    name: string;
    status: 'completed' | 'failed';
    exitCode: number | null;
    durationMs: number;
    output?: string;
  }>;
}

interface RescanResponse {
  ok?: boolean;
  error?: string;
  job?: RescanJob | null;
}

async function requireLocalSession() {
  const sessionToken = await getSessionTokenFromCookie();
  const tokenResult = await callAuthBackend('/auth/convex-token', { sessionToken });
  return tokenResult.status === 200 && Boolean(tokenResult.data.token);
}

function projectIdFromBody(body: unknown) {
  if (!body || typeof body !== 'object') return '';
  const projectId = (body as { projectId?: unknown }).projectId;
  return typeof projectId === 'string' ? projectId.trim() : '';
}

export async function POST(req: NextRequest) {
  if (!(await requireLocalSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const projectId = projectIdFromBody(body);
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }

  const result = await callAuthBackend<RescanResponse>('/scans/rescan', { projectId });
  return NextResponse.json(result.data, { status: result.status });
}

export async function GET(req: NextRequest) {
  if (!(await requireLocalSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get('projectId')?.trim();
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }

  const result = await callAuthBackend<RescanResponse>('/scans/rescan/status', { projectId });
  return NextResponse.json(result.data, { status: result.status });
}
