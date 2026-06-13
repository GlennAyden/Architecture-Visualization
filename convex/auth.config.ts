import type { AuthConfig } from 'convex/server';

function toBase64(value: string): string {
  const bytes: number[] = [];
  for (const chunk of encodeURIComponent(value).split(/(%[0-9A-F]{2})/)) {
    if (!chunk) continue;
    if (chunk.startsWith('%')) {
      bytes.push(Number.parseInt(chunk.slice(1), 16));
      continue;
    }
    for (const char of chunk) bytes.push(char.charCodeAt(0));
  }

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const triplet = (first << 16) | (second << 8) | third;
    output += alphabet[(triplet >> 18) & 63];
    output += alphabet[(triplet >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(triplet >> 6) & 63] : '=';
    output += index + 2 < bytes.length ? alphabet[triplet & 63] : '=';
  }
  return output;
}

function jwksConfig(value: string | undefined): string {
  const raw = value ?? '{"keys":[]}';
  if (raw.startsWith('data:') || raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  return `data:application/json;base64,${toBase64(raw)}`;
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
