// Business metrics from the Tutorise backend on Railway. Two modes:
//  - api:      GET {apiBaseUrl}{apiPath} with a bearer token, returning the
//              JSON contract documented in README.md (see docs/stats-endpoint.md)
//  - postgres: connect straight to the Railway Postgres database and run the
//              SQL queries configured in Settings (each returns `value`, or
//              `date`+`value` rows for history).
import pg from 'pg';
import { inspectSchema, detectMapping, schemaReport } from './schema.js';

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
    parentsPaid: opt(acc.parentsPaid), parentsTrialing: opt(acc.parentsTrialing),
    studentsPaid: opt(acc.studentsPaid), studentsTrialing: opt(acc.studentsTrialing),
  };
  if (Object.keys(a).length) out.active = { live: opt(a.live), today: opt(a.today ?? a.daily), week: opt(a.week ?? a.weekly), month: opt(a.month ?? a.monthly), history: hist(a.history) };
  if (Object.keys(u).length) out.usage = { sessionsToday: opt(u.sessionsToday), minutesToday: opt(u.minutesToday), avgSessionMinutes: opt(u.avgSessionMinutes), history: hist(u.history), byHour: Array.isArray(u.byHour) ? u.byHour.map((x) => num(typeof x === 'object' ? x.value : x)) : undefined };
  if (Object.keys(r).length) out.revenue = { currency: r.currency || undefined, mrr: opt(r.mrr), today: opt(r.today), month: opt(r.month), history: hist(r.history) };
  if (Object.keys(ai).length) {
    const pairs = (xs, key) => (xs || []).map((x) => ({ name: String(x.name ?? x[key] ?? 'Other'), value: num(x.value ?? x.count) }));
    out.ai = {
      total: opt(ai.total), today: opt(ai.today), week: opt(ai.week),
      open: opt(ai.open ?? ai.pending),
      upheldRate: opt(ai.upheldRate ?? ai.aiWrongRate ?? ai.overturnedRate),
      bySubject: pairs(ai.bySubject, 'subject'),
      byReason: pairs(ai.byReason, 'reason'),
      byOutcome: pairs(ai.byOutcome ?? ai.byStatus, 'status'),
      history: hist(ai.history),
      recent: (ai.recent || []).map((x) => ({
        summary: String(x.summary ?? x.question ?? x.title ?? 'Challenge').slice(0, 240),
        subject: x.subject || '', reason: x.reason || '', status: x.status || '',
        createdAt: x.createdAt || x.created_at,
      })),
    };
  }
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
    accounts: { parents: one('parentsTotal'), students: one('studentsTotal'), parentsNewToday: one('parentsNewToday'), studentsNewToday: one('studentsNewToday'), parentsPaid: one('parentsPaid'), parentsTrialing: one('parentsTrialing'), studentsPaid: one('studentsPaid'), studentsTrialing: one('studentsTrialing') },
    subscribers: { total: one('subscribersTotal'), paid: one('subscribersPaid'), trialing: one('subscribersTrialing'), trialsEndingSoon: one('trialsEndingSoon'), newTrialsToday: one('subscribersNewTrialsToday'), newToday: one('subscribersNewToday'), history: rows.subscribersHistory },
    active: { today: one('activeToday'), week: one('activeWeek'), month: one('activeMonth'), history: rows.usageHistory },
    usage: { sessionsToday: byHour?.reduce((a, b) => a + b, 0), history: rows.usageHistory, byHour },
    revenue: { mrr: one('mrr'), month: one('revenueMonth'), today: rows.revenueHistory?.find((r) => String(r.date).slice(0, 10) === new Date().toISOString().slice(0, 10))?.value, history: rows.revenueHistory },
    ai: { total: one('aiChallengesTotal'), today: one('aiChallengesToday'), open: one('aiOpen'), upheldRate: one('aiUpheldRate'), bySubject: rows.aiBySubject, byReason: rows.aiByReason, byOutcome: rows.aiByOutcome, history: rows.aiHistory, recent: rows.aiRecent },
  };
  const out = normalizeStats(raw);
  if (Object.keys(errors).length) out._queryErrors = errors;
  if (Object.keys(errors).length === keys.length) throw new Error('All queries failed: ' + Object.values(errors)[0]);
  return out;
}

export async function fetchStats(cfg) {
  return cfg.mode === 'postgres' ? fromPostgres(cfg) : fromApi(cfg);
}

/** Inspect the database and propose queries (Settings → Business data → Detect). */
export async function detectSchema(cfg) {
  const info = await inspectSchema(getPool(cfg));
  if (!Object.keys(info.tables).length) throw new Error('Connected, but found no tables in the public schema');
  return { ...detectMapping(info), report: schemaReport(info) };
}
