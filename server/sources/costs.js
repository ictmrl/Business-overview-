// AI provider costs for the current month: Anthropic (Usage and Cost Analytics
// API, via the official SDK) and OpenAI (organization costs endpoint). Both need
// an *admin* key. Amounts arrive in USD and are converted with the rate set in
// Settings → Costs. Data lags a few hours, so the month-end estimate projects
// from where each provider's data actually ends.
import Anthropic from '@anthropic-ai/sdk';

const DAY = 86_400_000;
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const utcMidnight = (t) => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };

export const costsConfigured = (cfg) => !!(cfg.anthropicAdminKey || cfg.openaiAdminKey);

/** Daily USD for the last 31 days from Anthropic. Returns { byDay, dataEnd }. */
async function anthropicDaily(key, start, end) {
  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 20_000 });
  const byDay = {};
  let page = await client.beta.organization.analytics.cost.list({
    starting_at: new Date(start).toISOString(),
    ending_at: new Date(end).toISOString(),
    time_bucket_width: '1d',
    order_by: 'time',
    order: 'asc',
    limit: 1000,
  });
  const refreshed = page.data_refreshed_at;
  for (;;) {
    for (const row of page.data) {
      const d = row.starting_at.slice(0, 10);
      byDay[d] = (byDay[d] || 0) + Number(row.cost.amount) / 100; // amount is a decimal string in cents
    }
    if (!page.hasNextPage()) break;
    page = await page.getNextPage();
  }
  return { byDay, dataEnd: refreshed ? new Date(refreshed).getTime() : null };
}

