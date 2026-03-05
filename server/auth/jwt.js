/**
 * Simple JWT create/verify so tokens work on serverless (Vercel) without session store.
 */

import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'vault-jwt-secret-change-in-production';

function base64UrlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad) b64 += '='.repeat(4 - pad);
  return Buffer.from(b64, 'base64');
}

/** Create a JWT carrying userId. */
export function createJWT(user) {
  const payload = { userId: user.id, iat: Date.now() };
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(payloadB64).digest();
  const sigB64 = base64UrlEncode(sig);
  return 'jwt_' + payloadB64 + '.' + sigB64;
}

/** Verify JWT and return payload or null. */
export function verifyJWT(token) {
  if (!token || typeof token !== 'string' || !token.startsWith('jwt_')) return null;
  const rest = token.slice(4);
  const dot = rest.indexOf('.');
  if (dot === -1) return null;
  const payloadB64 = rest.slice(0, dot);
  const sigB64 = rest.slice(dot + 1);
  try {
    const sig = base64UrlDecode(sigB64);
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(payloadB64).digest();
    if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
    const raw = base64UrlDecode(payloadB64).toString('utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}
