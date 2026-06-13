import { importPKCS8, SignJWT } from 'jose';
import { Buffer } from 'node:buffer';

import type { LocalUser } from './auth-store.js';

export const LOCAL_AUTH_KEY_ID = 'local-auth-key';
export const LOCAL_AUTH_ALGORITHM = 'ES256';

interface SignLocalConvexTokenOptions {
  user: LocalUser;
  privateKeyPem: string;
  issuer: string;
  audience: string;
}

export function normalizePrivateKeyPem(value: string): string {
  return value.trim().replace(/\\n/g, '\n');
}

export function toJwksDataUri(jwks: string): string {
  if (jwks.startsWith('data:') || jwks.startsWith('http://') || jwks.startsWith('https://')) {
    return jwks;
  }
  return `data:application/json;base64,${Buffer.from(jwks).toString('base64')}`;
}

export async function signLocalConvexToken({
  user,
  privateKeyPem,
  issuer,
  audience,
}: SignLocalConvexTokenOptions): Promise<string> {
  const key = await importPKCS8(normalizePrivateKeyPem(privateKeyPem), LOCAL_AUTH_ALGORITHM);

  return await new SignJWT({ email: user.email })
    .setProtectedHeader({
      alg: LOCAL_AUTH_ALGORITHM,
      kid: LOCAL_AUTH_KEY_ID,
      typ: 'JWT',
    })
    .setSubject(`local:${user.id}`)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(key);
}
