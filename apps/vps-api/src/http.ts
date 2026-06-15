import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import { createLocalAuthStore, type LocalAuthStore, type LocalSession } from './auth-store.js';
import {
  heuristicHermesMapper,
  type HermesMapper,
  type HermesMappingContext,
  type HermesRelationshipSuggestion,
  type HermesMappingSuggestion,
  type HermesSemanticNodeSuggestion,
  type HermesArchitectureFlowSuggestion,
} from './hermes-mapper.js';
import { signLocalConvexToken } from './jwt.js';

const DEFAULT_SESSION_DAYS = 30;
const DEFAULT_PORT = 8788;

interface PublicUser {
  id: string;
  email: string;
}

export interface VpsApiOptions {
  store?: LocalAuthStore;
  proxyToken: string;
  jwtPrivateKey: string;
  jwtIssuer: string;
  jwtAudience: string;
  hermesMapper?: HermesMapper;
  scanCommandRunner?: ScanCommandRunner;
  fetchImpl?: typeof fetch;
}

interface SessionBody {
  sessionToken?: string;
}

interface CredentialsBody {
  email?: string;
  password?: string;
}

interface HermesMappingStartBody {
  runId: string;
  submitToken: string;
  convexSiteUrl: string;
  context: HermesMappingContext;
}

export type RescanJobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type RescanStepName =
  | 'scan-orphans-initial'
  | 'scan-imports'
  | 'scan-orphans-final'
  | 'scan-drift';

interface RescanBody {
  projectId: string;
}

interface RescanStepResult {
  name: RescanStepName;
  status: 'completed' | 'failed';
  exitCode: number | null;
  durationMs: number;
  output?: string;
}

interface RescanJobState {
  jobId: string;
  projectId: string;
  status: RescanJobStatus;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  errorMessage?: string;
  steps: RescanStepResult[];
}

export type ScanCommandRunner = (
  step: RescanStepName,
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  },
) => Promise<RescanStepResult>;

function publicUser(session: LocalSession): PublicUser {
  return {
    id: session.user.id,
    email: session.user.email,
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function isAuthorized(req: IncomingMessage, proxyToken: string): boolean {
  return req.headers.authorization === `Bearer ${proxyToken}`;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function credentialsFromBody(body: Record<string, unknown>): Required<CredentialsBody> {
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email.trim() || !password) throw new Error('Email and password are required');
  return { email, password };
}

function sessionTokenFromBody(body: SessionBody): string | null {
  return typeof body.sessionToken === 'string' && body.sessionToken ? body.sessionToken : null;
}

function hermesMappingStartFromBody(body: Record<string, unknown>): HermesMappingStartBody {
  const runId = typeof body.runId === 'string' ? body.runId : '';
  const submitToken = typeof body.submitToken === 'string' ? body.submitToken : '';
  const convexSiteUrl = typeof body.convexSiteUrl === 'string' ? body.convexSiteUrl : '';
  const context = body.context;
  if (!runId || !submitToken || !convexSiteUrl) {
    throw new Error('runId, submitToken, and convexSiteUrl are required');
  }
  if (!context || typeof context !== 'object') {
    throw new Error('Hermes mapping context is required');
  }
  return { runId, submitToken, convexSiteUrl, context: context as HermesMappingContext };
}

function rescanBodyFromBody(body: Record<string, unknown>): RescanBody {
  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  if (!projectId) throw new Error('projectId is required');
  return { projectId };
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/archv_[A-Za-z0-9_-]+/g, '[redacted-token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, 1000);
}

function safeCommandOutput(value: string) {
  return safeErrorMessage(value).replace(/\s+/g, ' ').trim().slice(0, 800);
}

function resolveRescanRepoPath(env: NodeJS.ProcessEnv): string {
  const raw = env.ARCHITECTURE_REPO_PATH ?? env.ARCHVIZ_RESCAN_REPO_PATH;
  if (!raw?.trim()) {
    throw new Error('ARCHITECTURE_REPO_PATH is required before running a VPS rescan');
  }
  return resolve(raw.trim());
}

function assertRescanProjectScope(projectId: string, env: NodeJS.ProcessEnv) {
  const configuredProjectId = env.ARCHITECTURE_PROJECT_ID?.trim();
  if (!configuredProjectId) {
    throw new Error('ARCHITECTURE_PROJECT_ID is required before running a VPS rescan');
  }
  if (configuredProjectId !== projectId) {
    throw new Error('Rescan project does not match the configured VPS project guard');
  }
}

function resolveMcpInvocation(step: RescanStepName, env: NodeJS.ProcessEnv) {
  const subcommand =
    step === 'scan-imports'
      ? 'scan-imports'
      : step === 'scan-drift'
        ? 'scan-drift'
        : 'scan-orphans';
  const configuredBin = env.ARCHVIZ_MCP_BIN?.trim();
  if (configuredBin) {
    if (configuredBin.endsWith('.js')) {
      return { command: process.execPath, args: [configuredBin, subcommand] };
    }
    return { command: configuredBin, args: [subcommand] };
  }

  const localBin = resolve(process.cwd(), 'apps/mcp-server/dist/index.js');
  return { command: process.execPath, args: [localBin, subcommand] };
}

async function defaultScanCommandRunner(
  step: RescanStepName,
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  },
): Promise<RescanStepResult> {
  const startedAt = Date.now();
  if (!existsSync(options.cwd)) {
    throw new Error(`Rescan repo path does not exist: ${options.cwd}`);
  }

  return await new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      shell: false,
    });
    let output = '';
    const append = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.length > 4000) output = output.slice(output.length - 4000);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      resolvePromise({
        name: step,
        status: 'failed',
        exitCode: null,
        durationMs: Date.now() - startedAt,
        output: safeCommandOutput(error.message),
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const failed = timedOut || code !== 0;
      resolvePromise({
        name: step,
        status: failed ? 'failed' : 'completed',
        exitCode: code,
        durationMs: Date.now() - startedAt,
        output: safeCommandOutput(
          timedOut ? `Timed out after ${options.timeoutMs}ms. ${output}` : output,
        ),
      });
    });
  });
}

