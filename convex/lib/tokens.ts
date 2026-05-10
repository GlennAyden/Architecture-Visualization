/**
 * Pure token helpers. Runs in Convex V8 runtime (no Node APIs).
 *
 * Token format: `archv_<43chars-base64url>` — 32 random bytes encoded
 * base64url (unpadded). 256 bits of entropy, identifiable prefix for
 * secret-scanning tooling.
 *
 * Why SHA-256 instead of bcrypt: tokens are random 32-byte secrets,
 * not low-entropy passwords. bcrypt's slow-hash protects against brute
 * force on guessable inputs; brute-forcing a 256-bit random value is
 * infeasible regardless of hash speed. SHA-256 lets us hash inside the
 * V8 query/mutation runtime without spawning a Node action per call.
 */

export const TOKEN_PREFIX = 'archv_';

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export function generateRawToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return TOKEN_PREFIX + bytesToBase64Url(buf);
}

export async function hashToken(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}
