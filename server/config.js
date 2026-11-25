// Runtime configuration. Locally (your Mac) nothing here needs setting.
// Hosted mode switches on automatically on Railway (or with DASH_HOSTED=1) and
// tightens everything: see DEPLOY.md for the variables.
import os from 'node:os';
import path from 'node:path';

const env = process.env;

export const HOSTED = !!(env.RAILWAY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || env.DASH_HOSTED === '1');

export const PORT = Number(env.PORT) || 4747;
// Locally: loopback only. Hosted: all interfaces, IPv6 included (Railway's private network is IPv6).
export const HOST = env.HOST || (HOSTED ? '::' : '127.0.0.1');

// The one address the dashboard answers on when hosted. Passkeys are tied to it,
// and requests arriving under any other hostname are sent there.
// Normalised to a bare origin (scheme + host [+ non-default port]): case, a trailing
// slash or a path in the variable don't matter; a missing scheme means https.
const rawPublic = String(env.DASH_PUBLIC_URL || (HOSTED && env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : ''))
  .trim().replace(/^["']+|["']+$/g, '');
let parsedPublic = null;
let publicUrlProblem = '';
if (rawPublic) {
  try {
    parsedPublic = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(rawPublic) ? rawPublic : `https://${rawPublic}`);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsedPublic.hostname);
    if (parsedPublic.protocol !== 'https:' && !local) publicUrlProblem = `DASH_PUBLIC_URL must start with https:// (Railway serves the dashboard over HTTPS). It is currently "${rawPublic}".`;
    else if (!['https:', 'http:'].includes(parsedPublic.protocol)) publicUrlProblem = `DASH_PUBLIC_URL must be a web address like https://hq.example.com. It is currently "${rawPublic}".`;
  } catch {
    publicUrlProblem = `DASH_PUBLIC_URL isn't a valid address: "${rawPublic}". Use the address from your browser's address bar, e.g. https://tutorise-hq.up.railway.app.`;
    parsedPublic = null;
  }
}
export const PUBLIC_URL = parsedPublic ? parsedPublic.origin : '';
export const PUBLIC_HOST = parsedPublic ? parsedPublic.hostname : '';
export const PUBLIC_URL_RAW = rawPublic;

export const DATA_DIR = env.TUTORISE_DASH_DATA || env.RAILWAY_VOLUME_MOUNT_PATH || path.join(os.homedir(), '.tutorise-dashboard');

// Proxies in front of the app: Railway's edge is one; add one for Cloudflare's proxy.
export const TRUST_PROXY_HOPS = Number(env.TRUST_PROXY_HOPS || (HOSTED ? 1 : 0));

export const MASTER_KEY_HEX = (env.DASH_MASTER_KEY || '').trim();
export const SETUP_TOKEN = (env.DASH_SETUP_TOKEN || '').trim();
export const SESSION_SECRET = env.SESSION_SECRET || '';
// Emergency switch: allows password sign-in even when "passkeys only" is on.
export const FORCE_ALLOW_PASSWORD = env.DASH_ALLOW_PASSWORD === '1';

// Optional Cloudflare Access verification (recommended when hosted).
export const CF_ACCESS_TEAM_DOMAIN = (env.CF_ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
export const CF_ACCESS_AUD = (env.CF_ACCESS_AUD || '').trim();

/** Problems that must stop a hosted deploy from starting (better than silently losing data or keys). */
export function hostedConfigProblems() {
  if (!HOSTED) return [];
  const p = [];
  if (!/^[0-9a-f]{64}$/i.test(MASTER_KEY_HEX)) p.push('DASH_MASTER_KEY must be set to 64 hex characters (generate with: openssl rand -hex 32).');
  if (!env.TUTORISE_DASH_DATA && !env.RAILWAY_VOLUME_MOUNT_PATH) p.push('Attach a Railway volume (e.g. mounted at /data) so settings survive redeploys, or set TUTORISE_DASH_DATA to a persistent path.');
  if (publicUrlProblem) p.push(publicUrlProblem);
  else if (!PUBLIC_URL) p.push('Set DASH_PUBLIC_URL to the address you open the dashboard on (e.g. https://hq.example.com), or generate a Railway domain.');
  if ((CF_ACCESS_TEAM_DOMAIN && !CF_ACCESS_AUD) || (!CF_ACCESS_TEAM_DOMAIN && CF_ACCESS_AUD)) p.push('Set both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD, or neither.');
  return p;
}
