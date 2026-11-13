// Business metrics from the Tutorise backend on Railway. Two modes:
//  - api:      GET {apiBaseUrl}{apiPath} with a bearer token, returning the
//              JSON contract documented in README.md (see docs/stats-endpoint.md)
//  - postgres: connect straight to the Railway Postgres database and run the
//              SQL queries configured in Settings (each returns `value`, or
//              `date`+`value` rows for history).
import pg from 'pg';

const num = (v, d = 0) => (v == null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
// Optional number: a value that wasn't provided (or whose query failed) stays undefined
// so the dashboard shows "—" rather than a misleading 0.
const opt = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));
const hist = (rows) => (Array.isArray(rows) ? rows.map((r) => ({ date: String(r.date).slice(0, 10), value: num(r.value) })) : []);

/** Coerce whatever the backend returns into the dashboard's shape. Missing fields stay undefined. */
export function normalizeStats(raw = {}) {
  const acc = raw.accounts || {}, s = raw.subscribers || {}, a = raw.active || raw.activeCustomers || {}, u = raw.usage || {}, r = raw.revenue || {}, ai = raw.ai || raw.aiChallenges || {};
  const out = {};
  if (Object.keys(s).length) {
    const paid = opt(s.paid ?? s.active), trialing = opt(s.trialing ?? s.trials);
    const total = opt(s.total) ?? (paid != null || trialing != null ? (paid || 0) + (trialing || 0) : undefined);
    out.subscribers = { total, paid, trialing, trialsEndingSoon: opt(s.trialsEndingSoon), newToday: opt(s.newToday), newTrialsToday: opt(s.newTrialsToday), churnRate: opt(s.churnRate), history: hist(s.history) };
  }
  if (Object.keys(acc).length) out.accounts = {
    parents: opt(acc.parents ?? acc.families), students: opt(acc.students ?? acc.children),
    parentsNewToday: opt(acc.parentsNewToday), studentsNewToday: opt(acc.studentsNewToday),
  };
  if (Object.keys(a).length) out.active = { live: opt(a.live), today: opt(a.today ?? a.daily), week: opt(a.week ?? a.weekly), month: opt(a.month ?? a.monthly), history: hist(a.history) };
  if (Object.keys(u).length) out.usage = { sessionsToday: opt(u.sessionsToday), minutesToday: opt(u.minutesToday), avgSessionMinutes: opt(u.avgSessionMinutes), history: hist(u.history), byHour: Array.isArray(u.byHour) ? u.byHour.map((x) => num(typeof x === 'object' ? x.value : x)) : undefined };
  if (Object.keys(r).length) out.revenue = { currency: r.currency || undefined, mrr: opt(r.mrr), today: opt(r.today), month: opt(r.month), history: hist(r.history) };
  if (Object.keys(ai).length) out.ai = {
    total: opt(ai.total), today: opt(ai.today), completionRate: opt(ai.completionRate), avgScore: opt(ai.avgScore),
    bySubject: (ai.bySubject || []).map((x) => ({ name: x.name ?? x.subject, value: num(x.value ?? x.count) })),
    byLevel: (ai.byLevel || []).map((x) => ({ name: x.name ?? x.level, value: num(x.value ?? x.count) })),
    recent: (ai.recent || []).map((x) => ({ title: x.title || x.name || 'Challenge', subject: x.subject || '', level: x.level || '', student: x.student || x.user || '', score: x.score == null ? null : num(x.score), completed: x.completed ?? x.score != null, createdAt: x.createdAt || x.created_at })),
  };
  return out;
}

export const statsConfigured = (cfg) => (cfg.mode === 'postgres' ? !!cfg.databaseUrl : !!(cfg.apiBaseUrl && cfg.apiToken));

async function fromApi(cfg) {
  const url = cfg.apiBaseUrl.replace(/\/$/, '') + (cfg.apiPath.startsWith('/') ? cfg.apiPath : '/' + cfg.apiPath);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.apiToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Stats API ${res.status} ${res.statusText}`);
  return normalizeStats(await res.json());
}

let pool, poolUrl;
function getPool(cfg) {
  if (pool && poolUrl === cfg.databaseUrl + cfg.databaseSsl) return pool;
  pool?.end().catch(() => {});
  pool = new pg.Pool({ connectionString: cfg.databaseUrl, ssl: cfg.databaseSsl ? { rejectUnauthorized: false } : false, max: 3, statement_timeout: 10_000, connectionTimeoutMillis: 8000 });
  poolUrl = cfg.databaseUrl + cfg.databaseSsl;
  return pool;
}

async function fromPostgres(cfg) {
  const p = getPool(cfg);
  const q = cfg.queries || {};
  const errors = {};
  const run = async (key) => {
    if (!q[key]?.trim()) return undefined;
    try { return (await p.query(q[key])).rows; } catch (e) { errors[key] = e.message; return undefined; }
  };
  const keys = Object.keys(q).filter((k) => q[k]?.trim());
  const rows = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await run(k)])));
  const one = (k) => rows[k]?.[0]?.value;
  const byHour = rows.usageByHour ? Array.from({ length: 24 }, (_, h) => num(rows.usageByHour.find((r) => num(r.hour) === h)?.value)) : undefined;
  const raw = {
    accounts: { parents: one('parentsTotal'), students: one('studentsTotal'), parentsNewToday: one('parentsNewToday'), studentsNewToday: one('studentsNewToday') },
    subscribers: { total: one('subscribersTotal'), paid: one('subscribersPaid'), trialing: one('subscribersTrialing'), trialsEndingSoon: one('trialsEndingSoon'), newTrialsToday: one('subscribersNewTrialsToday'), newToday: one('subscribersNewToday'), history: rows.subscribersHistory },
    active: { today: one('activeToday'), week: one('activeWeek'), month: one('activeMonth'), history: rows.usageHistory },
    usage: { sessionsToday: byHour?.reduce((a, b) => a + b, 0), history: rows.usageHistory, byHour },
    revenue: { mrr: one('mrr'), month: one('revenueMonth'), today: rows.revenueHistory?.find((r) => String(r.date).slice(0, 10) === new Date().toISOString().slice(0, 10))?.value, history: rows.revenueHistory },
    ai: { total: one('aiChallengesTotal'), today: one('aiChallengesToday'), completionRate: one('aiCompletionRate'), avgScore: one('aiAvgScore'), bySubject: rows.aiBySubject, recent: rows.aiRecent },
  };
  const out = normalizeStats(raw);
  if (Object.keys(errors).length) out._queryErrors = errors;
  if (Object.keys(errors).length === keys.length) throw new Error('All queries failed: ' + Object.values(errors)[0]);
  return out;
}

export async function fetchStats(cfg) {
  return cfg.mode === 'postgres' ? fromPostgres(cfg) : fromApi(cfg);
}
