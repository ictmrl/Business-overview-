import { areaChart, barChart, hBars, donut, ring, sparkline, uptimeStrip, countUp, compact, esc, hideTip } from './charts.js';
import { REPEATS, statusOf, dueLabel, occurrences, summarise, addDays } from './tasks-core.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const root = $('#root');

// ------------------------------------------------------------------ helpers
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/auth')) { boot(); throw new Error('Signed out'); }
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
function toast(msg, action) {
  const t = $('#toast');
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-action'; b.textContent = action.label;
    b.onclick = () => { t.classList.remove('show'); action.run(); };
    t.append(' ', b);
  }
  t.classList.add('show');
  clearTimeout(t.__t);
  t.__t = setTimeout(() => t.classList.remove('show'), action ? 6000 : 2800);
}
// ---- Home Screen app, push notifications and badge
const isInstalledApp = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let swReg = null;
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((r) => { swReg = r; }).catch(() => {});
}
async function setBadge(n) {
  try {
    if (navigator.setAppBadge) { if (n > 0) await navigator.setAppBadge(n); else await navigator.clearAppBadge(); }
    else navigator.serviceWorker?.controller?.postMessage({ type: 'badge', count: n });
  } catch { /* badges not supported here */ }
}
/** The app was opened or brought to the front: new subscribers count as seen. */
async function markAppSeen() {
  try { const r = await api('/api/push/seen', { body: {} }); setBadge(r.badge?.total || 0); } catch {}
}

const money = (v, cur = 'GBP', dp = 0) => v == null ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, maximumFractionDigits: dp, minimumFractionDigits: dp }).format(v);
const int = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-GB'));
const pct = (v, dp = 1) => (v == null ? '—' : `${v.toFixed(dp)}%`);
function ago(d) {
  if (!d) return '';
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function delta(history, days = 30) {
  if (!history?.length) return null;
  const h = history.slice(-days);
  const a = h[0].value, b = h.at(-1).value;
  if (!a) return null;
  return ((b - a) / a) * 100;
}
const deltaHtml = (d, label = 'vs 30d') => d == null ? '' : `<span class="delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}%</span><span>${label}</span>`;

const I = {
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m22 7-10 6L2 7"/></svg>',
  ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>',
  infra: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
  activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  pound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 7a4 4 0 0 0-7-2.6C10 5.5 10 7 10 9v3c0 3-1 6-4 7h12M6 12h8"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 11a4 4 0 1 0-4 4"/><path d="M8 3a8 8 0 0 1 8 8v2"/><path d="M4 7a8 8 0 0 0-1 4c0 2 .5 3.5 1.3 5"/><path d="M12 11v3c0 3 1 5 2 7"/><path d="M16 17c0 1.5.3 3 1 4"/><path d="M20 11c0 2-.2 4 .5 6"/></svg>',
  reply: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 14-5-5 5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="m9 15 2 2 4-4"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
};

// ------------------------------------------------------------------ boot / auth
let state = { snap: null, auth: null, view: null, es: null };

let booting = null;
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.auth?.authed) markAppSeen(); });

async function boot() {
  // Coalesce overlapping calls (e.g. auto passkey prompt + button click both signing in).
  if (booting) return booting;
  booting = (async () => {
    state.es?.close();
    // Forget the previous view: the DOM is about to be replaced, so the next route() must render.
    state.view?.destroy?.();
    state.view = null;
    state.auth = await api('/api/auth/status');
    if (!state.auth.authed) return renderAuth();
    renderShell();
  })();
  try { return await booting; } finally { booting = null; }
}

function renderAuth() {
  const a = state.auth;
  const supportsPasskey = !!window.PublicKeyCredential;
  if (a.setupRequired) {
    root.innerHTML = `<div class="auth"><form class="auth-card" id="setup">
      <div class="logo">T</div>
      <h1>Welcome to Tutorise HQ</h1>
      <p>Create the owner account for this dashboard. You'll add a passkey (Touch ID) next.</p>
      <div class="field"><label for="n">Your name</label><input id="n" type="text" required autocomplete="name"></div>
      <div class="field"><label for="e">Email</label><input id="e" type="email" autocomplete="username"></div>
      ${a.setupTokenRequired ? `<div class="field"><label for="st">Setup token</label><input id="st" type="password" required autocomplete="off"><span class="hint">The DASH_SETUP_TOKEN value from your Railway variables. Only needed once.</span></div>` : ''}
      <div class="field"><label for="p">Password</label><input id="p" type="password" required minlength="10" autocomplete="new-password"><span class="hint">At least 10 characters — used as a fallback to your passkey.</span></div>
      <button class="btn primary block">Create account</button>
      <div class="error-msg" id="err"></div>
    </form></div>`;
    $('#setup').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/api/auth/setup', { body: { name: $('#n').value, email: $('#e').value, password: $('#p').value, setupToken: $('#st')?.value, remember: isInstalledApp() } });
        await boot();
        if (supportsPasskey) setTimeout(() => offerPasskey(), 600);
      } catch (err) { $('#err').textContent = err.message; }
    };
    return;
  }
  root.innerHTML = `<div class="auth"><div class="auth-card">
    <div class="logo">T</div>
    <h1>Tutorise HQ</h1>
    <p>Sign in to see the business at a glance.</p>
    ${supportsPasskey ? `<button class="btn primary block" id="pk">${I.key} Sign in with passkey</button>${a.passwordLogin ? '<div class="divider">or use your password</div>' : ''}` : ''}
    ${a.passwordLogin ? `<form id="pw"><div class="field"><label for="p">Password</label><input id="p" type="password" autocomplete="current-password" ${a.hasPasskeys ? '' : 'autofocus'}></div>
    <button class="btn block">Sign in</button></form>` : `<p class="muted" style="font-size:12.5px;margin:14px 0 0">Password sign-in is turned off for this dashboard.</p>`}
    <div class="error-msg" id="err"></div>
  </div></div>`;
  if ($('#pw')) $('#pw').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/auth/login', { body: { password: $('#p').value, remember: isInstalledApp() } }); boot(); }
    catch (err) { $('#err').textContent = err.message; }
  };
  $('#pk')?.addEventListener('click', passkeyLogin);
  if (a.hasPasskeys && supportsPasskey) setTimeout(passkeyLogin, 300);
}

async function passkeyLogin() {
  try {
    const optionsJSON = await api('/api/auth/passkey/login/options', { method: 'POST', body: {} });
    const response = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON });
    await api('/api/auth/passkey/login/verify', { body: { response, remember: isInstalledApp() } });
    boot();
  } catch (err) {
    if (err.name !== 'NotAllowedError' && $('#err')) $('#err').textContent = err.message;
  }
}

async function registerPasskey(label) {
  const optionsJSON = await api('/api/auth/passkey/register/options', { method: 'POST', body: {} });
  const response = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON });
  await api('/api/auth/passkey/register/verify', { body: { response, label } });
}

// Browser-side passkey errors in plain words (a cancelled prompt stays quiet).
function passkeyError(err, cancelledMsg) {
  if (err?.name === 'NotAllowedError') return cancelledMsg;
  if (err?.name === 'SecurityError') return 'The browser won’t create a passkey for this address. Open the dashboard at its https:// address, not an IP address or a different domain.';
  if (err?.name === 'InvalidStateError') return 'This device already has a passkey for this dashboard.';
  return err?.message || 'Passkey failed';
}

async function offerPasskey() {
  try {
    await registerPasskey(navigator.platform?.includes('Mac') ? 'Mac (Touch ID)' : 'This device');
    toast('Passkey added — you can sign in with Touch ID next time');
    state.auth = await api('/api/auth/status');
  } catch (err) {
    const msg = passkeyError(err, '');
    if (msg) toast(msg);
  }
}

// ------------------------------------------------------------------ shell
const VIEWS = {
  overview: { title: 'Overview', icon: 'overview', render: renderOverview },
  tasks: { title: 'Tasks', icon: 'tasks', render: renderTasks },
  inbox: { title: 'Inbox', icon: 'mail', render: renderInbox },
  ai: { title: 'AI Challenges', icon: 'ai', render: renderAI },
  infra: { title: 'Infrastructure', icon: 'infra', render: renderInfra },
  settings: { title: 'Settings', icon: 'settings', render: renderSettings },
};

