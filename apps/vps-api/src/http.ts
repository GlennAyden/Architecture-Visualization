import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { createLocalAuthStore, type LocalAuthStore, type LocalSession } from './auth-store.js';
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
}

interface SessionBody {
  sessionToken?: string;
}

interface CredentialsBody {
  email?: string;
  password?: string;
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