function summarizeMappingPayload(payload: {
  suggestions?: unknown[];
  semanticNodeSuggestions?: unknown[];
  relationshipSuggestions?: unknown[];
  flowSuggestions?: unknown[];
}) {
  return `suggestions=${payload.suggestions?.length ?? 0}, semantic=${payload.semanticNodeSuggestions?.length ?? 0}, relationships=${payload.relationshipSuggestions?.length ?? 0}, flows=${payload.flowSuggestions?.length ?? 0}`;
}

function assertConfidence(value: unknown, label: string) {
  if (typeof value !== 'number' || value < 0 || value > 1) {
    throw new Error(`${label} confidence must be between 0 and 1`);
  }
}

function validateMappingPayload(payload: {
  suggestions?: HermesMappingSuggestion[];
  semanticNodeSuggestions?: HermesSemanticNodeSuggestion[];
  relationshipSuggestions?: HermesRelationshipSuggestion[];
  flowSuggestions?: HermesArchitectureFlowSuggestion[];
}) {
  for (const [index, suggestion] of (payload.suggestions ?? []).entries()) {
    assertConfidence(suggestion.confidence, `suggestions[${index}]`);
  }
  for (const [index, suggestion] of (payload.semanticNodeSuggestions ?? []).entries()) {
    assertConfidence(suggestion.confidence, `semanticNodeSuggestions[${index}]`);
  }
  for (const [index, suggestion] of (payload.relationshipSuggestions ?? []).entries()) {
    assertConfidence(suggestion.confidence, `relationshipSuggestions[${index}]`);
  }
  for (const [index, flow] of (payload.flowSuggestions ?? []).entries()) {
    assertConfidence(flow.confidence, `flowSuggestions[${index}]`);
    if (!flow.title?.trim() || !flow.kind || flow.nodeIds.length < 2 || flow.steps.length < 1) {
      throw new Error(`flowSuggestions[${index}] is missing title, kind, nodes, or steps`);
    }
  }
}

async function submitMappingRunCompletion(
  fetchImpl: typeof fetch,
  job: HermesMappingStartBody,
  payload: {
    status: 'completed' | 'failed';
    errorMessage?: string;
    suggestions?: HermesMappingSuggestion[];
    semanticNodeSuggestions?: HermesSemanticNodeSuggestion[];
    relationshipSuggestions?: HermesRelationshipSuggestion[];
    flowSuggestions?: HermesArchitectureFlowSuggestion[];
  },
) {
  validateMappingPayload(payload);
  const url = new URL('/api/hermes/mapping-runs/complete', job.convexSiteUrl);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      runId: job.runId,
      submitToken: job.submitToken,
      status: payload.status,
      errorMessage: payload.errorMessage,
      suggestions: payload.suggestions ?? [],
      semanticNodeSuggestions: payload.semanticNodeSuggestions ?? [],
      relationshipSuggestions: payload.relationshipSuggestions ?? [],
      flowSuggestions: payload.flowSuggestions ?? [],
    }),
  });
  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    const safeText = safeErrorMessage(responseText).slice(0, 240);
    throw new Error(
      `Convex mapping submit failed (${response.status}); ${summarizeMappingPayload(payload)}${safeText ? `; ${safeText}` : ''}`,
    );
  }
}

