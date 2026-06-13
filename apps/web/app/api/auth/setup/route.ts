import { NextRequest, NextResponse } from 'next/server';

import { readCredentials } from '@/lib/auth/request';
import { callAuthBackend, setSessionCookie, stripPrivateAuthFields } from '@/lib/auth/proxy';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const credentials = await readCredentials(req);
    const result = await callAuthBackend('/auth/setup', credentials);
    const response = NextResponse.json(stripPrivateAuthFields(result.data), {
      status: result.status,
    });
    if (result.status >= 200 && result.status < 300) setSessionCookie(response, result.data);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Setup failed' },
      { status: 400 },
    );
  }
}