function renderShell() {
  const u = state.auth.user || { name: 'Owner' };
  const theme = document.documentElement.dataset.theme || 'dark';
  root.innerHTML = `<div class="app">
    <aside class="sidebar">
      <div class="brand"><div class="logo sm">T</div><div><b id="biz">Tutorise</b><span>Business HQ</span></div></div>
      <nav class="nav">${Object.entries(VIEWS).map(([k, v]) => `<button data-view="${k}">${I[v.icon]}<span>${v.title}</span>${k === 'inbox' ? '<span class="badge" id="unread-badge" hidden></span>' : ''}${k === 'tasks' ? '<span class="badge" id="tasks-badge" hidden></span>' : ''}</button>`).join('')}</nav>
      <div class="sidebar-foot">
        <div class="user-chip"><div class="avatar">${esc(u.name[0] || '?')}</div><div class="grow"><div>${esc(u.name)}</div><div class="muted" style="font-size:11.5px">${esc(u.email || 'Owner')}</div></div></div>
        <button class="btn ghost sm" id="logout">${I.logout} Sign out</button>
        <div class="muted" style="font-size:11px;text-align:center" id="build"></div>
      </div>
    </aside>
    <main class="main" id="main">
      <header class="topbar">
        <div><h2 id="view-title">Overview</h2><div class="sub" id="updated">Connecting…</div></div>
        <div class="spacer"></div>
        <span class="live off" id="live"><i></i><span>Live</span></span>
        <span class="clock" id="clock"></span>
        <button class="icon-btn" id="theme" title="Toggle theme">${theme === 'light' ? I.moon : I.sun}</button>
        <button class="icon-btn" id="refresh" title="Refresh now">${I.refresh}</button>
      </header>
      <div id="view"></div>
    </main>
  </div>`;
  $$('.nav button').forEach((b) => (b.onclick = () => (location.hash = b.dataset.view)));
  $('#logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); boot(); };
  $('#refresh').onclick = async () => {
    const b = $('#refresh'); b.classList.add('spin');
    try { setSnap(await api('/api/refresh', { method: 'POST', body: {} })); toast('Refreshed'); } catch (e) { toast(e.message); }
    b.classList.remove('spin');
  };
  $('#theme').onclick = () => {
    const next = (document.documentElement.dataset.theme || 'dark') === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch {}
    $('#theme').innerHTML = next === 'light' ? I.moon : I.sun;
    route(true);
  };
  const tickClock = () => { const c = $('#clock'); if (c) c.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  tickClock(); clearInterval(state.clockT); state.clockT = setInterval(() => { tickClock(); updateAgo(); }, 1000);
  api('/api/version').then((v) => { const b = $('#build'); if (b) b.textContent = `Build ${v.build}`; }).catch(() => {});
  markAppSeen();
  connectStream();
  window.onhashchange = () => route();
  route(true);
}

function connectStream() {
  state.es?.close();
  const es = new EventSource('/api/stream');
  state.es = es;
  es.addEventListener('snapshot', (e) => setSnap(JSON.parse(e.data)));
  es.addEventListener('uptime', (e) => { if (state.snap) { state.snap.uptime = JSON.parse(e.data); state.view?.update?.(state.snap, 'uptime'); } });
  es.addEventListener('mail', () => { state.view?.onMail?.(); toast('New email arrived'); });
  es.addEventListener('badge', (e) => setBadge(JSON.parse(e.data).total || 0));
  es.addEventListener('tasks', (e) => { const t = JSON.parse(e.data); if (state.snap) state.snap.tasks = t; drawTasksBadge(t); state.view?.onTasks?.(); });
  es.onopen = () => $('#live')?.classList.remove('off');
  es.onerror = async () => {
    $('#live')?.classList.add('off');
    // If the session expired, go back to sign-in.
    const s = await fetch('/api/auth/status').then((r) => r.json()).catch(() => null);
    if (s && !s.authed) { es.close(); boot(); }
  };
}

function setSnap(snap) {
  if (!snap?.updatedAt) return;
  state.snap = snap;
  $('#biz') && ($('#biz').textContent = snap.businessName || 'Tutorise');
  drawTasksBadge(snap.tasks);
  if (snap.badge) setBadge(snap.badge.total);
  const ub = $('#unread-badge');
  if (ub) { const n = snap.inbox?.unread || 0; ub.hidden = !n; ub.textContent = n; }
  updateAgo();
  state.view?.update?.(snap);
}
function updateAgo() {
  const el = $('#updated');
  if (el && state.snap?.updatedAt) el.textContent = `Updated ${ago(state.snap.updatedAt)} · ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`;
}

function route(force) {
  const key = (location.hash.slice(1) || 'overview').split('/')[0];
  const v = VIEWS[key] || VIEWS.overview;
  if (!force && state.view?.key === key) return;
  hideTip();
  state.view?.destroy?.();
  $$('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === key));
  $('#view-title').textContent = v.title;
  const container = $('#view');
  container.innerHTML = '';
  state.view = { key, ...(v.render(container) || {}) };
  if (state.snap) state.view.update?.(state.snap, 'init');
  $('#main').scrollTop = 0;
}

// ------------------------------------------------------------------ shared bits
function sourceChips(snap) {
  const names = { stats: 'Business data', railway: 'Railway', stripe: 'Stripe', costs: 'AI costs', uptime: 'Uptime', email: 'Email' };
  const map = { live: ['good', 'Live'], demo: ['demo', 'Demo'], error: ['critical', 'Error'], off: ['neutral', 'Not set'] };
  return Object.entries(names).map(([k, n]) => {
    const s = snap.sources?.[k] || { state: 'off' };
    const [cls, label] = map[s.state] || map.off;
    return `<a href="#settings" class="status ${cls}" title="${esc(s.message || '')}" style="text-decoration:none">${n}: ${label}</a>`;
  }).join(' ');
}
function demoBanner(snap) {
  const demo = Object.entries(snap.sources || {}).filter(([, s]) => s.state === 'demo').length;
  const errs = Object.entries(snap.sources || {}).filter(([, s]) => s.state === 'error');
  if (errs.length) return `<div class="banner warn"><span class="status critical">Connection issue</span><span>${errs.map(([k, s]) => `<b>${esc(k)}</b>: ${esc(s.message)}`).join(' · ')}</span><a href="#settings" style="margin-left:auto">Fix in Settings →</a></div>`;
  const qe = Object.entries(snap.queryErrors || {});
  if (qe.length) return `<div class="banner warn"><span class="status warning">${qe.length} ${qe.length === 1 ? 'query' : 'queries'} failed</span><span>These panels show “—” until the SQL matches your schema: ${qe.map(([k, v]) => `<b title="${esc(v)}">${esc(k)}</b>`).join(', ')}. <span class="muted">${esc(qe[0][1])}</span></span><a href="#settings/stats" style="margin-left:auto;white-space:nowrap">Detect / edit queries →</a></div>`;
  if (demo) return `<div class="banner"><span class="status demo">Demo data</span><span>Some panels are showing sample data. Connect Railway, your stats source and IMAP in <a href="#settings">Settings</a> to go live.</span></div>`;
  return '';
}
/** Paid vs trial split: a two-segment bar plus labelled counts (never colour alone). */
/**
 * Plan split: a segmented bar plus labelled counts (never colour alone).
 * s: { paid, trialing, free?, inactive?, total?, trialsEndingSoon? }. Segments the
 * source doesn't send are left out; any remainder of `total` shows as "other"
 * (or "no plan" when free/inactive aren't reported).
 */
function drawSplit(box, s) {
  if (!box) return;
  if (!s || (s.paid == null && s.trialing == null)) { box.innerHTML = ''; box.__sig = ''; return; }
  const segs = [
    { k: 'paid', label: 'paid', v: s.paid },
    { k: 'trial', label: 'trial', v: s.trialing },
    { k: 'free', label: 'free', v: s.free },
    { k: 'inactive', label: 'inactive', v: s.inactive },
  ].filter((x) => x.v != null);
  const known = segs.reduce((t, x) => t + (x.v || 0), 0);
  const rest = s.total != null && s.total > known ? s.total - known : 0;
  if (rest) segs.push({ k: 'none', label: s.free == null && s.inactive == null ? 'no plan' : 'other', v: rest });
  const tot = segs.reduce((t, x) => t + x.v, 0) || 1;
  const sig = segs.map((x) => x.k + x.label).join('|');
  if (box.__sig !== sig) {
    box.innerHTML = `<div class="split-bar" role="img">${segs.map((x) => `<i class="${x.k}"></i>`).join('')}</div>
      <div class="split-legend">${segs.map((x) => `<span><i class="${x.k}"></i><b class="sp-${x.k}">—</b> ${x.label}</span>`).join('')}<span class="muted sp-ending"></span></div>`;
    box.__sig = sig;
  }
  box.querySelector('.split-bar').setAttribute('aria-label', segs.map((x) => `${x.v} ${x.label}`).join(', '));
  requestAnimationFrame(() => segs.forEach((x) => { box.querySelector(`.split-bar .${x.k}`).style.width = `${(x.v / tot) * 100}%`; }));
  segs.forEach((x) => countUp(box.querySelector(`.sp-${x.k}`), x.v));
  box.querySelector('.sp-ending').textContent = s.trialsEndingSoon ? `${int(s.trialsEndingSoon)} trials ending ≤3 days` : '';
}

const serviceStatus = (s) => {
  const ok = ['SUCCESS'], warn = ['BUILDING', 'DEPLOYING', 'INITIALIZING', 'QUEUED', 'WAITING', 'SLEEPING'];
  if (ok.includes(s)) return ['good', 'Healthy'];
  if (warn.includes(s)) return ['warning', s[0] + s.slice(1).toLowerCase()];
  if (s === 'NO_DEPLOYMENT') return ['neutral', 'No deploys'];
  return ['critical', s ? s[0] + s.slice(1).toLowerCase() : 'Unknown'];
};
// AI challenges: flags raised against AI tutor responses, by type (Response unsure,
// Content drift, Reported errors, Reversals, Rule breaks, Unsupported claims,
// Board claims, Verifier findings, Educator).
// Status colours: resolved → green; non-issue / duplicate → blue; anything else → red (action required).
const tidy = (v) => { const t = String(v).replace(/[_-]+/g, ' ').trim().toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };
function challengeStatus(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  if (/resolv/i.test(v)) return ['good', tidy(v), 'Resolved'];
  if (/non.?issue|not.?an?.?issue/i.test(v)) return ['info', 'Non-issue', 'Closed: not an issue'];
  if (/duplic|dupe/i.test(v)) return ['info', 'Duplicate', 'Closed: duplicate'];
  return ['critical', tidy(v), 'Action required'];
}
const challengeRow = (c, isNew, showStatus) => {
  const st = challengeStatus(c.status) || (showStatus ? ['critical', 'Open', 'Action required'] : null);
  return `<div class="row chal-row ${showStatus ? 'with-status' : ''} ${isNew ? 'new' : ''}">
    <span class="tag type-tag" title="${esc(c.type || 'Other')}">${esc(c.type || 'Other')}</span>
    <div class="title" title="${esc(c.summary)}">${esc(c.summary || '—')}</div>
    ${showStatus ? `<span class="status ${st[0]}" title="${esc(st[2])}">${esc(st[1])}</span>` : ''}
    <span class="time">${ago(c.createdAt)}</span></div>`;
};
// Show the status column only if the backend sends statuses at all.
const hasStatuses = (list) => (list || []).some((c) => c.status);
/** The "Open" tile: red with the count if anything is unresolved, green if none, neutral if unknown. */
function drawOpenTile(box, open) {
  if (!box) return;
  box.classList.toggle('alert', open > 0);
  box.classList.toggle('ok', open === 0);
  countUp(box.querySelector('.v'), open);
  box.querySelector('.open-note').textContent = open == null ? 'not reported' : open > 0 ? 'Action required' : 'All resolved';
}
const challengeKey = (c) => c.createdAt + '|' + c.type + '|' + c.summary;
const shortUrl = (u) => u.replace(/^https?:\/\//, '').replace(/\/$/, '');

// ------------------------------------------------------------------ overview
function renderOverview(el) {
  let metric = 'subscribers', range = 30, seenAI = new Set(), first = true;
  el.innerHTML = `<div class="view">
    <div id="ov-banner"></div>
    <div class="grid g-4">
      <button class="card hero lead" data-metric="subscribers" style="--c:var(--series-1)"><div class="label"><i>${I.users}</i>Subscribers <span class="muted" style="font-weight:400">paid + trial</span></div><div class="value" id="h-subs">—</div><div class="split" id="h-subs-split"></div><div class="meta" id="h-subs-m"></div><div class="spark-wrap" id="h-subs-s"></div></button>
      <button class="card hero" data-metric="active" style="--c:var(--series-3)"><div class="label"><i>${I.activity}</i>Active users today</div><div class="value" id="h-act">—</div><div class="meta" id="h-act-who"></div><div class="meta" id="h-act-m"></div><div class="spark-wrap" id="h-act-s"></div></button>
      <button class="card hero" data-metric="revenue" style="--c:var(--series-7)"><div class="label"><i>${I.pound}</i>Monthly recurring revenue</div><div class="value" id="h-mrr">—</div><div class="meta" id="h-mrr-m"></div>
        <div class="cost-block" id="h-cost" hidden role="button" tabindex="0" title="Show daily AI costs in the chart below">
          <div class="cost-row"><span>AI costs this month</span><b id="h-cost-mtd">—</b></div>
          <div class="cost-row"><span>Estimated for the month</span><b id="h-cost-est">—</b></div>
          <div class="cost-bar" aria-hidden="true"><i id="h-cost-bar"></i></div>
          <div class="cost-note" id="h-cost-note"></div>
        </div>
        <div class="spark-wrap" id="h-mrr-s"></div></button>
      <button class="card hero" data-metric="uptime" style="--c:var(--series-4)"><div class="label"><i>${I.shield}</i>Uptime (24h)</div><div class="value" id="h-up">—</div><div class="meta" id="h-up-m"></div><div class="spark-wrap" id="h-up-s" style="padding:8px 20px 14px;height:auto"></div></button>
    </div>
    <div class="card" id="accounts-card">
      <div class="card-head"><h3>Accounts</h3><span class="sub">who's signed up, by plan</span></div>
      <div class="banner" id="ac-hint" hidden style="margin-bottom:12px">Parent and student counts aren't coming through yet. In <a href="#settings/stats">Settings → Business data</a>, press <b>Detect from database</b> to map your tables automatically.</div>
      <div class="grid g-4" style="gap:12px">
        <div class="mini"><div class="k">Parents <span id="ac-par-n" class="acc-new"></span></div><div class="v" id="ac-par">—</div><div class="split" id="ac-par-split"></div></div>
        <div class="mini"><div class="k">Students <span id="ac-stu-n" class="acc-new"></span></div><div class="v" id="ac-stu">—</div><div class="split" id="ac-stu-split"></div></div>
        <div class="mini"><div class="k">Students per parent</div><div class="v" id="ac-ratio">—</div><div class="muted acc-sub">average family size</div></div>
        <div class="mini" title="Average number of subjects each child studies, counting children whose parent is on a paid or trial plan (not free)"><div class="k">Subjects per child</div><div class="v" id="ac-subj">—</div><div class="muted acc-sub" id="ac-subj-n">paid + trial plans</div></div>
      </div>
    </div>
    <div class="grid g-main">
      <div class="card">
        <div class="card-head"><h3 id="main-title">Subscribers</h3><span class="sub" id="main-sub"></span>
          <div class="right"><div class="seg" id="range"><button data-r="7">7D</button><button data-r="14">14D</button><button data-r="30" class="on">30D</button></div></div></div>
        <div class="chart-box" id="main-chart"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Today</h3><span class="sub">sessions by hour</span></div>
        <div class="chart-box sm" id="hours"></div>
        <div class="stats-row" style="margin-top:14px;grid-template-columns:repeat(2,minmax(0,1fr))">
          <div class="mini"><div class="k">Sessions</div><div class="v" id="t-sess">—</div></div>
          <div class="mini"><div class="k">New subs</div><div class="v" id="t-new">—</div></div>
          <div class="mini"><div class="k">New trials</div><div class="v" id="t-trials">—</div></div>
          <div class="mini"><div class="k">Revenue</div><div class="v" id="t-rev">—</div></div>
        </div>
      </div>
    </div>
    <div class="grid g-3">
      <div class="card">
        <div class="card-head"><h3>AI challenges</h3><span class="sub">flags on AI tutor responses</span><div class="right"><a href="#ai" class="btn sm ghost">Details →</a></div></div>
        <div class="stats-row" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:16px">
          <div class="mini open-tile" id="ai-open"><div class="k">Open</div><div class="v">—</div><div class="open-note"></div></div>
          <div class="mini"><div class="k">Today</div><div class="v" id="ai-today">—</div></div>
          <div class="mini"><div class="k">Last 7 days</div><div class="v" id="ai-week">—</div></div>
        </div>
        <div class="muted" style="font-size:12px;margin-bottom:8px">Most frequent types · last 30 days</div>
        <div class="hbars" id="ai-types"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Inbox</h3><span class="sub" id="ib-sub"></span><div class="right"><a href="#inbox" class="btn sm ghost">Open →</a></div></div>
        <div class="list" id="ib-list"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>System health</h3><span class="sub" id="sys-sub"></span><div class="right"><a href="#infra" class="btn sm ghost">Details →</a></div></div>
        <div class="list" id="sys-list"></div>
        <div id="sys-uptime" style="margin-top:14px;display:grid;gap:12px"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Latest AI challenges</h3><span class="sub">newest first</span><div class="right"><a href="#ai" class="btn sm ghost">All →</a></div></div>
      <div class="list" id="ai-feed"></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap" id="chips"></div>
  </div>`;

  const showCosts = (e) => { e.stopPropagation(); metric = 'costs'; first = true; drawMain(state.snap); };
  $('#h-cost', el).addEventListener('click', showCosts);
  $('#h-cost', el).addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showCosts(e); } });
  $$('.hero', el).forEach((h) => (h.onclick = () => {
    if (h.dataset.metric === 'uptime') { location.hash = 'infra'; return; }
    metric = h.dataset.metric; first = true; drawMain(state.snap);
  }));
  $$('#range button', el).forEach((b) => (b.onclick = () => {
    range = +b.dataset.r; $$('#range button', el).forEach((x) => x.classList.toggle('on', x === b)); first = true; drawMain(state.snap);
  }));

  function drawMain(snap) {
    if (!snap) return;
    $$('.hero', el).forEach((h) => h.classList.toggle('selected', h.dataset.metric === metric || (metric === 'costs' && h.dataset.metric === 'revenue')));
    const cur = snap.revenue?.currency || 'GBP';
    const cfg = {
      subscribers: { title: 'Subscribers', sub: 'total active subscriptions', data: snap.subscribers?.history, color: 'var(--series-1)', fmt: int, zero: false },
      active: { title: 'Active customers', sub: 'daily active users', data: snap.active?.history, color: 'var(--series-3)', fmt: int, zero: false },
      costs: { title: 'AI costs', sub: snap.costs?.source === 'billing' ? 'daily spend from provider billing (converted to £)' : 'daily spend logged by Tutorise (converted to £)', data: snap.costs?.history, color: 'var(--series-2)', fmt: (v) => money(v, 'GBP', 2), axis: true },
      revenue: { title: 'Revenue', sub: 'daily collected revenue', data: snap.revenue?.history, color: 'var(--series-7)', fmt: (v) => money(v, cur, 2), axis: (v) => money(v, cur).replace(/\.00$/, '') },
    }[metric];
    $('#main-title', el).textContent = cfg.title;
    $('#main-sub', el).textContent = metric === 'subscribers' && snap.subscribers?.historySource === 'local'
      ? `recorded daily by this dashboard · ${snap.subscribers.history.length} day${snap.subscribers.history.length === 1 ? '' : 's'} so far` : cfg.sub;
    const data = (cfg.data || []).slice(-range);
    const box = $('#main-chart', el);
    if (!data.length) { box.innerHTML = `<div class="empty">No history yet for ${esc(cfg.title.toLowerCase())}.</div>`; box.__chart = null; return; }
    areaChart(box, data, { color: cfg.color, format: cfg.fmt, axisFormat: cfg.axis ? (v) => compact(v) : undefined, animate: first, zero: cfg.zero, label: cfg.title + ' trend' });
    first = false;
  }

  function drawAccounts(snap) {
    const ac = snap.accounts || {};
    countUp($('#ac-par', el), ac.parents);
    countUp($('#ac-stu', el), ac.students);
    $('#ac-par-n', el).textContent = ac.parentsNewToday ? `+${int(ac.parentsNewToday)} today` : '';
    $('#ac-stu-n', el).textContent = ac.studentsNewToday ? `+${int(ac.studentsNewToday)} today` : '';
    drawSplit($('#ac-par-split', el), { paid: ac.parentsPaid, trialing: ac.parentsTrialing, free: ac.parentsFree, inactive: ac.parentsInactive, total: ac.parents });
    drawSplit($('#ac-stu-split', el), { paid: ac.studentsPaid, trialing: ac.studentsTrialing, free: ac.studentsFree, inactive: ac.studentsInactive, total: ac.students });
    const missing = ac.parents == null && ac.students == null;
    $('#ac-hint', el).hidden = !missing || snap.sources?.stats?.state === 'demo';
    const ratio = ac.parents && ac.students != null ? ac.students / ac.parents : null;
    countUp($('#ac-ratio', el), ratio, (n) => n.toFixed(2));
    // Subjects per child: children of parents on paid or trial plans (not free), worked out by Tutorise.
    countUp($('#ac-subj', el), ac.subjectsPerChild, (n) => n.toFixed(1));
    const split = [ac.subjectsPerChildPaid != null && `paid ${ac.subjectsPerChildPaid.toFixed(1)}`, ac.subjectsPerChildTrial != null && `trial ${ac.subjectsPerChildTrial.toFixed(1)}`].filter(Boolean);
    $('#ac-subj-n', el).textContent = ac.subjectsPerChild == null ? 'not sent by Tutorise yet'
      : split.length ? split.join(' · ') : `paid + trial plans${ac.subjectsChildren != null ? ` · ${int(ac.subjectsChildren)} children` : ''}`;
  }

  function drawCosts(snap) {
    const c = snap.costs, box = $('#h-cost', el);
    box.hidden = !c;
    if (!c) return;
    countUp($('#h-cost-mtd', el), c.mtd, (n) => money(n, 'GBP'));
    countUp($('#h-cost-est', el), c.projected, (n) => money(n, 'GBP'));
    requestAnimationFrame(() => ($('#h-cost-bar', el).style.width = `${c.projected ? Math.min(100, (c.mtd / c.projected) * 100) : 0}%`));
    const parts = (c.byProvider || []).map((p) => `${p.name} ${money(p.mtd, 'GBP')}`);
    const top = (c.byFeature || [])[0];
    if (top) parts.push(`top: ${top.name} ${money(top.mtd, 'GBP')}`);
    if (c.billing) parts.push(`billed so far ${money(c.billing.mtd, 'GBP')}`);
    const mrr = snap.revenue?.mrr;
    const margin = mrr != null && c.projected != null ? mrr - c.projected : null;
    const marginHtml = margin == null ? '' : `<span class="${margin >= 0 ? 'pos' : 'neg'}" title="MRR minus the estimated AI costs for this month">MRR after AI costs ${money(margin, 'GBP')}</span>`;
    const asOf = c.dataThrough ? `data to ${new Date(c.dataThrough).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : '';
    $('#h-cost-note', el).innerHTML = [esc(parts.join(' · ')), marginHtml].filter(Boolean).join(' · ');
    const feats = (c.byFeature || []).map((f) => `${f.name}: ${money(f.mtd, 'GBP', 2)}`).join('\n');
    const src = c.source === 'billing' ? `From provider billing (${asOf})` : 'Logged by Tutorise as calls happen';
    box.title = `Show daily AI costs in the chart below\n${src}; $1 = £${c.usdToGbp}${feats ? `\n\nBy feature this month:\n${feats}` : ''}${c.billing ? `\n\nProvider billing check: ${money(c.billing.mtd, 'GBP', 2)} so far (lags a few hours)` : ''}`;
  }

  function update(snap, why) {
    $('#ov-banner', el).innerHTML = demoBanner(snap);
    $('#chips', el).innerHTML = sourceChips(snap);
    const cur = snap.revenue?.currency || 'GBP';
    const isInit = why === 'init' || !el.__drawn;

    if (why !== 'uptime') {
      countUp($('#h-subs', el), snap.subscribers?.total);
      $('#h-subs-m', el).innerHTML = deltaHtml(delta(snap.subscribers?.history)) + (snap.subscribers?.newToday != null ? `<span>${delta(snap.subscribers?.history) != null ? '· ' : ''}+${int(snap.subscribers.newToday)} today</span>` : '');
      sparkline($('#h-subs-s', el), (snap.subscribers?.history || []).map((d) => d.value), { color: 'var(--series-1)', animate: isInit });
      drawSplit($('#h-subs-split', el), snap.subscribers);
      countUp($('#h-act', el), snap.active?.today);
      const act = snap.active || {};
      const who = [act.todayStudents != null && `${int(act.todayStudents)} student${act.todayStudents === 1 ? '' : 's'}`, act.todayParents != null && `${int(act.todayParents)} parent${act.todayParents === 1 ? '' : 's'}`].filter(Boolean);
      $('#h-act-who', el).innerHTML = who.length ? `<span>${who.join(' · ')}</span>` : '';
      $('#h-act-who', el).style.marginBottom = who.length ? '4px' : '';
      $('#h-act-m', el).innerHTML = deltaHtml(delta(snap.active?.history?.slice(0, -1))) + (snap.active?.live != null ? `<span>${delta(snap.active?.history?.slice(0, -1)) != null ? '· ' : ''}${int(snap.active.live)} online now${act.liveStudents != null || act.liveParents != null ? ` (${[act.liveStudents != null && `${int(act.liveStudents)} student${act.liveStudents === 1 ? '' : 's'}`, act.liveParents != null && `${int(act.liveParents)} parent${act.liveParents === 1 ? '' : 's'}`].filter(Boolean).join(', ')})` : ''}</span>` : '');
      sparkline($('#h-act-s', el), (snap.active?.history || []).map((d) => d.value), { color: 'var(--series-3)', animate: isInit });
      countUp($('#h-mrr', el), snap.revenue?.mrr, (n) => money(n, cur));
      $('#h-mrr-m', el).innerHTML = snap.revenue ? `<span>${money(snap.revenue.month, cur)} this month</span>` : '';
      sparkline($('#h-mrr-s', el), (snap.revenue?.history || []).map((d) => d.value), { color: 'var(--series-7)', animate: isInit });
      drawCosts(snap);

      drawAccounts(snap);
      drawMain(snap);
      const byHour = snap.usage?.byHour;
      if (byHour?.length) barChart($('#hours', el), byHour, byHour.map((_, h) => String(h).padStart(2, '0')), { color: 'var(--series-1)', highlight: new Date().getHours(), tipLabel: (h) => `${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00`, animate: isInit, label: 'Sessions by hour today' });
      else $('#hours', el).innerHTML = '<div class="empty">No hourly data</div>';
      countUp($('#t-sess', el), snap.usage?.sessionsToday);
      countUp($('#t-new', el), snap.subscribers?.newToday);
      countUp($('#t-trials', el), snap.subscribers?.newTrialsToday);
      countUp($('#t-rev', el), snap.revenue?.today, (n) => money(n, cur));

      // AI challenges
      const ai = snap.ai;
      if (ai) {
        countUp($('#ai-today', el), ai.today);
        countUp($('#ai-week', el), ai.week);
        drawOpenTile($('#ai-open', el), ai.open);
        const top = (ai.byType || []).filter((t) => t.value).sort((x, y) => y.value - x.value).slice(0, 5);
        if (top.length) hBars($('#ai-types', el), top, { color: 'var(--series-7)' });
        else $('#ai-types', el).innerHTML = '<div class="muted" style="font-size:12.5px">No type breakdown provided</div>';
        const feed = (ai.recent || []).slice(0, 6);
        const withStatus = hasStatuses(ai.recent);
        $('#ai-feed', el).innerHTML = feed.length ? feed.map((c) => challengeRow(c, !first && !isInit && !seenAI.has(challengeKey(c)), withStatus)).join('') : '<div class="empty">No challenges yet</div>';
        seenAI = new Set(feed.map(challengeKey));
      } else $('#ai-feed', el).innerHTML = '<div class="empty">No AI challenge data from your business data source yet</div>';

      // Inbox
      const ib = snap.inbox;
      $('#ib-sub', el).textContent = ib ? `${ib.unread} unread` : '';
      $('#ib-list', el).innerHTML = ib?.latest?.length ? ib.latest.map((m) => `
        <div class="row clickable" data-uid="${m.uid}">
          ${m.seen ? '<span style="width:8px"></span>' : '<span class="unread-dot" title="Unread"></span>'}
          <div class="grow"><div class="title">${esc(m.from.name || m.from.address)}</div><div class="desc">${esc(m.subject)}</div></div>
          <span class="time">${ago(m.date)}</span></div>`).join('') : `<div class="empty">${snap.sources?.email?.state === 'off' ? 'Connect your IMAP inbox in Settings' : 'Inbox zero 🎉'}</div>`;
      $$('#ib-list .row', el).forEach((r) => (r.onclick = () => (location.hash = `inbox/${r.dataset.uid}`)));

      // Services
      const svcs = snap.infra?.services || [];
      const healthy = svcs.filter((s) => s.status === 'SUCCESS').length;
      $('#sys-sub', el).textContent = svcs.length ? `${healthy}/${svcs.length} services healthy` : '';
      $('#sys-list', el).innerHTML = svcs.length ? svcs.map((s) => {
        const [cls, label] = serviceStatus(s.status);
        return `<div class="row"><div class="grow"><div class="title">${esc(s.name)}</div><div class="desc">Deployed ${ago(s.updatedAt)}</div></div><span class="status ${cls}">${label}</span></div>`;
      }).join('') : '<div class="empty">Connect Railway in Settings</div>';
    }

    // Uptime
    const up = snap.uptime;
    countUp($('#h-up', el), up?.overall, (n) => `${n.toFixed(2)}%`);
    const checks = up?.checks || [];
    const downCount = checks.filter((c) => c.up === false).length;
    $('#h-up-m', el).innerHTML = checks.length ? (downCount ? `<span class="status critical">${downCount} down</span>` : `<span class="status good">All systems up</span>`) : '<span>No URLs monitored</span>';
    const firstCheck = checks.find((c) => c.buckets);
    if (firstCheck) uptimeStrip($('#h-up-s', el), firstCheck.buckets);
    $('#sys-uptime', el).innerHTML = checks.map((c, i) => `<div><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px"><span class="muted">${esc(shortUrl(c.url))}</span><span>${c.pending ? 'checking…' : `${c.latency ?? '—'} ms · ${pct(c.uptime24h, 2)}`}</span></div><div id="ovu-${i}"></div></div>`).join('');
    checks.forEach((c, i) => c.buckets && uptimeStrip($(`#ovu-${i}`, el), c.buckets));
    el.__drawn = true;
  }
  return { update };
}

// ------------------------------------------------------------------ AI view
function renderAI(el) {
  let seen = new Set(), drawn = false, typeFilter = '';
  el.innerHTML = `<div class="view">
    <div class="grid g-4">
      <div class="card hero lead" style="--c:var(--series-7);cursor:default"><div class="label"><i>${I.ai}</i>AI challenges</div><div class="value" id="a-total">—</div><div class="meta" id="a-total-m">all time</div></div>
      <div class="card hero" style="--c:var(--series-1);cursor:default"><div class="label"><i>${I.activity}</i>Today</div><div class="value" id="a-today">—</div><div class="meta">since midnight</div></div>
      <div class="card hero open-hero" id="a-open" style="--c:var(--series-3);cursor:default"><div class="label"><i>${I.overview}</i>Open</div><div class="value v">—</div><div class="meta open-note"></div></div>
      <div class="card hero" style="--c:var(--series-2);cursor:default"><div class="label"><i>${I.shield}</i>Most frequent</div><div class="value" id="a-top" style="font-size:28px;margin:18px 0 10px">—</div><div class="meta" id="a-top-m">last 30 days</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>By type</h3><span class="sub">last 30 days · click a type to filter the list below</span></div>
      <div class="type-grid" id="a-types"></div>
    </div>
    <div class="grid g-main">
      <div class="card"><div class="card-head"><h3>Challenges per day</h3><span class="sub">all types · last 30 days</span></div><div class="chart-box" id="a-hist"></div></div>
      <div class="card"><div class="card-head"><h3>Share by type</h3><span class="sub">last 30 days</span></div><div class="hbars" id="a-share"></div></div>
    </div>
    <div class="card" id="a-outcome-card" hidden><div class="card-head"><h3>Status</h3><span class="sub">last 30 days</span></div><div id="a-outcome"></div></div>
    <div class="card"><div class="card-head"><h3>Recent challenges</h3><span class="sub" id="a-recent-sub">newest first</span><div class="right"><select id="a-type" style="width:200px;padding:7px 10px"><option value="">All types</option></select><input type="text" id="a-q" placeholder="Search…" style="width:180px;padding:7px 10px"></div></div>
      <div class="list" id="a-recent"></div></div>
  </div>`;
  const setFilter = (t) => { typeFilter = t; $('#a-type', el).value = t; if (state.snap) update(state.snap); };
  $('#a-q', el).oninput = () => state.snap && update(state.snap);
  $('#a-type', el).onchange = (e) => setFilter(e.target.value);
  function update(snap, why) {
    if (why === 'uptime') return;
    const ai = snap.ai;
    if (!ai) { $('#a-recent', el).innerHTML = '<div class="empty">No AI challenge data yet. Your business data source needs to return an “ai” section — see docs/stats-endpoint.md.</div>'; return; }
    countUp($('#a-total', el), ai.total);
    countUp($('#a-today', el), ai.today);
    drawOpenTile($('#a-open', el), ai.open);
    const types = ai.byType || [];
    const sorted = types.filter((t) => t.value).sort((x, y) => y.value - x.value);
    $('#a-top', el).textContent = sorted[0]?.name || '—';
    $('#a-top-m', el).textContent = sorted[0] ? `${int(sorted[0].value)} in the last 30 days` : 'last 30 days';
    const total30 = types.reduce((t, x) => t + x.value, 0);
    $('#a-total-m', el).textContent = ['all time', ai.week != null && `${int(ai.week)} in 7 days`, total30 && `${int(total30)} in 30 days`].filter(Boolean).join(' · ');

    // Type tiles (always every type, in the canonical order, so it's clear what each one is)
    const grid = $('#a-types', el);
    if (!types.length) grid.innerHTML = '<div class="muted" style="font-size:12.5px">No type breakdown provided</div>';
    else {
      if (grid.children.length !== types.length) {
        grid.innerHTML = types.map((t, i) => `<button class="type-tile" data-t="${esc(t.name)}" style="--i:${i}">
          <div class="tt-name">${esc(t.name)}</div>
          <div class="tt-row"><span class="tt-value" id="tt-v-${i}">0</span><span class="tt-today" id="tt-d-${i}"></span></div>
          <div class="tt-spark" id="tt-s-${i}"></div>
          <div class="tt-desc" id="tt-x-${i}"></div></button>`).join('');
        $$('.type-tile', grid).forEach((b) => (b.onclick = () => setFilter(typeFilter === b.dataset.t ? '' : b.dataset.t)));
        const sel = $('#a-type', el);
        sel.innerHTML = '<option value="">All types</option>' + types.map((t) => `<option>${esc(t.name)}</option>`).join('');
        sel.value = typeFilter;
      }
      types.forEach((t, i) => {
        countUp($(`#tt-v-${i}`, grid), t.value);
        $(`#tt-d-${i}`, grid).textContent = t.today ? `+${int(t.today)} today` : '';
        $(`#tt-x-${i}`, grid).textContent = t.description || '';
        const sp = $(`#tt-s-${i}`, grid);
        if (t.history?.length > 1) sparkline(sp, t.history.map((d) => d.value), { color: 'var(--series-7)', height: 30, animate: !drawn });
        else sp.innerHTML = '';
      });
      $$('.type-tile', grid).forEach((b) => b.classList.toggle('selected', b.dataset.t === typeFilter));
    }

    const box = $('#a-hist', el);
    if (ai.history?.length) areaChart(box, ai.history, { color: 'var(--series-7)', animate: !drawn, label: 'AI challenges per day' });
    else { box.innerHTML = '<div class="empty">No daily history provided</div>'; box.__chart = null; }
    if (sorted.length) hBars($('#a-share', el), sorted, { color: 'var(--series-7)' });
    else $('#a-share', el).innerHTML = '<div class="muted" style="font-size:12.5px">No type breakdown provided</div>';

    let oc = (ai.byOutcome || []).slice().sort((x, y) => y.value - x.value);
    $('#a-outcome-card', el).hidden = !oc.length;
    if (oc.length > 4) oc = [...oc.slice(0, 3), { name: 'Other', value: oc.slice(3).reduce((t, x) => t + x.value, 0) }];
    if (oc.length && !drawn) donut($('#a-outcome', el), oc, ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'], { center: 'challenges', label: 'Challenge status' });

    const q = $('#a-q', el).value.trim().toLowerCase();
    const list = (ai.recent || []).filter((c) => (!typeFilter || c.type === typeFilter) && (!q || `${c.type} ${c.summary} ${c.status}`.toLowerCase().includes(q)));
    $('#a-recent-sub', el).textContent = typeFilter ? `${typeFilter} · newest first` : 'newest first';
    $('#a-recent', el).innerHTML = list.length ? list.map((c) => challengeRow(c, drawn && !seen.has(challengeKey(c)), hasStatuses(ai.recent))).join('') : `<div class="empty">${typeFilter ? `No recent “${esc(typeFilter)}” challenges` : 'No matching challenges'}</div>`;
    seen = new Set((ai.recent || []).map(challengeKey));
    drawn = true;
  }
  return { update };
}

// ------------------------------------------------------------------ Tasks
/** Sidebar badge: overdue (red) or, if none, due within a week (amber). */
function drawTasksBadge(t) {
  const b = $('#tasks-badge');
  if (!b) return;
  const n = t?.red || t?.amber || 0;
  b.hidden = !n;
  b.textContent = n;
  b.className = `badge ${t?.red ? 'badge-red' : 'badge-amber'}`;
  b.title = t?.red ? `${t.red} overdue` : t?.amber ? `${t.amber} due soon` : '';
}

const ST = {
  green: { cls: 'good', label: 'On track', hint: 'not due soon' },
  amber: { cls: 'warning', label: 'Due soon', hint: 'within 7 days (1 day for weekly, 3 for fortnightly)' },
  red: { cls: 'critical', label: 'Overdue', hint: 'past their due date' },
};
const fmtDay = (d, opts = { day: 'numeric', month: 'short' }) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });

function renderTasks(el) {
  let data = { tasks: [], today: null }, filter = '', showDone = false;
  const now = new Date();
  let month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM shown in the calendar
  el.innerHTML = `<div class="view">
    <div class="card task-hero">
      <div class="card-head"><h3>Tasks</h3><span class="sub" id="t-sub"></span><div class="right"><button class="btn primary" id="t-add">+ Add task</button></div></div>
      <div class="task-counts">${['green', 'amber', 'red'].map((k) => `<button class="task-count st-${k}" data-f="${k}" aria-pressed="false"><span class="tc-dot"></span><span class="tc-num" id="tc-${k}">0</span><span class="tc-label">${ST[k].label}</span><span class="tc-hint">${ST[k].hint}</span></button>`).join('')}</div>
    </div>
    <div class="grid tasks-layout">
      <div class="card">
        <div class="card-head"><h3 id="t-list-title">Upcoming</h3><span class="sub" id="t-list-sub">next due first</span>
          <div class="right"><label class="check" style="margin:0;font-size:12.5px"><input type="checkbox" id="t-done"> Show completed</label></div></div>
        <div class="list" id="t-list"></div>
      </div>
      <div class="card">
        <div class="card-head"><button class="icon-btn" id="cal-prev" aria-label="Previous month">‹</button><h3 id="cal-title" style="min-width:140px;text-align:center"></h3><button class="icon-btn" id="cal-next" aria-label="Next month">›</button>
          <div class="right"><button class="btn sm ghost" id="cal-today">Today</button></div></div>
        <div class="cal" id="cal"></div>
        <p class="muted" style="font-size:12px;margin:10px 0 0">Click a day to add a task. Repeating tasks are shown on their future dates.</p>
      </div>
    </div>
    <dialog class="task-dialog" id="t-dlg">
      <form method="dialog" id="t-form">
        <h3 id="t-dlg-title">Add task</h3>
        <div class="field"><label for="tf-title">Task</label><input type="text" id="tf-title" maxlength="200" required placeholder="e.g. Renew ICO registration"></div>
        <div class="form-grid">
          <div class="field"><label for="tf-due">Due date</label><input type="date" id="tf-due" required></div>
          <div class="field"><label for="tf-repeat">Repeats</label><select id="tf-repeat">${Object.entries(REPEATS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label for="tf-notes">Notes (optional)</label><textarea class="prose" id="tf-notes" rows="3" maxlength="2000"></textarea></div>
        <div class="hint muted" id="tf-last" style="margin:-4px 0 12px;font-size:12px"></div>
        <div class="form-actions"><button class="btn primary" value="save" id="tf-save">Save</button><button class="btn" value="cancel" formnovalidate>Cancel</button><span style="flex:1"></span><button class="btn danger" value="delete" id="tf-delete" formnovalidate>Delete</button></div>
        <div class="error-msg" id="tf-err"></div>
      </form>
    </dialog>
  </div>`;

  const dlg = $('#t-dlg', el);
  let editing = null;
  function openEditor(task, presetDate) {
    editing = task || null;
    $('#t-dlg-title', el).textContent = task ? 'Edit task' : 'Add task';
    $('#tf-title', el).value = task?.title || '';
    $('#tf-due', el).value = task?.dueDate || presetDate || data.today || '';
    $('#tf-repeat', el).value = task?.repeat || 'none';
    $('#tf-notes', el).value = task?.notes || '';
    $('#tf-delete', el).hidden = !task;
    $('#tf-err', el).textContent = '';
    $('#tf-last', el).textContent = task?.lastDone ? `Last done ${fmtDay(task.lastDone, { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
    dlg.showModal();
    $('#tf-title', el).focus();
  }
  $('#t-form', el).addEventListener('submit', async (e) => {
    const action = e.submitter?.value;
    if (action === 'cancel') return;
    e.preventDefault();
    try {
      if (action === 'delete') {
        if (!confirm(`Delete “${editing.title}”?`)) return;
        await api(`/api/tasks/${editing.id}`, { method: 'DELETE' });
        toast('Task deleted');
      } else {
        const body = { title: $('#tf-title', el).value, dueDate: $('#tf-due', el).value, repeat: $('#tf-repeat', el).value, notes: $('#tf-notes', el).value };
        if (editing) await api(`/api/tasks/${editing.id}`, { method: 'PUT', body }); else await api('/api/tasks', { body });
        toast(editing ? 'Task updated' : 'Task added');
      }
      dlg.close();
      await load();
    } catch (err) { $('#tf-err', el).textContent = err.message; }
  });

  async function markDone(t) {
    try {
      const r = await api(`/api/tasks/${t.id}/done`, { body: {} });
      toast(r.next ? `Done. Next due ${fmtDay(r.next, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Done', {
        label: 'Undo', run: async () => { await api(`/api/tasks/${t.id}/undo`, { body: {} }).catch((e) => toast(e.message)); load(); },
      });
      await load();
    } catch (err) { toast(err.message); }
  }

  $('#t-add', el).onclick = () => openEditor(null);
  $$('.task-count', el).forEach((b) => (b.onclick = () => { filter = filter === b.dataset.f ? '' : b.dataset.f; draw(); }));
  $('#t-done', el).onchange = (e) => { showDone = e.target.checked; draw(); };
  const shift = (n) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); month = d.toISOString().slice(0, 7); drawCalendar(); };
  $('#cal-prev', el).onclick = () => shift(-1);
  $('#cal-next', el).onclick = () => shift(1);
  $('#cal-today', el).onclick = () => { month = (data.today || new Date().toISOString()).slice(0, 7); drawCalendar(); };

  async function load() {
    try { data = await api('/api/tasks'); draw(); }
    catch (err) { $('#t-list', el).innerHTML = `<div class="empty"><div class="error-msg">${esc(err.message)}</div></div>`; }
  }

  function draw() {
    const today = data.today;
    const open = data.tasks.filter((t) => !t.done).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
    const counts = summarise(open, today);
    for (const k of ['green', 'amber', 'red']) countUp($(`#tc-${k}`, el), counts[k]);
    $$('.task-count', el).forEach((b) => { const on = b.dataset.f === filter; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    $('#t-sub', el).textContent = open.length ? `${open.length} open · today is ${fmtDay(today, { weekday: 'long', day: 'numeric', month: 'long' })}` : '';
    const shown = filter ? open.filter((t) => statusOf(t, today) === filter) : open;
    $('#t-list-title', el).textContent = filter ? ST[filter].label : 'Upcoming';
    $('#t-list-sub', el).innerHTML = filter ? `<a href="#" id="t-clear">show all</a>` : 'next due first';
    $('#t-clear', el)?.addEventListener('click', (e) => { e.preventDefault(); filter = ''; draw(); });
    const row = (t) => {
      const st = statusOf(t, today);
      const meta = [t.repeat !== 'none' ? REPEATS[t.repeat]?.label : null, t.lastDone ? `last done ${fmtDay(t.lastDone)}` : null, t.notes ? t.notes.replace(/\s+/g, ' ').slice(0, 90) : null].filter(Boolean).join(' · ');
      return `<div class="task-row st-${st}" data-id="${esc(t.id)}">
        <button class="task-check" data-done="${esc(t.id)}" title="Mark done${t.repeat !== 'none' ? ' (moves to the next date)' : ''}" aria-label="Mark “${esc(t.title)}” done">${I.check}</button>
        <div class="grow" data-edit="${esc(t.id)}" role="button" tabindex="0"><div class="title">${esc(t.title)}</div><div class="desc">${esc(meta || fmtDay(t.dueDate, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</div></div>
        <span class="status ${ST[st].cls}" title="${esc(fmtDay(t.dueDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}">${esc(dueLabel(t, today))}</span>
      </div>`;
    };
    let html = shown.length ? shown.map(row).join('')
      : `<div class="empty">${I.tasks}<div>${open.length ? 'No tasks in this group' : 'No tasks yet. Add one with “+ Add task”, or click a day in the calendar.'}</div></div>`;
    if (showDone) {
      const done = data.tasks.filter((t) => t.done).sort((a, b) => (b.doneOn || '').localeCompare(a.doneOn || ''));
      html += `<div class="task-done-head">Completed</div>` + (done.length ? done.map((t) => `<div class="task-row st-done" data-id="${esc(t.id)}">
        <span class="task-check done">${I.check}</span>
        <div class="grow" data-edit="${esc(t.id)}" role="button" tabindex="0"><div class="title">${esc(t.title)}</div><div class="desc">Completed ${t.doneOn ? fmtDay(t.doneOn, { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</div></div>
        <button class="btn sm ghost" data-reopen="${esc(t.id)}">Reopen</button></div>`).join('') : '<p class="muted" style="font-size:12.5px">Nothing completed yet.</p>');
    }
    $('#t-list', el).innerHTML = html;
    $$('[data-done]', el).forEach((b) => (b.onclick = () => markDone(data.tasks.find((t) => t.id === b.dataset.done))));
    $$('[data-edit]', el).forEach((b) => { const go = () => openEditor(data.tasks.find((t) => t.id === b.dataset.edit)); b.onclick = go; b.onkeydown = (e) => { if (e.key === 'Enter') go(); }; });
    $$('[data-reopen]', el).forEach((b) => (b.onclick = async () => { await api(`/api/tasks/${b.dataset.reopen}/undo`, { body: {} }).catch((e) => toast(e.message)); load(); }));
    drawCalendar();
  }

  function drawCalendar() {
    const today = data.today || new Date().toISOString().slice(0, 10);
    const [y, m] = month.split('-').map(Number);
    $('#cal-title', el).textContent = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const first = `${month}-01`;
    const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
    const start = addDays(first, -lead);
    const end = addDays(start, 41);
    const byDay = {};
    for (const t of data.tasks) for (const d of occurrences(t, start, end)) (byDay[d] ||= []).push({ t, st: d === t.dueDate ? statusOf(t, today) : statusOf({ dueDate: d, repeat: t.repeat }, today), next: d !== t.dueDate });
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i), items = (byDay[d] || []).sort((a, b) => a.t.title.localeCompare(b.t.title));
      const chips = items.slice(0, 3).map(({ t, st, next }) => `<button class="cal-chip st-${st}${next ? ' later' : ''}" data-edit="${esc(t.id)}" title="${esc(t.title)}${next ? ' (repeat)' : ''}">${esc(t.title)}</button>`).join('');
      const more = items.length > 3 ? `<span class="cal-more">+${items.length - 3} more</span>` : '';
      cells += `<div class="cal-day${d.slice(0, 7) !== month ? ' out' : ''}${d === today ? ' today' : ''}" data-day="${d}" role="button" tabindex="0" aria-label="${esc(fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' }))}${items.length ? `, ${items.length} task${items.length === 1 ? '' : 's'}` : ''}">
        <span class="cal-num">${Number(d.slice(8))}</span>${chips}${more}</div>`;
    }
    $('#cal', el).innerHTML = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => `<div class="cal-wd">${w}</div>`).join('') + cells;
    $$('.cal-chip', el).forEach((c) => (c.onclick = (e) => { e.stopPropagation(); openEditor(data.tasks.find((t) => t.id === c.dataset.edit)); }));
    $$('.cal-day', el).forEach((c) => { const go = () => openEditor(null, c.dataset.day); c.onclick = go; c.onkeydown = (e) => { if (e.key === 'Enter') go(); }; });
  }

  load();
  const rollover = setInterval(load, 10 * 60_000); // pick up a new day
  return { onTasks: load, destroy: () => clearInterval(rollover) };
}

