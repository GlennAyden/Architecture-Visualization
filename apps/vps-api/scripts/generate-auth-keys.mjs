import { exportJWK, exportPKCS8, generateKeyPair } from 'jose';

const keyId = 'local-auth-key';
const issuer = process.env.AUTH_JWT_ISSUER ?? 'https://archviz-auth.example.com';
const audience = process.env.AUTH_JWT_AUDIENCE ?? 'convex';
const { privateKey, publicKey } = await generateKeyPair('ES256', {
  extractable: true,
});

const privateKeyPem = (await exportPKCS8(privateKey)).replace(/\n/g, '\\n');
const publicJwk = await exportJWK(publicKey);
const jwks = {
  keys: [
    {
      ...publicJwk,
      kid: keyId,
      alg: 'ES256',
      use: 'sig',
    },
  ],
};
const jwksJson = JSON.stringify(jwks);
const jwksDataUri = `data:application/json;base64,${Buffer.from(jwksJson).toString('base64')}`;

console.log('# VPS backend .env');
console.log(`AUTH_JWT_PRIVATE_KEY="${privateKeyPem}"`);
console.log(`AUTH_JWT_ISSUER="${issuer}"`);
console.log(`AUTH_JWT_AUDIENCE="${audience}"`);
console.log('');
console.log('# Convex env');
console.log(`pnpm exec convex env set LOCAL_AUTH_JWT_ISSUER "${issuer}"`);
console.log(`pnpm exec convex env set LOCAL_AUTH_JWT_AUDIENCE "${audience}"`);
console.log(`pnpm exec convex env set LOCAL_AUTH_JWKS '${jwksDataUri}'`);
