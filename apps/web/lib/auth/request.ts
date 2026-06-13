import type { NextRequest } from 'next/server';

interface Credentials {
  email: string;
  password: string;
}

export async function readCredentials(req: NextRequest): Promise<Credentials> {
  const body = (await req.json()) as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email.trim() || !password) throw new Error('Email and password are required');
  return { email, password };
}
