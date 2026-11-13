// Optional: revenue straight from Stripe (overrides revenue from the stats source).
const API = 'https://api.stripe.com/v1';

async function list(key, path, params = {}, max = 1000) {
  const out = [];
  let starting_after;
  while (out.length < max) {
    const qs = new URLSearchParams({ limit: '100', ...params, ...(starting_after ? { starting_after } : {}) });
    const res = await fetch(`${API}/${path}?${qs}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
    const json = await res.json();
    if (!res.ok) throw new Error('Stripe: ' + (json.error?.message || res.status));
    out.push(...json.data);
    if (!json.has_more) break;
    starting_after = json.data.at(-1).id;
  }
  return out;
}

const monthly = (price, qty) => {
  const amt = (price.unit_amount || 0) * (qty || 1);
  const n = price.recurring?.interval_count || 1;
  switch (price.recurring?.interval) {
    case 'year': return amt / 12 / n;
    case 'week': return (amt * 52) / 12 / n;
    case 'day': return (amt * 365) / 12 / n;
    default: return amt / n;
  }
};

let cache = { at: 0, data: null };

export async function fetchStripe(cfg) {
  // Stripe data changes slowly relative to the dashboard tick; refresh every 5 min.
  if (cache.data && Date.now() - cache.at < 5 * 60_000) return cache.data;
  const key = cfg.secretKey;
  const since = Math.floor((Date.now() - 30 * 86_400_000) / 1000);
  const [subs, charges] = await Promise.all([
    list(key, 'subscriptions', { status: 'active' }, 5000),
    list(key, 'charges', { 'created[gte]': String(since) }, 5000),
  ]);
  let mrr = 0, currency;
  for (const s of subs) for (const it of s.items.data) { mrr += monthly(it.price, it.quantity); currency ||= it.price.currency; }
  const byDay = {};
  for (let i = 29; i >= 0; i--) byDay[new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)] = 0;
  for (const c of charges) {
    if (c.status !== 'succeeded' || c.refunded) continue;
    const d = new Date(c.created * 1000).toISOString().slice(0, 10);
    if (d in byDay) byDay[d] += (c.amount - (c.amount_refunded || 0)) / 100;
    currency ||= c.currency;
  }
  const history = Object.entries(byDay).map(([date, value]) => ({ date, value: Math.round(value * 100) / 100 }));
  const monthKey = new Date().toISOString().slice(0, 7);
  const data = {
    currency: (currency || 'gbp').toUpperCase(),
    mrr: Math.round(mrr) / 100,
    today: history.at(-1).value,
    month: Math.round(history.filter((h) => h.date.startsWith(monthKey)).reduce((a, b) => a + b.value, 0) * 100) / 100,
    history,
    payingSubscribers: subs.length,
  };
  cache = { at: Date.now(), data };
  return data;
}
export const resetStripeCache = () => (cache = { at: 0, data: null });
