// Tutorise Dashboard server. On your Mac it binds to localhost only; hosted
// (Railway) it runs behind HTTPS with the extra protections in config.js.
import express from 'express';
import session from 'express-session';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { authRouter, requireAuth } from './auth.js';
import { HOSTED, PORT, HOST, PUBLIC_URL, PUBLIC_HOST, PUBLIC_URL_RAW, TRUST_PROXY_HOPS, SESSION_SECRET, hostedConfigProblems } from './config.js';
import { cfAccessMiddleware, cfAccessEnabled } from './cfaccess.js';
import { getSettings, getPublicSettings, updateSection, DATA_DIR, SECRET_FIELDS, getState, save } from './store.js';
import { demoStats, demoInfra, demoMail, demoCosts } from './sources/demo.js';
import { fetchStats, statsConfigured, detectSchema } from './sources/stats.js';
import { fetchRailway, railwayConfigured, testRailway, findDatabaseUrl } from './sources/railway.js';
import { fetchStripe, resetStripeCache } from './sources/stripe.js';
import { fetchCosts, costsConfigured, resetCostsCache, costsFromStats } from './sources/costs.js';
import { startUptime, uptimeSnapshot, checkAll, parseUrls } from './sources/uptime.js';
import * as mail from './sources/email.js';
import { tasksRouter, tasksSummary } from './tasks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const problems = hostedConfigProblems();
if (problems.length) {
  console.error('\n  Tutorise Dashboard can\'t start in hosted mode until these are fixed (see DEPLOY.md):\n' + problems.map((x) => '   • ' + x).join('\n') + '\n');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
if (TRUST_PROXY_HOPS) app.set('trust proxy', TRUST_PROXY_HOPS); // req.protocol / req.ip from the proxy's headers

// Health check for Railway: no auth, no data.
app.get('/healthz', (req, res) => res.type('text').send('ok'));

// Hosted: require Cloudflare Access (if configured) before anything else.
app.use(cfAccessMiddleware);
app.use(express.json({ limit: '1mb' }));

// Passkeys are bound to one hostname: localhost on the Mac, PUBLIC_URL when hosted.
app.use((req, res, next) => {
  if (!HOSTED && req.hostname === '127.0.0.1') return res.redirect(`http://localhost:${PORT}${req.originalUrl}`);
  if (PUBLIC_HOST && req.hostname !== PUBLIC_HOST) {
    if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(308, PUBLIC_URL + req.originalUrl);
    return res.status(403).json({ error: 'Use ' + PUBLIC_URL });
  }
  next();
});

// Reject cross-site state-changing requests.
const normOrigin = (u) => { try { return new URL(u).origin; } catch { return String(u); } };
const expectedOrigin = (req) => PUBLIC_URL || normOrigin(`${req.protocol}://${req.get('host')}`);
const warnedOrigins = new Set();
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('origin');
  if (!origin) return next();
  const got = normOrigin(origin), want = expectedOrigin(req);
  if (got === want) return next();
  if (!warnedOrigins.has(got) && warnedOrigins.size < 50) {
    warnedOrigins.add(got);
    console.warn(`Refused a request from ${got}: the dashboard only accepts ${want}${HOSTED ? ' (DASH_PUBLIC_URL / Railway domain)' : ''}.`);
  }
  const fix = HOSTED ? ` Open ${want} instead, or set DASH_PUBLIC_URL to ${got} in Railway and redeploy.` : ` Open ${want} instead.`;
  res.status(403).json({ error: `Bad origin: this page is open at ${got}, but the dashboard only accepts ${want}.${fix}` });
});

