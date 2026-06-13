import { NextResponse } from 'next/server';

import { callAuthBackend, clearSessionCookie, getSessionTokenFromCookie } from '@/lib/auth/proxy';

export const runtime = 'nodejs';

export async function POST() {
  const sessionToken = await getSessionTokenFromCookie();
  await callAuthBackend('/auth/logout', { sessionToken });
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
