import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { createLocalAuthStore, type LocalAuthStore, type LocalSession } from './auth-store.js';
import {
  heuristicHermesMapper,
  type HermesMapper,
  type HermesMappingContext,
  type HermesRelationshipSuggestion,
  type HermesMappingSuggestion,
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

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/archv_[A-Za-z0-9_-]+/g, '[redacted-token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, 1000);
}

async function submitMappingRunCompletion(
  fetchImpl: typeof fetch,
  job: HermesMappingStartBody,
  payload: {
    status: 'completed' | 'failed';
    errorMessage?: string;
    suggestions?: HermesMappingSuggestion[];
    relationshipSuggestions?: HermesRelationshipSuggestion[];
    flowSuggestions?: HermesArchitectureFlowSuggestion[];
  },
) {
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
      relationshipSuggestions: payload.relationshipSuggestions ?? [],
      flowSuggestions: payload.flowSuggestions ?? [],
    }),
  });
  if (!response.ok) throw new Error(`Convex mapping submit failed (${response.status})`);
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
