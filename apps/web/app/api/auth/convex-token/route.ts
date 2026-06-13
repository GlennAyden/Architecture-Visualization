import { NextResponse } from 'next/server';

import { callAuthBackend, getSessionTokenFromCookie } from '@/lib/auth/proxy';

export const runtime = 'nodejs';

export async function GET() {
  const sessionToken = await getSessionTokenFromCookie();
  const result = await callAuthBackend('/auth/convex-token', { sessionToken });

  return NextResponse.json(result.data, {
    status: result.status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
