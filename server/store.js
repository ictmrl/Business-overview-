// Local persistence: settings (secrets encrypted at rest), user account,
// passkeys and uptime history. Everything lives in ~/.tutorise-dashboard
// (override with TUTORISE_DASH_DATA) so nothing sensitive sits in the repo.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const DATA_DIR = process.env.TUTORISE_DASH_DATA || path.join(os.homedir(), '.tutorise-dashboard');
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

const KEY_FILE = path.join(DATA_DIR, 'master.key');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

function loadKey() {
  if (!fs.existsSync(KEY_FILE)) {
    fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
}
const KEY = loadKey();

export function encrypt(plain) {
  if (plain == null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'enc:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function decrypt(value) {
  if (!value || typeof value !== 'string' || !value.startsWith('enc:')) return value || '';
  try {
    const buf = Buffer.from(value.slice(4), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}

// Fields that hold secrets: stored encrypted, never sent back to the browser.
export const SECRET_FIELDS = {
  railway: ['token'],
  stats: ['apiToken', 'databaseUrl'],
  stripe: ['secretKey'],
  costs: ['anthropicAdminKey', 'openaiAdminKey'],
  email: ['imapPassword', 'smtpPassword'],
};

export const DEFAULT_SETTINGS = {
  general: { businessName: 'Tutorise', refreshSeconds: 30, currency: 'GBP', demoMode: true },
  railway: { token: '', tokenType: 'account', projectId: '', environmentId: '' },
  stats: {
    mode: 'api', // 'api' | 'postgres'
    apiBaseUrl: 'https://tutorise.uk',
    apiPath: '/api/admin/stats',
    apiToken: '',
    databaseUrl: '',
    databaseSsl: true,
    queries: {
      subscribersPaid: "SELECT count(*)::int AS value FROM subscriptions WHERE status = 'active'",
      subscribersTrialing: "SELECT count(*)::int AS value FROM subscriptions WHERE status = 'trialing'",
      subscribersNewTrialsToday: "SELECT count(*)::int AS value FROM subscriptions WHERE status = 'trialing' AND created_at >= date_trunc('day', now())",
      trialsEndingSoon: "SELECT count(*)::int AS value FROM subscriptions WHERE status = 'trialing' AND trial_end BETWEEN now() AND now() + interval '3 days'",
      subscribersTotal: "",
      subscribersNewToday: "SELECT count(*)::int AS value FROM subscriptions WHERE status NOT IN ('incomplete','incomplete_expired') AND created_at >= date_trunc('day', now())",
      subscribersHistory: "SELECT to_char(d, 'YYYY-MM-DD') AS date, (SELECT count(*) FROM subscriptions s WHERE s.status NOT IN ('incomplete','incomplete_expired') AND s.created_at < d + interval '1 day' AND (s.canceled_at IS NULL OR s.canceled_at >= d + interval '1 day'))::int AS value FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d ORDER BY d",
      parentsTotal: "SELECT count(*)::int AS value FROM users WHERE role = 'parent'",
      studentsTotal: "SELECT count(*)::int AS value FROM users WHERE role = 'student'",
      parentsNewToday: "SELECT count(*)::int AS value FROM users WHERE role = 'parent' AND created_at >= date_trunc('day', now())",
      studentsNewToday: "SELECT count(*)::int AS value FROM users WHERE role = 'student' AND created_at >= date_trunc('day', now())",
      parentsPaid: "",
      parentsTrialing: "",
      studentsPaid: "",
      studentsTrialing: "",
      activeToday: "SELECT count(DISTINCT user_id)::int AS value FROM sessions WHERE created_at >= date_trunc('day', now())",
      activeWeek: "SELECT count(DISTINCT user_id)::int AS value FROM sessions WHERE created_at >= now() - interval '7 days'",
      activeMonth: "SELECT count(DISTINCT user_id)::int AS value FROM sessions WHERE created_at >= now() - interval '30 days'",
      usageHistory: "SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date, count(*)::int AS value FROM sessions WHERE created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 1",
      usageByHour: "SELECT extract(hour FROM created_at)::int AS hour, count(*)::int AS value FROM sessions WHERE created_at >= date_trunc('day', now()) GROUP BY 1 ORDER BY 1",
      revenueMonth: "SELECT coalesce(sum(amount),0)/100.0 AS value FROM payments WHERE status = 'succeeded' AND created_at >= date_trunc('month', now())",
      revenueHistory: "SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date, coalesce(sum(amount),0)/100.0 AS value FROM payments WHERE status = 'succeeded' AND created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 1",
      mrr: "SELECT coalesce(sum(price_amount),0)/100.0 AS value FROM subscriptions WHERE status = 'active'",
      aiChallengesTotal: "SELECT count(*)::int AS value FROM ai_challenges",
      aiChallengesToday: "SELECT count(*)::int AS value FROM ai_challenges WHERE created_at >= date_trunc('day', now())",
      aiChallengesWeek: "SELECT count(*)::int AS value FROM ai_challenges WHERE created_at >= now() - interval '7 days'",
      aiOpen: "",
      aiByType: "SELECT type AS name, count(*)::int AS value, count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS today FROM ai_challenges WHERE created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC",
      aiByOutcome: "",
      aiHistory: "SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date, count(*)::int AS value FROM ai_challenges WHERE created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 1",
      aiRecent: "SELECT type, left(summary, 240) AS summary, created_at FROM ai_challenges ORDER BY created_at DESC LIMIT 12",
    },
  },
  stripe: { secretKey: '' },
  costs: { anthropicAdminKey: '', openaiAdminKey: '', usdToGbp: 0.79 },
  uptime: { urls: 'https://tutorise.uk\nhttps://www.tutorise.uk', intervalSeconds: 60 },
  email: {
    imapHost: '', imapPort: 993, imapSecure: true, imapUser: '', imapPassword: '', mailbox: 'INBOX',
    smtpHost: '', smtpPort: 465, smtpSecure: true, smtpUser: '', smtpPassword: '',
    fromName: 'Tutorise', fromAddress: '', fetchCount: 30,
  },
};

const DEFAULT_STATE = { settings: DEFAULT_SETTINGS, user: null, passkeys: [], uptime: {}, daily: {} };

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
  return out;
}

let state;
try {
  state = deepMerge(DEFAULT_STATE, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
} catch {
  state = structuredClone(DEFAULT_STATE);
}

// Upgrade saved SQL that still matches an earlier built-in default (leaves edited queries alone).
const OLD_DEFAULT_QUERIES = {
  subscribersTotal: ["SELECT count(*)::int AS value FROM subscriptions WHERE status IN ('active','trialing')"],
  subscribersNewToday: ["SELECT count(*)::int AS value FROM subscriptions WHERE created_at >= date_trunc('day', now())"],
  subscribersHistory: ["SELECT to_char(d, 'YYYY-MM-DD') AS date, (SELECT count(*) FROM subscriptions s WHERE s.created_at < d + interval '1 day' AND (s.canceled_at IS NULL OR s.canceled_at >= d + interval '1 day'))::int AS value FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d ORDER BY d"],
};
{
  const q = state.settings.stats.queries;
  for (const [k, olds] of Object.entries(OLD_DEFAULT_QUERIES)) {
    if (olds.includes(q[k])) q[k] = DEFAULT_SETTINGS.stats.queries[k];
  }
  // AI challenges were first modelled as quizzes; drop those queries if untouched.
  // …and then as disputes by subject/reason; those default queries are superseded by aiByType.
  for (const k of ['aiCompletionRate', 'aiAvgScore', 'aiUpheldRate', 'aiBySubject', 'aiByReason']) if (q[k]?.includes('ai_challenges')) delete q[k];
  for (const k of ['aiOpen', 'aiByOutcome', 'aiRecent']) if (q[k]?.includes('ai_challenges') && /status|subject|reason/.test(q[k])) q[k] = DEFAULT_SETTINGS.stats.queries[k];
  if (q.aiRecent === "SELECT title, subject, level, score, completed_at IS NOT NULL AS completed, created_at FROM ai_challenges ORDER BY created_at DESC LIMIT 12") q.aiRecent = DEFAULT_SETTINGS.stats.queries.aiRecent;
  if (state.settings.stats.apiPath === '/admin/stats') state.settings.stats.apiPath = DEFAULT_SETTINGS.stats.apiPath;
  // Earlier defaults guessed an api.tutorise.uk host that doesn't exist.
  if (state.settings.stats.apiBaseUrl === 'https://api.tutorise.uk') state.settings.stats.apiBaseUrl = DEFAULT_SETTINGS.stats.apiBaseUrl;
  if (state.settings.uptime.urls === 'https://tutorise.uk\nhttps://api.tutorise.uk/health') state.settings.uptime.urls = DEFAULT_SETTINGS.uptime.urls;
}

let saveTimer;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, STATE_FILE);
  }, 50);
}

