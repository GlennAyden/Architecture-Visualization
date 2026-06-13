import { NextRequest, NextResponse } from 'next/server';

import { readCredentials } from '@/lib/auth/request';
import { callAuthBackend, setSessionCookie, stripPrivateAuthFields } from '@/lib/auth/proxy';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const result = await callAuthBackend('/auth/login', await readCredentials(req));
    const response = NextResponse.json(stripPrivateAuthFields(result.data), {
      status: result.status,
    });
    if (result.status >= 200 && result.status < 300) setSessionCookie(response, result.data);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Login failed' },
      { status: 400 },
    );
  }
}
