// HTTP uptime monitor. Pings each configured URL on an interval and keeps
// 24h of raw samples plus 90 days of daily roll-ups in the local state file.
import { getState, save } from '../store.js';

let timer;
let onChange = () => {};

async function ping(url) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'TutoriseDashboard-Uptime/1.0' } });
    return { up: res.status < 500, code: res.status, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { up: false, code: 0, ms: Math.round(performance.now() - t0), error: e.cause?.code || e.name };
  }
}

export async function checkAll(urls) {
  const state = getState();
  state.uptime ||= {};
  await Promise.all(urls.map(async (url) => {
    const r = await ping(url);
    const rec = (state.uptime[url] ||= { samples: [], daily: {} });
    rec.samples.push({ t: Date.now(), up: r.up, ms: r.ms, code: r.code });
    const cutoff = Date.now() - 86_400_000;
    rec.samples = rec.samples.filter((s) => s.t >= cutoff);
    const d = new Date().toISOString().slice(0, 10);
    const day = (rec.daily[d] ||= { ok: 0, total: 0 });
    day.total++; if (r.up) day.ok++;
    const keys = Object.keys(rec.daily).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 90))) delete rec.daily[k];
    rec.last = { ...r, t: Date.now() };
  }));
  for (const url of Object.keys(state.uptime)) if (!urls.includes(url)) delete state.uptime[url];
  save();
  onChange();
}

export function startUptime(cfg, cb) {
  clearInterval(timer);
  onChange = cb || onChange;
  const urls = parseUrls(cfg.urls);
  if (!urls.length) return;
  checkAll(urls);
  timer = setInterval(() => checkAll(urls), Math.max(15, cfg.intervalSeconds || 60) * 1000);
}

export const parseUrls = (s) => String(s || '').split(/[\n,]/).map((x) => x.trim()).filter((x) => /^https?:\/\//.test(x));

export function uptimeSnapshot(cfg) {
  const state = getState();
  const checks = parseUrls(cfg.urls).map((url) => {
    const rec = state.uptime?.[url];
    if (!rec) return { url, pending: true };
    const s = rec.samples;
    const up24 = s.length ? (s.filter((x) => x.up).length / s.length) * 100 : null;
    const days = Object.values(rec.daily);
    const ok = days.reduce((a, b) => a + b.ok, 0), tot = days.reduce((a, b) => a + b.total, 0);
    // 48 half-hour buckets for the uptime bar.
    const buckets = Array.from({ length: 48 }, (_, i) => {
      const end = Date.now() - (47 - i) * 1_800_000, start = end - 1_800_000;
      const b = s.filter((x) => x.t > start && x.t <= end);
      return b.length ? b.filter((x) => x.up).length / b.length : null;
    });
    const recentMs = s.slice(-30).map((x) => x.ms);
    return {
      url, up: rec.last?.up, code: rec.last?.code, latency: rec.last?.ms, error: rec.last?.error,
      uptime24h: up24 == null ? null : Math.round(up24 * 100) / 100,
      uptime90d: tot ? Math.round((ok / tot) * 10000) / 100 : null,
      buckets, recentMs, checkedAt: rec.last?.t,
    };
  });
  const known = checks.filter((c) => c.uptime24h != null);
  return { checks, overall: known.length ? Math.round((known.reduce((a, c) => a + c.uptime24h, 0) / known.length) * 100) / 100 : null };
}