/** Daily USD for the last 31 days from OpenAI's organization costs endpoint. */
async function openaiDaily(key, start, end) {
  const base = process.env.OPENAI_ADMIN_BASE_URL || 'https://api.openai.com';
  const byDay = {};
  let pageToken = null;
  for (let i = 0; i < 10; i++) {
    const qs = new URLSearchParams({ start_time: String(Math.floor(start / 1000)), end_time: String(Math.floor(end / 1000)), bucket_width: '1d', limit: '31' });
    if (pageToken) qs.set('page', pageToken);
    const res = await fetch(`${base}/v1/organization/costs?${qs}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('OpenAI: ' + (json.error?.message || `${res.status} ${res.statusText}`));
    for (const bucket of json.data || []) {
      const d = isoDay(bucket.start_time * 1000);
      for (const r of bucket.results || []) byDay[d] = (byDay[d] || 0) + Number(r.amount?.value ?? r.amount ?? 0);
    }
    if (!json.has_more || !json.next_page) break;
    pageToken = json.next_page;
  }
  return { byDay, dataEnd: null };
}

/** Month-to-date and month-end estimate for one provider's daily series. */
function summarise(name, { byDay, dataEnd }, now) {
  const monthKey = isoDay(now).slice(0, 7);
  const end = dataEnd && dataEnd < now ? dataEnd : now;
  const mtd = Object.entries(byDay).filter(([d]) => d.startsWith(monthKey)).reduce((t, [, v]) => t + v, 0);
  // Daily run rate: the last 7 complete days before the day the data ends in.
  const endDay = utcMidnight(end);
  const recent = [];
  for (let i = 1; i <= 7; i++) recent.push(byDay[isoDay(endDay - i * DAY)] || 0);
  const haveAny = Object.keys(byDay).length > 0;
  const dailyRate = recent.reduce((t, v) => t + v, 0) / recent.length;
  const n = new Date(now);
  const monthEnd = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1);
  const remainingDays = Math.max(0, (monthEnd - end) / DAY);
  return { name, mtd, dailyRate, projected: mtd + dailyRate * remainingDays, dataThrough: haveAny ? new Date(end).toISOString() : null };
}

let cache = { at: 0, key: '', data: null };

export async function fetchCosts(cfg, { force = false } = {}) {
  const key = `${cfg.anthropicAdminKey}|${cfg.openaiAdminKey}|${cfg.usdToGbp}`;
  // Provider data refreshes every few hours; re-read every 10 minutes.
  if (!force && cache.data && cache.key === key && Date.now() - cache.at < 10 * 60_000) return cache.data;
  const now = Date.now();
  const end = utcMidnight(now) + DAY; // next UTC midnight
  const start = end - 31 * DAY;       // 31 daily buckets: always covers the month so far plus a week before it
  const jobs = [];
  if (cfg.anthropicAdminKey) jobs.push(anthropicDaily(cfg.anthropicAdminKey, start, end).then((r) => ({ name: 'Anthropic', r })).catch((e) => ({ name: 'Anthropic', error: e.message })));
  if (cfg.openaiAdminKey) jobs.push(openaiDaily(cfg.openaiAdminKey, start, end).then((r) => ({ name: 'OpenAI', r })).catch((e) => ({ name: 'OpenAI', error: e.message })));
  const results = await Promise.all(jobs);
  const ok = results.filter((x) => x.r);
  const errors = results.filter((x) => x.error).map((x) => `${x.name}: ${x.error}`);
  if (!ok.length) throw new Error(errors.join(' · ') || 'No cost source configured');

  const rate = Number(cfg.usdToGbp) > 0 ? Number(cfg.usdToGbp) : 1;
  const providers = ok.map((x) => summarise(x.name, x.r, now));
  const days = [];
  for (let t = start; t < end; t += DAY) days.push(isoDay(t));
  const history = days.map((d) => ({ date: d, value: Math.round(ok.reduce((t, x) => t + (x.r.byDay[d] || 0), 0) * rate * 100) / 100 }));
  const conv = (v) => Math.round(v * rate * 100) / 100;
  const data = {
    currency: 'GBP',
    usdToGbp: rate,
    mtd: conv(providers.reduce((t, p) => t + p.mtd, 0)),
    projected: conv(providers.reduce((t, p) => t + p.projected, 0)),
    dailyRate: conv(providers.reduce((t, p) => t + p.dailyRate, 0)),
    mtdUsd: Math.round(providers.reduce((t, p) => t + p.mtd, 0) * 100) / 100,
    byProvider: providers.map((p) => ({ name: p.name, mtd: conv(p.mtd), projected: conv(p.projected), dataThrough: p.dataThrough })),
    history,
    dataThrough: providers.map((p) => p.dataThrough).filter(Boolean).sort()[0] || null,
    errors,
  };
  cache = { at: Date.now(), key, data };
  return data;
}
export const resetCostsCache = () => (cache = { at: 0, key: '', data: null });

/**
 * Costs reported by Tutorise itself (the stats endpoint's `costs` section),
 * converted to GBP and projected to month end the same way as provider data.
 * Tutorise logs costs as calls happen, so its data runs up to "now".
 */
export function costsFromStats(raw, cfg, now = Date.now()) {
  const fx = (raw.currency || 'USD').toUpperCase() === 'GBP' ? 1 : Number(cfg.usdToGbp) > 0 ? Number(cfg.usdToGbp) : 1;
  const byDay = Object.fromEntries((raw.history || []).map((d) => [String(d.date).slice(0, 10), Number(d.value) || 0]));
  const sum = summarise('Tutorise', { byDay, dataEnd: null }, now);
  const mtd = raw.mtd != null ? Number(raw.mtd) : sum.mtd;
  const n = new Date(now);
  const remainingDays = Math.max(0, (Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1) - now) / DAY);
  const conv = (v) => Math.round(Number(v || 0) * fx * 100) / 100;
  const pairs = (xs) => (xs || []).map((x) => ({ name: String(x.name ?? 'Other'), mtd: conv(x.mtd ?? x.value) }));
  return {
    source: 'tutorise',
    currency: 'GBP',
    usdToGbp: fx,
    mtd: conv(mtd),
    today: raw.today != null ? conv(raw.today) : undefined,
    dailyRate: conv(sum.dailyRate),
    projected: conv(mtd + sum.dailyRate * remainingDays),
    byProvider: pairs(raw.byProvider),
    byFeature: pairs(raw.byFeature).sort((a, b) => b.mtd - a.mtd),
    history: (raw.history || []).map((d) => ({ date: String(d.date).slice(0, 10), value: conv(d.value) })),
    dataThrough: new Date(now).toISOString(),
    errors: [],
  };
}