export async function runHermesMappingJob(options: VpsApiOptions, job: HermesMappingStartBody) {
  const mapper = options.hermesMapper ?? heuristicHermesMapper;
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const result = await mapper(job.context);
    if (!Array.isArray(result.suggestions)) {
      throw new Error('Hermes mapper returned malformed suggestions');
    }
    if (
      result.semanticNodeSuggestions !== undefined &&
      !Array.isArray(result.semanticNodeSuggestions)
    ) {
      throw new Error('Hermes mapper returned malformed semantic node suggestions');
    }
    if (
      result.relationshipSuggestions !== undefined &&
      !Array.isArray(result.relationshipSuggestions)
    ) {
      throw new Error('Hermes mapper returned malformed relationship suggestions');
    }
    if (result.flowSuggestions !== undefined && !Array.isArray(result.flowSuggestions)) {
      throw new Error('Hermes mapper returned malformed flow suggestions');
    }
    await submitMappingRunCompletion(fetchImpl, job, {
      status: 'completed',
      suggestions: result.suggestions,
      semanticNodeSuggestions: result.semanticNodeSuggestions ?? [],
      relationshipSuggestions: result.relationshipSuggestions ?? [],
      flowSuggestions: result.flowSuggestions ?? [],
    });
  } catch (error) {
    await submitMappingRunCompletion(fetchImpl, job, {
      status: 'failed',
      errorMessage: safeErrorMessage(error),
    }).catch(() => undefined);
  }
}

async function runRescanJob(
  options: VpsApiOptions,
  job: RescanJobState,
  onUpdate: (next: RescanJobState) => void,
) {
  const runner = options.scanCommandRunner ?? defaultScanCommandRunner;
  const env = process.env;
  const timeoutMs = Number.parseInt(env.ARCHVIZ_RESCAN_STEP_TIMEOUT_MS ?? '', 10) || 15 * 60_000;
  const repoPath = resolveRescanRepoPath(env);
  const steps: RescanStepName[] = [
    'scan-orphans-initial',
    'scan-imports',
    'scan-orphans-final',
    'scan-drift',
  ];

  onUpdate({ ...job, status: 'running', updatedAt: Date.now() });

  for (const step of steps) {
    const invocation = resolveMcpInvocation(step, env);
    let result: RescanStepResult;
    try {
      result = await runner(step, invocation.command, invocation.args, {
        cwd: repoPath,
        env,
        timeoutMs,
      });
    } catch (error) {
      result = {
        name: step,
        status: 'failed',
        exitCode: null,
        durationMs: 0,
        output: safeErrorMessage(error),
      };
    }
    const next: RescanJobState = {
      ...job,
      status: result.status === 'failed' ? 'failed' : 'running',
      steps: [...job.steps, result],
      updatedAt: Date.now(),
      ...(result.status === 'failed'
        ? {
            completedAt: Date.now(),
            errorMessage: `${step} failed${result.output ? `: ${result.output}` : ''}`,
          }
        : {}),
    };
    job = next;
    onUpdate(next);
    if (result.status === 'failed') return;
  }

  onUpdate({
    ...job,
    status: 'completed',
    updatedAt: Date.now(),
    completedAt: Date.now(),
  });
}

function resolveStoreFromEnv(): LocalAuthStore {
  const dbPath = process.env.AUTH_SQLITE_PATH ?? '.data/auth.sqlite';
  const parsedSessionDays = Number(process.env.AUTH_SESSION_DAYS ?? DEFAULT_SESSION_DAYS);
  const sessionDays =
    Number.isFinite(parsedSessionDays) && parsedSessionDays > 0
      ? parsedSessionDays
      : DEFAULT_SESSION_DAYS;
  return createLocalAuthStore({ dbPath, sessionDays });
}