// ------------------------------------------------------------------ Infra view
function renderInfra(el) {
  el.innerHTML = `<div class="view">
    <div class="card"><div class="card-head"><h3>Railway services</h3><span class="sub" id="i-proj"></span></div><div class="grid g-4" id="i-svcs"></div></div>
    <div class="card"><div class="card-head"><h3>Uptime monitors</h3><span class="sub">last 24 hours, 30-minute buckets</span></div><div class="list" id="i-up"></div></div>
  </div>`;
  function update(snap) {
    const inf = snap.infra;
    $('#i-proj', el).textContent = inf ? `${inf.project}${inf.environment ? ' · ' + inf.environment : ''}` : '';
    const svcs = inf?.services || [];
    $('#i-svcs', el).innerHTML = svcs.length ? svcs.map((s, i) => {
      const [cls, label] = serviceStatus(s.status);
      return `<div class="svc"><div class="svc-head"><span class="svc-name">${esc(s.name)}</span><span class="status ${cls}">${label}</span></div>
        <div class="svc-meta"><span>CPU <b>${s.cpu != null ? s.cpu + '%' : '—'}</b></span><span>Mem <b>${s.memoryMb != null ? s.memoryMb + ' MB' : '—'}</b></span></div>
        <div class="spark-wrap" id="svc-s-${i}"></div>
        <div class="svc-meta"><span>Deployed ${ago(s.updatedAt)}</span>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">Open ↗</a>` : ''}</div></div>`;
    }).join('') : '<div class="empty" style="grid-column:1/-1">Connect Railway in Settings to see services, deploy status and resource usage.</div>';
    svcs.forEach((s, i) => s.cpuSeries?.length && sparkline($(`#svc-s-${i}`, el), s.cpuSeries, { color: 'var(--series-1)', animate: false }));
    const checks = snap.uptime?.checks || [];
    $('#i-up', el).innerHTML = checks.length ? checks.map((c, i) => `
      <div style="padding:14px 4px;border-bottom:1px solid var(--border);display:grid;gap:10px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          ${c.pending ? '<span class="status neutral">Checking</span>' : c.up ? '<span class="status good">Up</span>' : '<span class="status critical">Down</span>'}
          <a href="${esc(c.url)}" target="_blank" rel="noopener" style="font-weight:600;color:var(--text)">${esc(shortUrl(c.url))}</a>
          <span class="muted" style="font-size:12.5px">${c.code ? 'HTTP ' + c.code : esc(c.error || '')}</span>
          <span style="margin-left:auto;display:flex;gap:18px;font-size:12.5px"><span class="muted">Response <b style="color:var(--text)">${c.latency ?? '—'} ms</b></span><span class="muted">24h <b style="color:var(--text)">${pct(c.uptime24h, 2)}</b></span><span class="muted">90d <b style="color:var(--text)">${pct(c.uptime90d, 2)}</b></span></span>
        </div>
        <div id="iu-${i}"></div>
        <div style="height:34px;color:var(--series-3)" id="il-${i}" title="Response time, last 30 checks"></div>
      </div>`).join('') : '<div class="empty">Add URLs to monitor in Settings → Uptime.</div>';
    checks.forEach((c, i) => { if (c.buckets) uptimeStrip($(`#iu-${i}`, el), c.buckets); if (c.recentMs?.length > 1) sparkline($(`#il-${i}`, el), c.recentMs, { color: 'var(--series-3)', animate: false }); });
  }
  return { update };
}

// ------------------------------------------------------------------ Inbox view
function renderInbox(el) {
  let messages = [], filter = 'all', current = null, q = '';
  const initialUid = location.hash.split('/')[1];
  el.innerHTML = `<div class="view"><div class="inbox">
    <div class="card">
      <div class="inbox-toolbar"><input type="text" id="m-q" placeholder="Search mail…" style="padding:7px 10px"><div class="seg" id="m-f"><button data-f="all" class="on">All</button><button data-f="unread">Unread</button></div></div>
      <div class="inbox-list" id="m-list"><div style="padding:12px;display:grid;gap:10px">${'<div class="skeleton" style="height:58px"></div>'.repeat(5)}</div></div>
    </div>
    <div class="card" id="m-reader-card"><div class="empty">${I.mail}<div>Select an email to read and reply</div></div></div>
  </div></div>`;
  $('#m-q', el).oninput = (e) => { q = e.target.value.toLowerCase(); drawList(); };
  $$('#m-f button', el).forEach((b) => (b.onclick = () => { filter = b.dataset.f; $$('#m-f button', el).forEach((x) => x.classList.toggle('on', x === b)); drawList(); }));

  async function load() {
    try {
      const r = await api('/api/email');
      if (r.notConfigured) { $('#m-list', el).innerHTML = `<div class="empty">${I.mail}<div>No inbox connected.</div><a href="#settings" class="btn sm">Configure IMAP</a></div>`; return; }
      const prev = new Set(messages.map((m) => m.uid));
      messages = r.messages;
      drawList(prev.size ? prev : null);
      if (initialUid && !current) open(initialUid);
    } catch (e) { $('#m-list', el).innerHTML = `<div class="empty"><div class="error-msg">${esc(e.message)}</div></div>`; }
  }
  function drawList(prev) {
    const list = messages.filter((m) => (filter === 'all' || !m.seen) && (!q || `${m.from.name} ${m.from.address} ${m.subject} ${m.preview}`.toLowerCase().includes(q)));
    $('#m-list', el).innerHTML = list.length ? list.map((m) => `
      <div class="mail-item ${m.seen ? 'seen' : ''} ${String(current) === String(m.uid) ? 'active' : ''} ${prev && !prev.has(m.uid) ? 'row new' : ''}" data-uid="${m.uid}" style="${prev && !prev.has(m.uid) ? 'border:0;padding:12px 10px' : ''}">
        <div class="dot-col">${m.seen ? '' : '<span class="unread-dot" style="display:block" title="Unread"></span>'}</div>
        <div class="from">${esc(m.from.name || m.from.address)}</div><div class="time">${m.answered ? '↩ ' : ''}${ago(m.date)}</div>
        <div class="subj">${esc(m.subject)}</div><div class="prev">${esc(m.preview || '')}</div>
      </div>`).join('') : `<div class="empty">${filter === 'unread' ? 'No unread mail 🎉' : 'Nothing here'}</div>`;
    $$('.mail-item', el).forEach((it) => (it.onclick = () => open(it.dataset.uid)));
  }
  async function open(uid) {
    current = uid;
    history.replaceState(null, '', `#inbox/${uid}`);
    drawList();
    const card = $('#m-reader-card', el);
    card.innerHTML = `<div class="reader"><div class="skeleton" style="height:28px;width:60%;margin-bottom:16px"></div><div class="skeleton" style="height:160px"></div></div>`;
    try {
      const m = await api(`/api/email/${uid}`);
      const local = messages.find((x) => String(x.uid) === String(uid)); if (local) local.seen = true;
      drawList();
      card.innerHTML = `<div class="reader">
          <h2>${esc(m.subject)}</h2>
          <div class="hdr"><div class="avatar">${esc((m.from.name || m.from.address || '?')[0].toUpperCase())}</div>
            <div class="grow"><div><b>${esc(m.from.name || m.from.address)}</b> <span class="muted">&lt;${esc(m.from.address)}&gt;</span></div><div class="muted" style="font-size:12.5px">to ${esc(m.to?.address || '')} · ${new Date(m.date).toLocaleString('en-GB')}</div></div>
            ${m.html ? '<button class="btn sm ghost" id="m-html">Show formatted</button>' : ''}
            <button class="btn sm" id="m-unread">Mark unread</button>
          </div>
          <div class="body" id="m-body">${esc(m.text || '(no text content)')}</div>
          ${m.attachments?.length ? `<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">${m.attachments.map((a) => `<span class="tag">📎 ${esc(a.filename || 'attachment')} · ${compact(a.size)}B</span>`).join('')}</div>` : ''}
        </div>
        <form class="composer" id="m-reply">
          <div style="display:flex;align-items:center;gap:8px;font-size:13px" class="muted">${I.reply.replace('<svg', '<svg width="16" height="16"')} Reply to <b style="color:var(--text)">${esc(m.from.address)}</b>${m.answered ? ' · <span class="status good">Replied</span>' : ''}</div>
          <textarea class="prose" id="m-text" placeholder="Write your reply…  (⌘↩ to send)" required></textarea>
          <div class="actions"><button class="btn primary" id="m-send">${I.send} Send reply</button><span class="muted" style="font-size:12.5px">Sent via SMTP and saved to your Sent folder</span></div>
        </form>`;
      $('#m-html', card)?.addEventListener('click', (e) => {
        const body = $('#m-body', card);
        if (body.querySelector('iframe')) { body.textContent = m.text; e.target.textContent = 'Show formatted'; return; }
        const f = document.createElement('iframe');
        f.setAttribute('sandbox', ''); // no scripts, no same-origin, remote images blocked by CSP
        f.srcdoc = m.html;
        body.textContent = ''; body.appendChild(f);
        e.target.textContent = 'Show plain text';
      });
      $('#m-unread', card).onclick = async () => { await api(`/api/email/${uid}/flag`, { body: { flag: 'seen', on: false } }); if (local) local.seen = false; drawList(); toast('Marked as unread'); };
      const ta = $('#m-text', card);
      ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#m-reply', card).requestSubmit(); };
      $('#m-reply', card).onsubmit = async (e) => {
        e.preventDefault();
        const btn = $('#m-send', card); btn.disabled = true; btn.textContent = 'Sending…';
        try {
          const r = await api(`/api/email/${uid}/reply`, { body: { text: ta.value } });
          toast(r.demo ? 'Demo mode — reply not actually sent' : 'Reply sent ✓');
          if (local) local.answered = true;
          ta.value = ''; drawList();
        } catch (err) { toast(err.message); }
        btn.disabled = false; btn.innerHTML = `${I.send} Send reply`;
      };
    } catch (e) { card.innerHTML = `<div class="empty"><div class="error-msg">${esc(e.message)}</div></div>`; }
  }
  load();
  return { onMail: load, update: (snap, why) => { if (why !== 'uptime' && why !== 'init') { const n = snap.inbox?.unread; if (n !== el.__lastUnread) { el.__lastUnread = n; load(); } } } };
}

// ------------------------------------------------------------------ Settings
const SECTIONS = {
  general: {
    title: 'General', desc: 'Basics for how the dashboard behaves.',
    fields: [
      { k: 'businessName', label: 'Business name' },
      { k: 'currency', label: 'Default currency', type: 'select', options: ['GBP', 'EUR', 'USD'] },
      { k: 'refreshSeconds', label: 'Refresh every (seconds)', type: 'number', hint: 'How often data is pulled and pushed live to the screen.' },
      { k: 'demoMode', label: 'Show demo data for anything not yet connected', type: 'check', full: true },
    ],
  },
  railway: {
    title: 'Railway', desc: 'Service health, deploy status and CPU / memory from Railway’s API. Easiest: a project token (Railway → your project → Settings → Tokens), which needs nothing else. An account or workspace token (Account Settings → Tokens) also works, with the Project ID. The dashboard works out which kind you’ve pasted.', test: true,
    fields: [
      { k: 'token', label: 'API token', secret: true, full: true },
      { k: 'tokenType', label: 'Token type (tried first)', type: 'select', options: [['project', 'Project token'], ['account', 'Account / workspace token']] },
      { k: 'projectId', label: 'Project ID (account tokens only)', hint: 'Project → Settings → General. Leave blank with a project token.' },
      { k: 'environmentId', label: 'Environment ID (optional)', hint: 'Defaults to the token’s environment, or “production”.', full: true },
    ],
  },
  stats: {
    title: 'Business data', desc: 'Where subscribers, active customers, usage, revenue and AI challenge numbers come from. Either an admin stats endpoint on your Tutorise backend, or a direct read-only connection to its Railway Postgres database.', test: true,
    fields: [
      { k: 'mode', label: 'Source', type: 'select', options: [['api', 'Tutorise stats API endpoint'], ['postgres', 'Railway Postgres (direct SQL)']], full: true },
      { k: 'apiBaseUrl', label: 'API base URL', show: (v) => v.mode === 'api' },
      { k: 'apiPath', label: 'Stats path', show: (v) => v.mode === 'api' },
      { k: 'apiToken', label: 'Bearer token', secret: true, full: true, show: (v) => v.mode === 'api', hint: 'See docs/stats-endpoint.md for the JSON shape the endpoint should return.' },
      { k: 'databaseUrl', label: 'DATABASE_PUBLIC_URL', secret: true, full: true, show: (v) => v.mode === 'postgres', hint: 'Use DATABASE_PUBLIC_URL (not DATABASE_URL) from your Postgres service → Variables in Railway — or press “Fetch from Railway” below if Railway is connected.' },
      { k: 'databaseSsl', label: 'Use SSL', type: 'check', show: (v) => v.mode === 'postgres' },
      { k: 'queries', label: 'SQL queries', type: 'queries', full: true, show: (v) => v.mode === 'postgres' },
    ],
  },
  stripe: {
    title: 'Stripe (optional)', desc: 'If set, MRR and revenue come straight from Stripe and override the business data source. Use a restricted key with read access to Subscriptions and Charges.', test: true,
    fields: [{ k: 'secretKey', label: 'Restricted API key (rk_live_…)', secret: true, full: true }],
  },
  costs: {
    title: 'AI costs', desc: 'Month-to-date AI spend and an estimate for the whole month, shown on the overview’s revenue card. These normally come from Tutorise itself: add a “costs” section to its stats endpoint (see docs/stats-endpoint.md) and nothing is needed here except the exchange rate. Admin keys are optional: add them only to compare Tutorise’s estimate with what the providers actually bill (admin keys can manage your whole organisation, so leave them out if you don’t need the check). Anthropic: Console → Settings → Admin keys (sk-ant-admin…). OpenAI: Platform → Settings → Organization → Admin keys (sk-admin…).', test: true,
    fields: [
      { k: 'usdToGbp', label: 'USD → GBP rate', type: 'number', hint: 'e.g. 0.79 means $1 = £0.79. Used for Tutorise’s figures and provider billing alike.' },
      { k: 'anthropicAdminKey', label: 'Anthropic Admin API key (optional)', secret: true, full: true },
      { k: 'openaiAdminKey', label: 'OpenAI admin key (optional)', secret: true, full: true },
    ],
  },
  email: {
    title: 'Email', desc: 'Your IMAP inbox appears in the dashboard and updates instantly via IMAP IDLE. Replies go out over SMTP. For iCloud, Gmail or Fastmail use an app-specific password.', test: true,
    fields: [
      { k: 'imapHost', label: 'IMAP host', hint: 'e.g. imap.mail.me.com, imap.gmail.com' },
      { k: 'imapPort', label: 'IMAP port', type: 'number' },
      { k: 'imapUser', label: 'IMAP username' },
      { k: 'imapPassword', label: 'IMAP password', secret: true },
      { k: 'imapSecure', label: 'Use TLS (port 993)', type: 'check' },
      { k: 'mailbox', label: 'Mailbox', hint: 'Usually INBOX' },
      { k: 'smtpHost', label: 'SMTP host', hint: 'e.g. smtp.mail.me.com' },
      { k: 'smtpPort', label: 'SMTP port', type: 'number', hint: '465 (TLS) or 587 (STARTTLS)' },
      { k: 'smtpUser', label: 'SMTP username', hint: 'Blank = same as IMAP' },
      { k: 'smtpPassword', label: 'SMTP password', secret: true, hint: 'Blank = same as IMAP' },
      { k: 'smtpSecure', label: 'Use TLS (port 465). Untick for 587.', type: 'check', full: true },
      { k: 'fromName', label: 'Send as name' },
      { k: 'fromAddress', label: 'Send as address' },
      { k: 'fetchCount', label: 'Messages to show', type: 'number' },
    ],
  },
  uptime: {
    title: 'Uptime', desc: 'URLs pinged from this Mac. A response below HTTP 500 counts as up.', test: true,
    fields: [
      { k: 'urls', label: 'URLs (one per line)', type: 'textarea', full: true },
      { k: 'intervalSeconds', label: 'Check every (seconds)', type: 'number' },
    ],
  },
  notifications: { title: 'Notifications', custom: true },
  security: { title: 'Security & login', custom: true },
};

function renderSettings(el) {
  let data = null, section = SECTIONS[location.hash.split('/')[1]] ? location.hash.split('/')[1] : 'general';
  el.innerHTML = `<div class="view"><div class="settings">
    <nav class="settings-nav" id="s-nav">${Object.entries(SECTIONS).map(([k, s]) => `<button data-s="${k}">${esc(s.title)}<span id="sn-${k}"></span></button>`).join('')}</nav>
    <div class="card" id="s-body"><div class="skeleton" style="height:200px"></div></div>
  </div></div>`;
  $$('#s-nav button', el).forEach((b) => (b.onclick = () => { section = b.dataset.s; draw(); }));

  async function load() { data = await api('/api/settings'); draw(); }
  function statusDot() {
    const map = { railway: 'railway', stats: 'stats', stripe: 'stripe', costs: 'costs', email: 'email', uptime: 'uptime' };
    for (const [k, src] of Object.entries(map)) {
      const s = state.snap?.sources?.[src]?.state;
      const n = $(`#sn-${k}`, el);
      if (n) n.innerHTML = s === 'live' ? '<span class="status good" style="padding:0 6px;font-size:10.5px">Live</span>' : s === 'error' ? '<span class="status critical" style="padding:0 6px;font-size:10.5px">Error</span>' : '';
    }
  }
  function draw() {
    $$('#s-nav button', el).forEach((b) => b.classList.toggle('active', b.dataset.s === section));
    statusDot();
    const def = SECTIONS[section];
    const body = $('#s-body', el);
    if (def.custom) return section === 'notifications' ? drawNotifications(body) : drawSecurity(body);
    const vals = structuredClone(data.settings[section]);
    const fieldHtml = (f) => {
      if (f.show && !f.show(vals)) return '';
      const v = vals[f.k];
      const id = `f-${f.k}`;
      const cls = `field ${f.full ? 'full' : ''}`;
      const hint = f.hint ? `<span class="hint">${esc(f.hint)}</span>` : '';
      if (f.type === 'check') return `<label class="check ${f.full ? 'full' : ''}"><input type="checkbox" id="${id}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
      if (f.type === 'select') return `<div class="${cls}"><label for="${id}">${esc(f.label)}</label><select id="${id}">${f.options.map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${v === val ? 'selected' : ''}>${esc(lab)}</option>`; }).join('')}</select>${hint}</div>`;
      if (f.type === 'textarea') return `<div class="${cls}"><label for="${id}">${esc(f.label)}</label><textarea id="${id}" rows="4">${esc(v)}</textarea>${hint}</div>`;
      if (f.type === 'queries') return `<details class="queries full"><summary>Edit SQL queries (match these to your schema)</summary>
        <p class="hint" style="margin-top:0">Single-number queries must return a column named <code>value</code>. History queries return <code>date</code> + <code>value</code> rows. <code>usageByHour</code> returns <code>hour</code> + <code>value</code>. Leave a query blank to skip it.</p>
        ${Object.entries(v).map(([qk, qv]) => `<div class="field"><label for="q-${qk}">${esc(qk)}</label><textarea id="q-${qk}" data-q="${esc(qk)}" rows="2">${esc(qv)}</textarea></div>`).join('')}</details>`;
      if (f.secret) return `<div class="${cls}"><label for="${id}">${esc(f.label)}</label><input type="password" id="${id}" autocomplete="off" placeholder="${v === '__SET__' ? '•••••••• saved — leave blank to keep' : ''}">${hint}</div>`;
      return `<div class="${cls}"><label for="${id}">${esc(f.label)}</label><input type="${f.type === 'number' ? 'number' : 'text'}" ${f.type === 'number' ? 'step="any"' : ''} id="${id}" value="${esc(v)}">${hint}</div>`;
    };
    body.innerHTML = `<div class="card-head"><h3 style="font-size:17px">${esc(def.title)}</h3></div>
      <p class="section-desc">${esc(def.desc)}</p>
      <form id="s-form"><div class="form-grid">${def.fields.map(fieldHtml).join('')}</div>
      <div class="form-actions"><button class="btn primary" type="submit">Save</button>${def.test ? '<button class="btn" type="button" id="s-test">Test connection</button>' : ''}${section === 'stats' ? `<button class="btn" type="button" id="s-fetchdb">${vals.databaseUrl === '__SET__' ? 'Re-fetch' : 'Fetch'} database URL from Railway</button>${vals.mode === 'postgres' ? '<button class="btn" type="button" id="s-detect">Detect from database</button>' : ''}` : ''}<span class="form-msg" id="s-msg"></span></div></form>
      <div id="s-detect-out"></div>`;
    const collect = () => {
      const out = {};
      for (const f of def.fields) {
        if (f.show && !f.show(vals)) continue;
        const inp = $(`#f-${f.k}`, body);
        if (f.type === 'queries') { out.queries = Object.fromEntries($$('[data-q]', body).map((t) => [t.dataset.q, t.value])); continue; }
        if (!inp) continue;
        if (f.type === 'check') out[f.k] = inp.checked;
        else if (f.secret) out[f.k] = inp.value || (vals[f.k] === '__SET__' ? '__SET__' : '');
        else out[f.k] = f.type === 'number' ? Number(inp.value) : inp.value;
      }
      return out;
    };
    $('#f-mode', body)?.addEventListener('change', (e) => { data.settings[section] = { ...data.settings[section], ...collect(), mode: e.target.value }; draw(); });
    const msg = $('#s-msg', body);
    $('#s-form', body).onsubmit = async (e) => {
      e.preventDefault();
      msg.className = 'form-msg muted'; msg.textContent = 'Saving…';
      try { const r = await api(`/api/settings/${section}`, { method: 'PUT', body: collect() }); data.settings = r.settings; draw(); toast('Settings saved'); }
      catch (err) { msg.className = 'form-msg error-msg'; msg.textContent = err.message; }
    };
    $('#s-fetchdb', body)?.addEventListener('click', async () => {
      msg.className = 'form-msg muted'; msg.textContent = 'Looking for your Postgres service in Railway…';
      try {
        const r = await api('/api/settings/stats/railway-db', { body: {} });
        data.settings = r.settings; draw(); toast(r.message);
        const m2 = $('#s-msg', body); m2.className = 'form-msg ok-msg'; m2.textContent = '✓ ' + r.message + ' Now press Detect from database.';
      } catch (err) { msg.className = 'form-msg error-msg'; msg.textContent = '✕ ' + err.message; }
    });
    $('#s-detect', body)?.addEventListener('click', async () => {
      const out = $('#s-detect-out', body);
      msg.className = 'form-msg muted'; msg.textContent = 'Reading your database schema…';
      try {
        const r = await api('/api/settings/stats/detect', { body: collect() });
        msg.textContent = '';
        const m = r.mapping, n = Object.values(r.queries).filter(Boolean).length;
        out.innerHTML = `<div class="detect">
          <h4>What I found</h4>
          <dl><dt>Parents</dt><dd>${esc(m.parents || 'not found')}</dd><dt>Students</dt><dd>${esc(m.students || 'not found')}</dd><dt>Subscriptions</dt><dd>${esc(m.subscriptions || 'not found')}</dd></dl>
          <ul>${r.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          <div class="form-actions"><button class="btn primary" id="s-apply" ${n ? '' : 'disabled'}>Use these ${n} queries</button><span class="muted" style="font-size:12.5px">Saves them and refreshes the dashboard. Queries not listed here are left as they are.</span></div>
          <details><summary>Schema summary (table and column names only — safe to share for help)</summary><textarea readonly rows="8">${esc(r.report)}</textarea></details>
        </div>`;
        $('#s-apply', out).onclick = async () => {
          const merged = { ...data.settings.stats.queries, ...r.queries };
          const res = await api('/api/settings/stats', { method: 'PUT', body: { ...collect(), queries: merged } });
          data.settings = res.settings; await api('/api/refresh', { method: 'POST', body: {} }).then(setSnap).catch(() => {});
          toast('Queries saved — dashboard refreshed'); draw();
          const after = state.snap?.queryErrors ? Object.keys(state.snap.queryErrors) : [];
          if (after.length) toast(`${after.length} queries still failing — see the banner on the overview`);
        };
      } catch (err) { msg.className = 'form-msg error-msg'; msg.textContent = '✕ ' + err.message; }
    });
    $('#s-test', body)?.addEventListener('click', async () => {
      msg.className = 'form-msg muted'; msg.textContent = 'Testing…';
      try { const r = await api(`/api/settings/${section}/test`, { body: collect() }); msg.className = 'form-msg ok-msg'; msg.textContent = '✓ ' + r.message; }
      catch (err) { msg.className = 'form-msg error-msg'; msg.textContent = '✕ ' + err.message; }
    });
  }

  async function drawNotifications(body) {
    body.innerHTML = '<div class="skeleton" style="height:160px"></div>';
    let cfg;
    try { cfg = await api('/api/push'); } catch (e) { body.innerHTML = `<div class="error-msg">${esc(e.message)}</div>`; return; }
    const reg = swReg || (await navigator.serviceWorker?.getRegistration('/').catch(() => null));
    const sub = reg && pushSupported() ? await reg.pushManager.getSubscription().catch(() => null) : null;
    const thisDevice = sub && cfg.devices.some((d) => d.endpoint === sub.endpoint);
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    let blocker = '';
    if (!window.isSecureContext) blocker = 'Notifications need the hosted https:// address.';
    else if (isIOS() && !isInstalledApp()) blocker = 'On iPhone, add the dashboard to your Home Screen first: in Safari tap Share → Add to Home Screen, then open it from the new icon and come back here.';
    else if (!pushSupported()) blocker = 'This browser doesn’t support push notifications. On iPhone you need iOS 16.4 or later and the dashboard added to the Home Screen.';
    else if (perm === 'denied') blocker = isIOS() ? 'Notifications are blocked for this app. On iPhone: Settings → Notifications → Tutorise HQ → Allow Notifications.' : 'Notifications are blocked for this site in your browser’s settings. Allow them for this address, then reload.';
    const b = cfg.badge || {};
    const labels = { email: 'New emails', subscribers: 'New subscribers and trials', tasks: 'Tasks becoming overdue', uptime: 'A site going down or coming back' };
    body.innerHTML = `<div class="card-head"><h3 style="font-size:17px">Notifications</h3></div>
      <p class="section-desc">Push notifications and an app-icon badge on your phone. The badge shows <b>unread emails + new subscribers since you last opened the app + overdue tasks</b>. iPhone needs iOS 16.4+ and the dashboard added to the Home Screen.</p>
      <div class="notif-status">
        <div><div class="k">This device</div><div class="v">${thisDevice ? '<span class="status good">Notifications on</span>' : blocker ? '<span class="status neutral">Not available yet</span>' : '<span class="status neutral">Off</span>'}</div></div>
        <div><div class="k">Badge right now</div><div class="v"><b>${b.total ?? 0}</b> <span class="muted">= ${b.emails ?? 0} email · ${b.subscribers ?? 0} new subscribers · ${b.tasks ?? 0} overdue</span></div></div>
      </div>
      ${blocker ? `<div class="banner" style="margin:14px 0">${esc(blocker)}</div>` : ''}
      <div class="form-actions" style="margin:14px 0 22px">
        ${!blocker && !thisDevice ? '<button class="btn primary" id="n-enable">Enable on this device</button>' : ''}
        ${thisDevice ? '<button class="btn" id="n-disable">Turn off on this device</button>' : ''}
        <button class="btn" id="n-test" ${cfg.devices.length ? '' : 'disabled'}>Send a test notification</button>
        <span class="form-msg" id="n-msg"></span>
      </div>
      <h4 style="margin:0 0 8px">Notify me about</h4>
      ${Object.entries(labels).map(([k, l]) => `<label class="check"><input type="checkbox" data-pref="${k}" ${cfg.prefs[k] ? 'checked' : ''}> ${l}</label>`).join('')}
      <h4 style="margin:18px 0 6px">Devices</h4>
      ${cfg.devices.length ? cfg.devices.map((d) => `<div class="passkey-row"><div style="flex:1"><b>${esc(d.label)}</b>${sub && d.endpoint === sub.endpoint ? ' <span class="muted">(this device)</span>' : ''}<div class="muted" style="font-size:12.5px">Added ${new Date(d.createdAt).toLocaleDateString('en-GB')}${d.lastOk ? ` · last delivered ${new Date(d.lastOk).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}${d.lastError ? ` · <span class="error-msg">${esc(d.lastError)}</span>` : ''}</div></div><button class="btn sm danger" data-rm="${esc(d.endpoint)}">Remove</button></div>`).join('') : '<p class="muted">No devices yet.</p>'}`;
    const msg = $('#n-msg', body);
    const b64ToBytes = (b64) => { const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
    $('#n-enable', body)?.addEventListener('click', async () => {
      try {
        const p = await Notification.requestPermission(); // must run straight from the tap
        if (p !== 'granted') { msg.className = 'form-msg error-msg'; msg.textContent = 'Notifications weren’t allowed.'; return; }
        const r = swReg || (await navigator.serviceWorker.register('/sw.js', { scope: '/' }));
        await navigator.serviceWorker.ready;
        const s2 = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.publicKey) });
        const label = /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) || isIOS() ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android phone' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'This device';
        await api('/api/push/subscribe', { body: { subscription: s2.toJSON(), label } });
        toast('Notifications turned on'); drawNotifications(body);
      } catch (e) { msg.className = 'form-msg error-msg'; msg.textContent = `Couldn’t turn on notifications for this device: ${e.message}`; }
    });
    $('#n-disable', body)?.addEventListener('click', async () => {
      try { await api('/api/push/unsubscribe', { body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); setBadge(0); toast('Notifications turned off on this device'); drawNotifications(body); }
      catch (e) { toast(e.message); }
    });
    $('#n-test', body).onclick = async () => {
      msg.className = 'form-msg muted'; msg.textContent = 'Sending…';
      try { const r = await api('/api/push/test', { body: {} }); msg.className = 'form-msg ok-msg'; msg.textContent = `✓ Sent to ${r.sent} device${r.sent === 1 ? '' : 's'}`; }
      catch (e) { msg.className = 'form-msg error-msg'; msg.textContent = '✕ ' + e.message; }
    };
    $$('[data-pref]', body).forEach((c) => (c.onchange = async () => { await api('/api/push/prefs', { method: 'PUT', body: { [c.dataset.pref]: c.checked } }).catch((e) => toast(e.message)); }));
    $$('[data-rm]', body).forEach((x) => (x.onclick = async () => { await api('/api/push/unsubscribe', { body: { endpoint: x.dataset.rm } }); drawNotifications(body); }));
  }

  async function drawSecurity(body) {
    const a = await api('/api/auth/status');
    body.innerHTML = `<div class="card-head"><h3 style="font-size:17px">Security & login</h3></div>
      <p class="section-desc">Passkeys let you sign in with Touch ID or your iCloud Keychain — no password needed. Secrets are encrypted at rest in <code>${esc(data.dataDir)}</code>.</p>
      <h4 style="margin:18px 0 4px">Passkeys</h4>
      <div id="pk-list">${a.passkeys.length ? a.passkeys.map((p) => `<div class="passkey-row">${I.key.replace('<svg', '<svg width="20" height="20"')}<div class="grow" style="flex:1"><div><b>${esc(p.label)}</b></div><div class="muted" style="font-size:12.5px">Added ${new Date(p.createdAt).toLocaleDateString('en-GB')}</div></div><button class="btn sm danger" data-del="${esc(p.id)}">Remove</button></div>`).join('') : '<p class="muted">No passkeys yet.</p>'}</div>
      <div class="form-actions" style="margin-top:10px"><input type="text" id="pk-label" placeholder="Name, e.g. MacBook Pro" style="max-width:260px"><button class="btn primary" id="pk-add">${I.key} Add a passkey</button></div>
      <label class="check" style="margin-top:22px"><input type="checkbox" id="pk-only" ${a.passkeysOnly ? 'checked' : ''} ${a.passkeys.length ? '' : 'disabled'}> Passkeys only: turn off password sign-in${a.hosted ? ' (recommended for the hosted dashboard)' : ''}</label>
      <p class="hint muted" style="margin:-8px 0 0;font-size:12px">${a.passkeys.length ? 'Keep at least one passkey on another device (e.g. your iPhone) in case you lose this one. If you’re ever locked out, set DASH_ALLOW_PASSWORD=1 in Railway and redeploy.' : 'Add a passkey first.'}</p>
      <h4 style="margin:30px 0 10px">Change password</h4>
      <form id="pw-form" class="form-grid" style="max-width:560px">
        <div class="field"><label for="pw-c">Current password</label><input type="password" id="pw-c" autocomplete="current-password"></div>
        <div class="field"><label for="pw-n">New password</label><input type="password" id="pw-n" autocomplete="new-password" minlength="10"></div>
        <div class="form-actions full"><button class="btn">Update password</button><span class="form-msg" id="pw-msg"></span></div>
      </form>`;
    $('#pk-only', body).onchange = async (e) => {
      try { await api('/api/auth/passkeys-only', { body: { on: e.target.checked } }); toast(e.target.checked ? 'Password sign-in turned off' : 'Password sign-in turned back on'); }
      catch (err) { e.target.checked = !e.target.checked; toast(err.message); }
    };
    $('#pk-add', body).onclick = async () => {
      try { await registerPasskey($('#pk-label', body).value || 'Passkey'); toast('Passkey added'); drawSecurity(body); }
      catch (err) { toast(passkeyError(err, 'Passkey not added: the prompt was cancelled or timed out. Try again and approve it with Touch ID.')); }
    };
    $$('[data-del]', body).forEach((b) => (b.onclick = async () => {
      if (!confirm('Remove this passkey? You can still sign in with your password.')) return;
      try { await api(`/api/auth/passkey/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); drawSecurity(body); }
      catch (err) { toast(err.message); }
    }));
    $('#pw-form', body).onsubmit = async (e) => {
      e.preventDefault();
      const m = $('#pw-msg', body);
      try { await api('/api/auth/password', { body: { current: $('#pw-c', body).value, next: $('#pw-n', body).value } }); m.className = 'form-msg ok-msg'; m.textContent = '✓ Password updated'; e.target.reset(); }
      catch (err) { m.className = 'form-msg error-msg'; m.textContent = err.message; }
    };
  }
  load();
  return { update: () => statusDot() };
}

boot();