app.use((req, res, next) => {
  res.set({
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ...(HOSTED ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
  });
  next();
});

app.use(session({
  name: HOSTED ? '__Host-tdash.sid' : 'tdash.sid',
  secret: SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  proxy: HOSTED,
  cookie: { httpOnly: true, sameSite: 'strict', secure: HOSTED, path: '/', maxAge: (HOSTED ? 8 : 12) * 3_600_000 },
}));

app.use('/api/auth', authRouter);

// ---------------------------------------------------------------- snapshot
let snapshot = { updatedAt: null };
const clients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

const sourceStatus = (state, message) => ({ state, message: message || '' });

async function collect() {
  const s = getSettings();
  const demo = s.general.demoMode;
  const out = { updatedAt: new Date().toISOString(), businessName: s.general.businessName, sources: {} };

  // Business stats
  let stats = {};
  if (statsConfigured(s.stats)) {
    try { stats = await fetchStats(s.stats); out.sources.stats = sourceStatus('live', stats._queryErrors ? `${Object.keys(stats._queryErrors).length} query errors` : ''); }
    catch (e) { out.sources.stats = sourceStatus('error', e.message); if (demo) stats = demoStats(); }
  } else if (demo) { stats = demoStats(); out.sources.stats = sourceStatus('demo'); }
  else out.sources.stats = sourceStatus('off');
  Object.assign(out, stats);
  if (stats._queryErrors) out.queryErrors = stats._queryErrors;
  delete out._queryErrors;

  // Revenue from Stripe overrides the stats source.
  if (s.stripe.secretKey) {
    try {
      const { payingSubscribers, trialingSubscribers, trialsEndingSoon, newTrialsToday, ...r } = await fetchStripe(s.stripe);
      out.revenue = { ...(out.revenue || {}), ...r };
      // Stripe fills in any subscriber counts the business data source didn't provide.
      const fromStripe = { paid: payingSubscribers, trialing: trialingSubscribers, total: payingSubscribers + trialingSubscribers, trialsEndingSoon, newTrialsToday };
      const own = Object.fromEntries(Object.entries(out.subscribers || {}).filter(([, v]) => v != null));
      out.subscribers = { history: [], ...fromStripe, ...own };
      out.sources.stripe = sourceStatus('live');
    }
    catch (e) { out.sources.stripe = sourceStatus('error', e.message); }
  } else out.sources.stripe = sourceStatus('off');
  if (out.revenue && !out.revenue.currency) out.revenue.currency = s.general.currency;

  // AI costs: Tutorise's own figures first (no admin keys needed). Provider
  // billing APIs are optional — on their own, or as a check alongside Tutorise.
  const fromTutorise = stats.costsRaw ? costsFromStats(stats.costsRaw, s.costs) : null;
  delete out.costsRaw;
  let billing = null, billingError = '';
  if (costsConfigured(s.costs)) {
    try { billing = await fetchCosts(s.costs); billingError = billing.errors.join(' · '); }
    catch (e) { billingError = e.message; }
  }
  if (fromTutorise) {
    out.costs = fromTutorise;
    if (billing) out.costs.billing = { mtd: billing.mtd, projected: billing.projected, dataThrough: billing.dataThrough, byProvider: billing.byProvider };
    out.sources.costs = sourceStatus(billingError ? 'error' : 'live', billingError ? `Tutorise OK; provider billing check: ${billingError}` : '');
  } else if (billing) {
    out.costs = { ...billing, source: 'billing' };
    out.sources.costs = sourceStatus(billingError ? 'error' : 'live', billingError);
  } else if (billingError) {
    out.sources.costs = sourceStatus('error', billingError);
    if (demo) out.costs = demoCosts();
  } else if (demo && out.sources.stats?.state !== 'live') { out.costs = demoCosts(); out.sources.costs = sourceStatus('demo'); }
  else out.sources.costs = sourceStatus('off', out.sources.stats?.state === 'live' ? 'Tutorise isn’t sending a “costs” section yet' : '');

  // Railway infrastructure
  if (railwayConfigured(s.railway)) {
    try { out.infra = await fetchRailway(s.railway); out.sources.railway = sourceStatus('live'); }
    catch (e) { out.sources.railway = sourceStatus('error', e.message); if (demo) out.infra = demoInfra(); }
  } else if (demo) { out.infra = demoInfra(); out.sources.railway = sourceStatus('demo'); }
  else out.sources.railway = sourceStatus('off');

  out.uptime = uptimeSnapshot(s.uptime);
  out.sources.uptime = sourceStatus(parseUrls(s.uptime.urls).length ? 'live' : 'off');

  // Inbox summary
  if (mail.emailConfigured(s.email)) {
    try { const { messages, unread } = await mail.listMessages(s.email); out.inbox = { unread, latest: messages.slice(0, 5) }; out.sources.email = sourceStatus('live'); }
    catch (e) { out.sources.email = sourceStatus('error', e.message); }
  } else if (demo) { const l = demoMail.list(); out.inbox = { unread: l.filter((m) => !m.seen).length, latest: l.slice(0, 5) }; out.sources.email = sourceStatus('demo'); }
  else out.sources.email = sourceStatus('off');

  out.tasks = tasksSummary();
  recordDaily(out);
  snapshot = out;
  broadcast('snapshot', snapshot);
  return snapshot;
}

// Keep one snapshot per day of the headline counts (live data only), so trend
// charts have history even when the database can't provide it.
function recordDaily(out) {
  const st = getState();
  st.daily ||= {};
  const today = new Date().toISOString().slice(0, 10);
  if (out.sources.stats?.state === 'live' || out.sources.stripe?.state === 'live') {
    const s = out.subscribers || {}, a = out.accounts || {};
    const rec = { subscribers: s.total, paid: s.paid, trialing: s.trialing, parents: a.parents, students: a.students };
    if (Object.values(rec).some((v) => v != null)) {
      st.daily[today] = rec;
      const keys = Object.keys(st.daily).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete st.daily[k];
      save();
    }
  }
  // Fill in subscriber history from local snapshots when the source has none.
  if (out.subscribers && !out.subscribers.history?.length && out.sources.stats?.state !== 'demo') {
    out.subscribers.history = Object.entries(st.daily).sort(([x], [y]) => x.localeCompare(y))
      .filter(([, v]) => v.subscribers != null).slice(-90).map(([date, v]) => ({ date, value: v.subscribers }));
    out.subscribers.historySource = 'local';
  }
}

let loop;
let collecting = false;
async function tick() {
  if (collecting) return;
  collecting = true;
  try { await collect(); } catch (e) { console.error('collect failed', e); } finally { collecting = false; }
}
function restartLoop() {
  clearInterval(loop);
  const s = getSettings();
  loop = setInterval(tick, Math.max(5, s.general.refreshSeconds) * 1000);
  startUptime(s.uptime, () => { snapshot.uptime = uptimeSnapshot(getSettings().uptime); broadcast('uptime', snapshot.uptime); });
  tick();
}
mail.setOnNewMail(() => setTimeout(async () => { await tick(); broadcast('mail', { at: Date.now() }); }, 500));

// ---------------------------------------------------------------- API
const api = express.Router();
api.use(requireAuth);

// Short git commit of the running code, so it's easy to confirm a pull took effect.
function buildId() {
  try {
    const git = path.join(__dirname, '../.git');
    let head = fs.readFileSync(path.join(git, 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref: ')) {
      const ref = head.slice(5);
      const loose = path.join(git, ref);
      head = fs.existsSync(loose) ? fs.readFileSync(loose, 'utf8').trim()
        : (fs.readFileSync(path.join(git, 'packed-refs'), 'utf8').split('\n').find((l) => l.endsWith(' ' + ref)) || '').split(' ')[0];
    }
    return head.slice(0, 7) || 'dev';
  } catch { return 'dev'; }
}
const BUILD = (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || buildId();
api.get('/version', (req, res) => res.json({ build: BUILD }));
api.get('/snapshot', async (req, res) => res.json(snapshot.updatedAt ? snapshot : await collect()));
api.post('/refresh', async (req, res) => { resetStripeCache(); resetCostsCache(); res.json(await collect()); });

api.get('/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

// Settings
api.get('/settings', (req, res) => res.json({ settings: getPublicSettings(), dataDir: DATA_DIR }));
api.put('/settings/:section', async (req, res) => {
  try {
    if (req.params.section === 'stats' && req.body?.databaseUrl && req.body.databaseUrl !== '__SET__') checkDbUrl(req.body.databaseUrl);
    updateSection(req.params.section, req.body);
    if (req.params.section === 'email') await mail.disconnectEmail();
    if (req.params.section === 'stripe') resetStripeCache();
    if (req.params.section === 'costs') resetCostsCache();
    restartLoop();
    res.json({ ok: true, settings: getPublicSettings() });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Test a connection using the form's values (falling back to stored secrets).
function merged(section, body) {
  const stored = getSettings()[section];
  const out = { ...stored };
  for (const [k, v] of Object.entries(body || {})) {
    if ((SECRET_FIELDS[section] || []).includes(k) && (v === '__SET__' || v === '')) continue;
    out[k] = v;
  }
  return out;
}
// Railway's DATABASE_URL uses a private hostname that only works inside Railway.
function checkDbUrl(url) {
  if (/\.railway\.internal\b/i.test(url)) throw new Error('That’s the internal DATABASE_URL (…railway.internal), which only works inside Railway. Use DATABASE_PUBLIC_URL instead — or press “Fetch from Railway”.');
  if (!/^postgres(ql)?:\/\//i.test(url)) throw new Error('The database URL should start with postgresql:// or postgres://');
}

// Pull DATABASE_PUBLIC_URL from Railway and save it (encrypted). The URL never goes to the browser.
api.post('/settings/stats/railway-db', async (req, res) => {
  try {
    const s = getSettings();
    if (!railwayConfigured(s.railway)) throw new Error('Connect Railway first (Settings → Railway: token and project ID).');
    const { url, service, environment, external } = await findDatabaseUrl(s.railway);
    updateSection('stats', { mode: 'postgres', databaseUrl: url, databaseSsl: true });
    restartLoop();
    res.json({ ok: true, message: external ? `“${service}” uses a database hosted outside Railway — found its URL and saved it.` : `Found the database in “${service}” (${environment}) and saved it.`, settings: getPublicSettings() });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

api.post('/settings/stats/detect', async (req, res) => {
  try {
    const cfg = merged('stats', req.body);
    if (!cfg.databaseUrl) throw new Error('No database URL saved yet. Press “Fetch from Railway”, or paste the DATABASE_PUBLIC_URL from your Postgres service’s Variables tab in Railway.');
    checkDbUrl(cfg.databaseUrl);
    res.json({ ok: true, ...(await detectSchema(cfg)) });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
api.post('/settings/:section/test', async (req, res) => {
  const section = req.params.section;
  const cfg = merged(section, req.body);
  try {
    let message;
    if (section === 'railway') message = await testRailway(cfg);
    else if (section === 'stats') {
      const r = await fetchStats(cfg);
      const found = ['subscribers', 'active', 'usage', 'revenue', 'ai'].filter((k) => r[k]);
      const sb = r.subscribers || {};
      message = `Connected — received ${found.join(', ') || 'no recognised sections'}. Subscribers: ${sb.total ?? '—'} total (${sb.paid ?? '—'} paid, ${sb.trialing ?? '—'} on trial)` + (r._queryErrors ? `. Query errors: ${Object.entries(r._queryErrors).map(([k, v]) => `${k}: ${v}`).join('; ')}` : '');
    } else if (section === 'costs') {
      const r = await fetchCosts(cfg, { force: true });
      resetCostsCache();
      const parts = r.byProvider.map((p) => `${p.name} £${p.mtd.toFixed(2)} so far`);
      message = `Connected — ${parts.join(', ')}; estimated £${r.projected.toFixed(2)} for the month` + (r.errors.length ? `. Problems: ${r.errors.join(' · ')}` : '');
    } else if (section === 'stripe') { resetStripeCache(); const r = await fetchStripe(cfg); message = `Connected — MRR ${r.currency} ${r.mrr.toFixed(2)}, ${r.payingSubscribers} paying and ${r.trialingSubscribers} trialing subscriptions`; resetStripeCache(); }
    else if (section === 'email') message = await mail.testEmail(cfg);
    else if (section === 'uptime') { const urls = parseUrls(cfg.urls); await checkAll(urls); message = `Checked ${urls.length} URLs`; }
    else throw new Error('Nothing to test');
    res.json({ ok: true, message });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// Email
const emailCfg = () => getSettings().email;
const usingDemoMail = () => !mail.emailConfigured(emailCfg()) && getSettings().general.demoMode;
api.get('/email', async (req, res) => {
  try {
    if (usingDemoMail()) { const l = demoMail.list(); return res.json({ messages: l, unread: l.filter((m) => !m.seen).length, demo: true }); }
    if (!mail.emailConfigured(emailCfg())) return res.json({ messages: [], unread: 0, notConfigured: true });
    res.json(await mail.listMessages(emailCfg()));
  } catch (e) { res.status(502).json({ error: e.message }); }
});
api.get('/email/:uid', async (req, res) => {
  try {
    if (usingDemoMail()) { demoMail.markSeen(req.params.uid); const m = demoMail.get(req.params.uid); return m ? res.json({ ...m, to: { name: 'You', address: 'hello@tutorise.uk' }, attachments: [] }) : res.status(404).json({ error: 'Not found' }); }
    res.json(await mail.getMessage(emailCfg(), req.params.uid));
  } catch (e) { res.status(502).json({ error: e.message }); }
});
api.post('/email/:uid/flag', async (req, res) => {
  try {
    if (usingDemoMail()) { if (req.body.flag === 'seen' && req.body.on) demoMail.markSeen(req.params.uid); return res.json({ ok: true }); }
    await mail.setFlag(emailCfg(), req.params.uid, req.body.flag, !!req.body.on);
    res.json({ ok: true });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
api.post('/email/:uid/reply', async (req, res) => {
  if (!req.body?.text?.trim()) return res.status(400).json({ error: 'Reply is empty' });
  try {
    if (usingDemoMail()) { demoMail.markAnswered(req.params.uid); return res.json({ ok: true, demo: true }); }
    res.json(await mail.sendReply(emailCfg(), req.params.uid, req.body));
    tick();
  } catch (e) { res.status(502).json({ error: e.message }); }
});

api.use('/tasks', tasksRouter((summary) => { snapshot.tasks = summary; broadcast('tasks', summary); }));
app.use('/api', api);

// Static frontend
app.use('/vendor/webauthn.js', express.static(path.join(__dirname, '../node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js')));
app.use(express.static(path.join(__dirname, '../public'), { extensions: ['html'], setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

app.listen(PORT, HOST, () => {
  const where = HOSTED ? (PUBLIC_URL || 'your Railway address') : `http://localhost:${PORT}`;
  if (HOSTED && PUBLIC_URL_RAW && PUBLIC_URL_RAW.replace(/\/+$/, '').toLowerCase() !== PUBLIC_URL.toLowerCase()) console.log(`  Public address “${PUBLIC_URL_RAW}” is used as ${PUBLIC_URL}.`);
  console.log(`\n  Tutorise Dashboard running → ${where}  (build ${BUILD}${HOSTED ? ', hosted' : ''}${cfAccessEnabled ? ', Cloudflare Access required' : ''})\n  Data directory: ${DATA_DIR}\n`);
  if (HOSTED && !PUBLIC_URL) console.log('  No DASH_PUBLIC_URL or Railway domain variable: the dashboard uses the address each request arrives on.\n');
  if (HOSTED && !cfAccessEnabled) console.warn('  Note: Cloudflare Access is not configured. The dashboard is protected only by its own sign-in (see DEPLOY.md).\n');
  restartLoop();
});