export function createVpsApiHandler(options: VpsApiOptions) {
  const store = options.store ?? resolveStoreFromEnv();
  const rescanJobs = new Map<string, RescanJobState>();

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';

    if (method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'arch-viz-vps-api',
        authConfigured: Boolean(options.proxyToken),
        jwtConfigured: Boolean(options.jwtPrivateKey),
        setupRequired: !store.hasUsers(),
      });
      return;
    }

    if (!isAuthorized(req, options.proxyToken)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    if (method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      const body = await readJson(req);

      if (url.pathname === '/auth/setup') {
        if (store.hasUsers()) {
          sendJson(res, 409, { error: 'A local user already exists' });
          return;
        }

        const credentials = credentialsFromBody(body);
        await store.createFirstUser(credentials);
        const session = await store.createSession(credentials);
        if (!session) {
          sendJson(res, 500, { error: 'Could not create local session' });
          return;
        }

        sendJson(res, 200, {
          setupRequired: false,
          sessionToken: session.token,
          expiresAt: session.expiresAt,
          user: publicUser(session),
        });
        return;
      }

      if (url.pathname === '/auth/login') {
        if (!store.hasUsers()) {
          sendJson(res, 409, { error: 'Local setup is required first', setupRequired: true });
          return;
        }

        const session = await store.createSession(credentialsFromBody(body));
        if (!session) {
          sendJson(res, 401, { error: 'Invalid email or password' });
          return;
        }

        sendJson(res, 200, {
          setupRequired: false,
          sessionToken: session.token,
          expiresAt: session.expiresAt,
          user: publicUser(session),
        });
        return;
      }

      if (url.pathname === '/auth/me') {
        const sessionToken = sessionTokenFromBody(body);
        const session = sessionToken ? store.getSession(sessionToken) : null;
        sendJson(res, 200, {
          authenticated: session !== null,
          setupRequired: !store.hasUsers(),
          user: session ? publicUser(session) : null,
        });
        return;
      }

      if (url.pathname === '/auth/logout') {
        const sessionToken = sessionTokenFromBody(body);
        if (sessionToken) store.deleteSession(sessionToken);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url.pathname === '/auth/convex-token') {
        const sessionToken = sessionTokenFromBody(body);
        const session = sessionToken ? store.getSession(sessionToken) : null;
        if (!session) {
          sendJson(res, 401, { error: 'Unauthorized' });
          return;
        }

        sendJson(res, 200, {
          token: await signLocalConvexToken({
            user: session.user,
            privateKeyPem: options.jwtPrivateKey,
            issuer: options.jwtIssuer,
            audience: options.jwtAudience,
          }),
        });
        return;
      }

      if (url.pathname === '/hermes/mapping-runs/start') {
        const job = hermesMappingStartFromBody(body);
        void runHermesMappingJob(options, job);
        sendJson(res, 202, { ok: true, status: 'queued', runId: job.runId });
        return;
      }

      if (url.pathname === '/scans/rescan') {
        const input = rescanBodyFromBody(body);
        assertRescanProjectScope(input.projectId, process.env);
        resolveRescanRepoPath(process.env);

        const existing = rescanJobs.get(input.projectId);
        if (existing?.status === 'queued' || existing?.status === 'running') {
          sendJson(res, 202, { ok: true, job: existing });
          return;
        }

        const job: RescanJobState = {
          jobId: `rescan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          projectId: input.projectId,
          status: 'queued',
          startedAt: Date.now(),
          updatedAt: Date.now(),
          steps: [],
        };
        rescanJobs.set(input.projectId, job);
        void runRescanJob(options, job, (next) => rescanJobs.set(input.projectId, next));
        sendJson(res, 202, { ok: true, job });
        return;
      }

      if (url.pathname === '/scans/rescan/status') {
        const input = rescanBodyFromBody(body);
        sendJson(res, 200, { ok: true, job: rescanJobs.get(input.projectId) ?? null });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid request' });
    }
  };
}

export function createVpsApiServer(options: VpsApiOptions) {
  return createServer(createVpsApiHandler(options));
}

export function loadOptionsFromEnv(): VpsApiOptions {
  const proxyToken = process.env.ARCHVIZ_BACKEND_PROXY_TOKEN;
  if (!proxyToken) throw new Error('ARCHVIZ_BACKEND_PROXY_TOKEN is required');
  const jwtPrivateKey = process.env.AUTH_JWT_PRIVATE_KEY;
  if (!jwtPrivateKey) throw new Error('AUTH_JWT_PRIVATE_KEY is required');

  return {
    proxyToken,
    jwtPrivateKey,
    jwtIssuer: process.env.AUTH_JWT_ISSUER ?? 'https://archviz-auth.local',
    jwtAudience: process.env.AUTH_JWT_AUDIENCE ?? 'convex',
  };
}

export function getPortFromEnv(): number {
  const parsed = Number(process.env.PORT ?? DEFAULT_PORT);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}
