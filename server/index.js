// Tutorise Dashboard — local server. Binds to localhost only.
import express from 'express';
import session from 'express-session';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRouter, requireAuth } from './auth.js';
import { getSettings, getPublicSettings, updateSection, DATA_DIR, SECRET_FIELDS } from './store.js';
import { demoStats, demoInfra, demoMail } from './sources/demo.js';
import { fetchStats, statsConfigured } from './sources/stats.js';
import { fetchRailway, railwayConfigured, testRailway } from './sources/railway.js';
import { fetchStripe, resetStripeCache } from './sources/stripe.js';
import { startUptime, uptimeSnapshot, checkAll, parseUrls } from './sources/uptime.js';
import * as mail from './sources/email.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4747;
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Passkeys are bound to a hostname; keep everyone on "localhost".
app.use((req, res, next) => {
  if (req.hostname === '127.0.0.1') return res.redirect(`http://localhost:${PORT}${req.originalUrl}`);
  next();
});

// Reject cross-site state-changing requests.
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('origin');
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Bad origin' });
  next();
});

app.use((req, res, next) => {
  res.set({
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-src 'self' blob:; connect-src 'self'",
  });
  next();
});

app.use(session({
  name: 'tdash.sid',
  secret: crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', maxAge: 12 * 3_600_000 },
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
    try { const r = await fetchStripe(s.stripe); out.revenue = { ...(out.revenue || {}), ...r }; out.sources.stripe = sourceStatus('live'); }
    catch (e) { out.sources.stripe = sourceStatus('error', e.message); }
  } else out.sources.stripe = sourceStatus('off');
  if (out.revenue && !out.revenue.currency) out.revenue.currency = s.general.currency;

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

  snapshot = out;
  broadcast('snapshot', snapshot);
  return snapshot;
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

api.get('/snapshot', async (req, res) => res.json(snapshot.updatedAt ? snapshot : await collect()));
api.post('/refresh', async (req, res) => { resetStripeCache(); res.json(await collect()); });

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
    updateSection(req.params.section, req.body);
    if (req.params.section === 'email') await mail.disconnectEmail();
    if (req.params.section === 'stripe') resetStripeCache();
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
api.post('/settings/:section/test', async (req, res) => {
  const section = req.params.section;
  const cfg = merged(section, req.body);
  try {
    let message;
    if (section === 'railway') message = await testRailway(cfg);
    else if (section === 'stats') {
      const r = await fetchStats(cfg);
      const found = ['subscribers', 'active', 'usage', 'revenue', 'ai'].filter((k) => r[k]);
      message = `Connected — received ${found.join(', ') || 'no recognised sections'}` + (r._queryErrors ? `. Query errors: ${Object.entries(r._queryErrors).map(([k, v]) => `${k}: ${v}`).join('; ')}` : '');
    } else if (section === 'stripe') { resetStripeCache(); const r = await fetchStripe(cfg); message = `Connected — MRR ${r.currency} ${r.mrr.toFixed(2)}, ${r.payingSubscribers} active subscriptions`; resetStripeCache(); }
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

app.use('/api', api);

// Static frontend
app.use('/vendor/webauthn.js', express.static(path.join(__dirname, '../node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js')));
app.use(express.static(path.join(__dirname, '../public'), { extensions: ['html'] }));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

app.listen(PORT, HOST, () => {
  console.log(`\n  Tutorise Dashboard running → http://localhost:${PORT}\n  Data directory: ${DATA_DIR}\n`);
  restartLoop();
});