export const getState = () => state;

/** Settings with secrets decrypted — for server-side use only. */
export function getSettings() {
  const s = structuredClone(state.settings);
  for (const [section, fields] of Object.entries(SECRET_FIELDS)) {
    for (const f of fields) s[section][f] = decrypt(s[section][f]);
  }
  return s;
}

/** Settings safe to send to the browser: secrets replaced with a "set" flag. */
export function getPublicSettings() {
  const s = structuredClone(state.settings);
  for (const [section, fields] of Object.entries(SECRET_FIELDS)) {
    for (const f of fields) s[section][f] = s[section][f] ? '__SET__' : '';
  }
  return s;
}

/** Update one section. Secret fields left as '__SET__' keep their current value. */
export function updateSection(section, values) {
  if (!(section in DEFAULT_SETTINGS)) throw new Error('Unknown settings section');
  const current = state.settings[section];
  const next = { ...current };
  for (const [k, v] of Object.entries(values || {})) {
    if (!(k in DEFAULT_SETTINGS[section])) continue;
    if ((SECRET_FIELDS[section] || []).includes(k)) {
      if (v === '__SET__') continue;
      next[k] = encrypt(v);
    } else if (k === 'queries' && typeof v === 'object') {
      next.queries = { ...current.queries, ...v };
    } else {
      const def = DEFAULT_SETTINGS[section][k];
      next[k] = typeof def === 'number' ? Number(v) : typeof def === 'boolean' ? Boolean(v) : v;
    }
  }
  state.settings[section] = next;
  save();
}
