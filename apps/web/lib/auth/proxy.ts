import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const DEFAULT_COOKIE_NAME = 'arch_viz_session';

export interface PublicUser {
  id: string;
  email: string;
}

export interface BackendAuthResponse {
  authenticated?: boolean;
  setupRequired?: boolean;
  user?: PublicUser | null;
  sessionToken?: string;
  expiresAt?: number;
  token?: string;
  ok?: boolean;
  error?: string;
}

export function getCookieName(): string {
  return process.env.AUTH_COOKIE_NAME ?? DEFAULT_COOKIE_NAME;
}

export async function getSessionTokenFromCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(getCookieName())?.value ?? null;
}

export function setSessionCookie(response: NextResponse, data: BackendAuthResponse) {
  if (!data.sessionToken || !data.expiresAt) return;
  response.cookies.set(getCookieName(), data.sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(data.expiresAt),
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(getCookieName(), '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(0),
  });
}

export function stripPrivateAuthFields(data: BackendAuthResponse) {
  const publicData = { ...data };
  delete publicData.sessionToken;
  delete publicData.expiresAt;
  return publicData;
}

function resolveBackendUrl(baseUrl: string, path: string): URL {
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/$/, '');
  const endpointPath = path.startsWith('/') ? path : `/${path}`;
  base.pathname = `${basePath}${endpointPath}`;
  base.search = '';
  base.hash = '';
  return base;
}

export async function callAuthBackend(
  path: string,
  body: object = {},
): Promise<{ status: number; data: BackendAuthResponse }> {
  const baseUrl = process.env.ARCHVIZ_AUTH_BACKEND_URL;
  const proxyToken = process.env.ARCHVIZ_AUTH_BACKEND_TOKEN;
  if (!baseUrl || !proxyToken) {
    return {
      status: 503,
      data: { error: 'Arch Viz auth backend is not configured' },
    };
  }

  try {
    const url = resolveBackendUrl(baseUrl, path);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${proxyToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const data = (await response.json().catch(() => ({}))) as BackendAuthResponse;
    return { status: response.status, data };
  } catch {
    return {
      status: 503,
      data: { error: 'Arch Viz auth backend is unavailable' },
    };
  }
}
