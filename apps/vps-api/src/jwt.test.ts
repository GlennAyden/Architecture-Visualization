// @vitest-environment node

import { exportJWK, exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { describe, expect, test } from 'vitest';

import { signLocalConvexToken, toJwksDataUri } from './jwt.js';

describe('local Convex JWT', () => {
  test('signs a Convex-compatible local identity token for the VPS issuer', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256', {
      extractable: true,
    });
    const privateKeyPem = await exportPKCS8(privateKey);
    const publicJwk = await exportJWK(publicKey);
    const jwks = {
      keys: [{ ...publicJwk, kid: 'local-auth-key', alg: 'ES256', use: 'sig' }],
    };

    const token = await signLocalConvexToken({
      user: {
        id: 'local_user_1',
        email: 'glenn@example.com',
        createdAt: 1,
        updatedAt: 1,
      },
      privateKeyPem,
      issuer: 'https://auth.archviz.example',
      audience: 'convex',
    });

    const { payload } = await jwtVerify(token, publicKey, {
      issuer: 'https://auth.archviz.example',
      audience: 'convex',
    });

    expect(payload.sub).toBe('local:local_user_1');
    expect(payload.email).toBe('glenn@example.com');
    expect(toJwksDataUri(JSON.stringify(jwks))).toMatch(/^data:application\/json;base64,/);
  });
});
