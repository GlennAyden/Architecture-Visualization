import type { AuthConfig } from 'convex/server';
import { Buffer } from 'node:buffer';

function jwksConfig(value: string | undefined): string {
  const raw = value ?? '{"keys":[]}';
  if (raw.startsWith('data:') || raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  return `data:application/json;base64,${Buffer.from(raw).toString('base64')}`;
}

export default {
  providers: [
    {
      type: 'customJwt',
      issuer: process.env.LOCAL_AUTH_JWT_ISSUER ?? 'https://archviz-auth.local',
      applicationID: process.env.LOCAL_AUTH_JWT_AUDIENCE ?? 'convex',
      jwks: jwksConfig(process.env.LOCAL_AUTH_JWKS),
      algorithm: 'ES256',
    },
  ],
} satisfies AuthConfig;
