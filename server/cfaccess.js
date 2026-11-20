// Cloudflare Access check. When CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are set,
// every request must carry a valid Cf-Access-Jwt-Assertion signed by your
// Cloudflare team. Requests that reach the app any other way (e.g. straight to
// the *.up.railway.app address) are refused, so the Access login can't be bypassed.
import crypto from 'node:crypto';
import { CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD } from './config.js';

export const cfAccessEnabled = !!(CF_ACCESS_TEAM_DOMAIN && CF_ACCESS_AUD);

let keys = new Map();
let keysAt = 0;

async function loadKeys(force = false) {
  if (!force && keys.size && Date.now() - keysAt < 60 * 60_000) return;
  const res = await fetch(`https://${CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Cloudflare certs ${res.status}`);
  const { keys: jwks = [] } = await res.json();
  keys = new Map(jwks.filter((k) => k.kty === 'RSA').map((k) => [k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })]));
  keysAt = Date.now();
}

const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

/** Verify an Access JWT. Returns its claims, or throws. */
export async function verifyAccessJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('missing or malformed token');
  const [h, p, sig] = parts;
  const header = b64json(h);
  if (header.alg !== 'RS256') throw new Error('unexpected algorithm');
  await loadKeys();
  let key = keys.get(header.kid);
  if (!key) { await loadKeys(true); key = keys.get(header.kid); } // keys rotate
  if (!key) throw new Error('unknown signing key');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(sig, 'base64url'));
  if (!ok) throw new Error('bad signature');
  const claims = b64json(p);
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp && now > claims.exp + 30) throw new Error('expired');
  if (claims.nbf && now + 30 < claims.nbf) throw new Error('not yet valid');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(CF_ACCESS_AUD)) throw new Error('wrong audience');
  if (claims.iss && claims.iss !== `https://${CF_ACCESS_TEAM_DOMAIN}`) throw new Error('wrong issuer');
  return claims;
}

export function cfAccessMiddleware(req, res, next) {
  if (!cfAccessEnabled || req.path === '/healthz') return next();
  verifyAccessJwt(req.get('cf-access-jwt-assertion'))
    .then((claims) => { req.accessEmail = claims.email; next(); })
    .catch(() => res.status(403).type('text').send('Forbidden: open the dashboard through its Cloudflare Access address.'));
}
