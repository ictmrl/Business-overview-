import { areaChart, barChart, hBars, donut, ring, sparkline, uptimeStrip, countUp, compact, esc, hideTip } from './charts.js';

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
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t.__t);
  t.__t = setTimeout(() => t.classList.remove('show'), 2800);
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
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
};

// ------------------------------------------------------------------ boot / auth
let state = { snap: null, auth: null, view: null, es: null };

async function boot() {
  state.es?.close();
  state.auth = await api('/api/auth/status');
  if (!state.auth.authed) return renderAuth();
  renderShell();
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
      <div class="field"><label for="p">Password</label><input id="p" type="password" required minlength="10" autocomplete="new-password"><span class="hint">At least 10 characters — used as a fallback to your passkey.</span></div>
      <button class="btn primary block">Create account</button>
      <div class="error-msg" id="err"></div>
    </form></div>`;
    $('#setup').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/api/auth/setup', { body: { name: $('#n').value, email: $('#e').value, password: $('#p').value } });
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
    ${supportsPasskey ? `<button class="btn primary block" id="pk">${I.key} Sign in with passkey</button><div class="divider">or use your password</div>` : ''}
    <form id="pw"><div class="field"><label for="p">Password</label><input id="p" type="password" autocomplete="current-password" ${a.hasPasskeys ? '' : 'autofocus'}></div>
    <button class="btn block">Sign in</button></form>
    <div class="error-msg" id="err"></div>
  </div></div>`;
  $('#pw').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/auth/login', { body: { password: $('#p').value } }); boot(); }
    catch (err) { $('#err').textContent = err.message; }
  };
  $('#pk')?.addEventListener('click', passkeyLogin);
  if (a.hasPasskeys && supportsPasskey) setTimeout(passkeyLogin, 300);
}

async function passkeyLogin() {
  try {
    const optionsJSON = await api('/api/auth/passkey/login/options', { method: 'POST', body: {} });
    const response = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON });
    await api('/api/auth/passkey/login/verify', { body: { response } });
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

async function offerPasskey() {
  try {
    await registerPasskey(navigator.platform?.includes('Mac') ? 'Mac (Touch ID)' : 'This device');
    toast('Passkey added — you can sign in with Touch ID next time');
    state.auth = await api('/api/auth/status');
  } catch (err) {
    if (err.name !== 'NotAllowedError') toast(err.message);
  }
}

// ------------------------------------------------------------------ shell
const VIEWS = {
  overview: { title: 'Overview', icon: 'overview', render: renderOverview },
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
      <nav class="nav">${Object.entries(VIEWS).map(([k, v]) => `<button data-view="${k}">${I[v.icon]}<span>${v.title}</span>${k === 'inbox' ? '<span class="badge" id="unread-badge" hidden></span>' : ''}</button>`).join('')}</nav>
      <div class="sidebar-foot">
        <div class="user-chip"><div class="avatar">${esc(u.name[0] || '?')}</div><div class="grow"><div>${esc(u.name)}</div><div class="muted" style="font-size:11.5px">${esc(u.email || 'Owner')}</div></div></div>
        <button class="btn ghost sm" id="logout">${I.logout} Sign out</button>
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
  connectStream();
  window.onhashchange = () => route();
  route();
}

function connectStream() {
  state.es?.close();
  const es = new EventSource('/api/stream');
  state.es = es;
  es.addEventListener('snapshot', (e) => setSnap(JSON.parse(e.data)));
  es.addEventListener('uptime', (e) => { if (state.snap) { state.snap.uptime = JSON.parse(e.data); state.view?.update?.(state.snap, 'uptime'); } });
  es.addEventListener('mail', () => { state.view?.onMail?.(); toast('New email arrived'); });
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
  const names = { stats: 'Business data', railway: 'Railway', stripe: 'Stripe', uptime: 'Uptime', email: 'Email' };
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
  if (qe.length) return `<div class="banner warn"><span class="status warning">${qe.length} ${qe.length === 1 ? 'query' : 'queries'} failed</span><span>These panels show “—” until the SQL matches your schema: ${qe.map(([k, v]) => `<b title="${esc(v)}">${esc(k)}</b>`).join(', ')}. <span class="muted">${esc(qe[0][1])}</span></span><a href="#settings" style="margin-left:auto;white-space:nowrap">Edit queries →</a></div>`;
  if (demo) return `<div class="banner"><span class="status demo">Demo data</span><span>Some panels are showing sample data. Connect Railway, your stats source and IMAP in <a href="#settings">Settings</a> to go live.</span></div>`;
  return '';
}
/** Paid vs trial split: a two-segment bar plus labelled counts (never colour alone). */
function drawSplit(box, s) {
  if (!box) return;
  if (!s || (s.paid == null && s.trialing == null)) { box.innerHTML = ''; return; }
  const paid = s.paid || 0, trial = s.trialing || 0, tot = paid + trial || 1;
  if (!box.querySelector('.split-bar')) {
    box.innerHTML = `<div class="split-bar" role="img"><i class="paid"></i><i class="trial"></i></div>
      <div class="split-legend"><span><i class="paid"></i><b class="sp-paid">—</b> paid</span><span><i class="trial"></i><b class="sp-trial">—</b> on trial</span><span class="muted sp-ending"></span></div>`;
  }
  box.querySelector('.split-bar').setAttribute('aria-label', `${paid} paid, ${trial} on trial`);
  requestAnimationFrame(() => {
    box.querySelector('.split-bar .paid').style.width = `${(paid / tot) * 100}%`;
    box.querySelector('.split-bar .trial').style.width = `${(trial / tot) * 100}%`;
  });
  countUp(box.querySelector('.sp-paid'), s.paid);
  countUp(box.querySelector('.sp-trial'), s.trialing);
  box.querySelector('.sp-ending').textContent = s.trialsEndingSoon ? `${int(s.trialsEndingSoon)} trials ending ≤3 days` : '';
}

const serviceStatus = (s) => {
  const ok = ['SUCCESS'], warn = ['BUILDING', 'DEPLOYING', 'INITIALIZING', 'QUEUED', 'WAITING', 'SLEEPING'];
  if (ok.includes(s)) return ['good', 'Healthy'];
  if (warn.includes(s)) return ['warning', s[0] + s.slice(1).toLowerCase()];
  if (s === 'NO_DEPLOYMENT') return ['neutral', 'No deploys'];
  return ['critical', s ? s[0] + s.slice(1).toLowerCase() : 'Unknown'];
};
const shortUrl = (u) => u.replace(/^https?:\/\//, '').replace(/\/$/, '');

// ------------------------------------------------------------------ overview
function renderOverview(el) {
  let metric = 'subscribers', range = 30, seenAI = new Set(), first = true;
  el.innerHTML = `<div class="view">
    <div id="ov-banner"></div>
    <div class="grid g-4">
      <button class="card hero lead" data-metric="subscribers" style="--c:var(--series-1)"><div class="label"><i>${I.users}</i>Subscribers <span class="muted" style="font-weight:400">paid + trial</span></div><div class="value" id="h-subs">—</div><div class="split" id="h-subs-split"></div><div class="meta" id="h-subs-m"></div><div class="spark-wrap" id="h-subs-s"></div></button>
      <button class="card hero" data-metric="active" style="--c:var(--series-3)"><div class="label"><i>${I.activity}</i>Active customers today</div><div class="value" id="h-act">—</div><div class="meta" id="h-act-m"></div><div class="spark-wrap" id="h-act-s"></div></button>
      <button class="card hero" data-metric="revenue" style="--c:var(--series-7)"><div class="label"><i>${I.pound}</i>Monthly recurring revenue</div><div class="value" id="h-mrr">—</div><div class="meta" id="h-mrr-m"></div><div class="spark-wrap" id="h-mrr-s"></div></button>
      <button class="card hero" data-metric="uptime" style="--c:var(--series-4)"><div class="label"><i>${I.shield}</i>Uptime (24h)</div><div class="value" id="h-up">—</div><div class="meta" id="h-up-m"></div><div class="spark-wrap" id="h-up-s" style="padding:8px 20px 14px;height:auto"></div></button>
    </div>
    <div class="card" id="accounts-card">
      <div class="card-head"><h3>Accounts</h3><span class="sub">who's signed up</span></div>
      <div class="grid g-4" style="gap:12px">
        <div class="mini"><div class="k">Parents</div><div class="v" id="ac-par">—</div><div class="muted acc-sub" id="ac-par-n"></div></div>
        <div class="mini"><div class="k">Students</div><div class="v" id="ac-stu">—</div><div class="muted acc-sub" id="ac-stu-n"></div></div>
        <div class="mini"><div class="k">Students per parent</div><div class="v" id="ac-ratio">—</div><div class="muted acc-sub">average family size</div></div>
        <div class="mini"><div class="k">Subscriptions per parent</div><div class="v" id="ac-subs">—</div><div class="muted acc-sub" id="ac-subs-n"></div></div>
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
        <div class="card-head"><h3>AI challenges</h3><span class="sub">last 30 days</span><div class="right"><a href="#ai" class="btn sm ghost">Details →</a></div></div>
        <div style="display:flex;gap:18px;align-items:center;margin-bottom:16px">
          <div class="ring-wrap" id="ai-ring"></div>
          <div style="display:grid;gap:10px;flex:1">
            <div class="mini"><div class="k">Today</div><div class="v" id="ai-today">—</div></div>
            <div class="mini"><div class="k">All time</div><div class="v" id="ai-total">—</div></div>
          </div>
        </div>
        <div class="hbars" id="ai-subjects"></div>
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
      <div class="card-head"><h3>Live AI challenge feed</h3><span class="sub">what students are working on right now</span></div>
      <div class="list" id="ai-feed"></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap" id="chips"></div>
  </div>`;

  $$('.hero', el).forEach((h) => (h.onclick = () => {
    if (h.dataset.metric === 'uptime') { location.hash = 'infra'; return; }
    metric = h.dataset.metric; first = true; drawMain(state.snap);
  }));
  $$('#range button', el).forEach((b) => (b.onclick = () => {
    range = +b.dataset.r; $$('#range button', el).forEach((x) => x.classList.toggle('on', x === b)); first = true; drawMain(state.snap);
  }));

  function drawMain(snap) {
    if (!snap) return;
    $$('.hero', el).forEach((h) => h.classList.toggle('selected', h.dataset.metric === metric));
    const cur = snap.revenue?.currency || 'GBP';
    const cfg = {
      subscribers: { title: 'Subscribers', sub: 'total active subscriptions', data: snap.subscribers?.history, color: 'var(--series-1)', fmt: int, zero: false },
      active: { title: 'Active customers', sub: 'daily active users', data: snap.active?.history, color: 'var(--series-3)', fmt: int, zero: false },
      revenue: { title: 'Revenue', sub: 'daily collected revenue', data: snap.revenue?.history, color: 'var(--series-7)', fmt: (v) => money(v, cur, 2), axis: (v) => money(v, cur).replace(/\.00$/, '') },
    }[metric];
    $('#main-title', el).textContent = cfg.title;
    $('#main-sub', el).textContent = cfg.sub;
    const data = (cfg.data || []).slice(-range);
    const box = $('#main-chart', el);
    if (!data.length) { box.innerHTML = `<div class="empty">No history yet for ${esc(cfg.title.toLowerCase())}.</div>`; box.__chart = null; return; }
    areaChart(box, data, { color: cfg.color, format: cfg.fmt, axisFormat: cfg.axis ? (v) => compact(v) : undefined, animate: first, zero: cfg.zero, label: cfg.title + ' trend' });
    first = false;
  }

  function drawAccounts(snap) {
    const ac = snap.accounts || {}, subs = snap.subscribers?.total;
    countUp($('#ac-par', el), ac.parents);
    countUp($('#ac-stu', el), ac.students);
    $('#ac-par-n', el).textContent = ac.parentsNewToday != null ? `+${int(ac.parentsNewToday)} today` : '';
    $('#ac-stu-n', el).textContent = ac.studentsNewToday != null ? `+${int(ac.studentsNewToday)} today` : '';
    const ratio = ac.parents && ac.students != null ? ac.students / ac.parents : null;
    const perParent = ac.parents && subs != null ? subs / ac.parents : null;
    countUp($('#ac-ratio', el), ratio, (n) => n.toFixed(2));
    countUp($('#ac-subs', el), perParent, (n) => n.toFixed(2));
    // If subscriptions per parent tracks students per parent, subscriptions are counted per child.
    $('#ac-subs-n', el).textContent = ratio && perParent ? (Math.abs(perParent - ratio) / ratio < 0.15 ? 'looks like one per child' : perParent <= 1.15 ? 'looks like one per family' : '') : '';
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
      $('#h-act-m', el).innerHTML = deltaHtml(delta(snap.active?.history?.slice(0, -1)), 'yesterday vs 30d') + (snap.active?.live != null ? `<span>${delta(snap.active?.history?.slice(0, -1)) != null ? '· ' : ''}${int(snap.active.live)} online now</span>` : '');
      sparkline($('#h-act-s', el), (snap.active?.history || []).map((d) => d.value), { color: 'var(--series-3)', animate: isInit });
      countUp($('#h-mrr', el), snap.revenue?.mrr, (n) => money(n, cur));
      $('#h-mrr-m', el).innerHTML = snap.revenue ? `<span>${money(snap.revenue.month, cur)} this month</span>` : '';
      sparkline($('#h-mrr-s', el), (snap.revenue?.history || []).map((d) => d.value), { color: 'var(--series-7)', animate: isInit });

      drawAccounts(snap);
      drawMain(snap);
      const byHour = snap.usage?.byHour;
      if (byHour?.length) barChart($('#hours', el), byHour, byHour.map((_, h) => String(h).padStart(2, '0')), { color: 'var(--series-1)', highlight: new Date().getHours(), tipLabel: (h) => `${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00`, animate: isInit, label: 'Sessions by hour today' });
      else $('#hours', el).innerHTML = '<div class="empty">No hourly data</div>';
      countUp($('#t-sess', el), snap.usage?.sessionsToday);
      countUp($('#t-new', el), snap.subscribers?.newToday);
      countUp($('#t-trials', el), snap.subscribers?.newTrialsToday);
      countUp($('#t-rev', el), snap.revenue?.today, (n) => money(n, cur));

      // AI
      const ai = snap.ai;
      if (ai) {
        ring($('#ai-ring', el), ai.completionRate, { color: 'var(--series-3)', caption: 'completion rate', decimals: 0, label: 'Completion rate' });
        countUp($('#ai-today', el), ai.today);
        countUp($('#ai-total', el), ai.total, (n) => compact(n));
        hBars($('#ai-subjects', el), (ai.bySubject || []).slice(0, 5), { color: 'var(--series-1)' });
        const feed = (ai.recent || []).slice(0, 6);
        $('#ai-feed', el).innerHTML = feed.length ? feed.map((c) => {
          const k = c.createdAt + c.title;
          const isNew = !first && !isInit && !seenAI.has(k);
          return `<div class="row ${isNew ? 'new' : ''}">
            <span class="tag">${esc(c.subject)}</span>
            <div class="grow"><div class="title">${esc(c.title)}</div><div class="desc">${esc([c.level, c.student].filter(Boolean).join(' · '))}</div></div>
            ${c.completed ? `<span class="status good">Completed</span>` : `<span class="status neutral">In progress</span>`}
            <span class="score">${c.score != null ? c.score + '%' : '—'}</span>
            <span class="time">${ago(c.createdAt)}</span></div>`;
        }).join('') : '<div class="empty">No challenges yet</div>';
        seenAI = new Set(feed.map((c) => c.createdAt + c.title));
      }

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
  let seen = new Set(), drawn = false;
  el.innerHTML = `<div class="view">
    <div class="grid g-4">
      <div class="card hero lead" style="--c:var(--series-7);cursor:default"><div class="label"><i>${I.ai}</i>Challenges generated</div><div class="value" id="a-total">—</div><div class="meta">all time</div></div>
      <div class="card hero" style="--c:var(--series-1);cursor:default"><div class="label"><i>${I.activity}</i>Today</div><div class="value" id="a-today">—</div><div class="meta" id="a-today-m">since midnight</div></div>
      <div class="card hero" style="--c:var(--series-3);cursor:default"><div class="label"><i>${I.shield}</i>Completion rate</div><div class="value" id="a-comp">—</div><div class="meta">last 30 days</div></div>
      <div class="card hero" style="--c:var(--series-4);cursor:default"><div class="label"><i>${I.users}</i>Average score</div><div class="value" id="a-score">—</div><div class="meta">completed challenges</div></div>
    </div>
    <div class="grid g-2">
      <div class="card"><div class="card-head"><h3>By subject</h3><span class="sub">last 30 days</span></div><div class="hbars" id="a-subj"></div></div>
      <div class="card"><div class="card-head"><h3>By level</h3><span class="sub">share of challenges</span></div><div id="a-level"></div>
        <div class="card-head" style="margin-top:22px"><h3>Today vs average</h3></div><div class="stats-row" id="a-mini"></div></div>
    </div>
    <div class="card"><div class="card-head"><h3>Recent challenges</h3><span class="sub">live — new ones slide in</span><div class="right"><input type="text" id="a-q" placeholder="Filter by subject or title…" style="width:240px;padding:7px 10px"></div></div>
      <div class="list" id="a-recent"></div></div>
  </div>`;
  $('#a-q', el).oninput = () => state.snap && update(state.snap);
  function update(snap, why) {
    if (why === 'uptime') return;
    const ai = snap.ai;
    if (!ai) { $('#a-recent', el).innerHTML = '<div class="empty">No AI challenge data yet — configure your business data source in Settings.</div>'; return; }
    countUp($('#a-total', el), ai.total);
    countUp($('#a-today', el), ai.today);
    countUp($('#a-comp', el), ai.completionRate, (n) => `${n.toFixed(1)}%`);
    countUp($('#a-score', el), ai.avgScore, (n) => `${n.toFixed(1)}%`);
    hBars($('#a-subj', el), ai.bySubject || [], { color: 'var(--series-1)' });
    const lv = (ai.byLevel || []).slice(0, 4);
    if (lv.length && !drawn) donut($('#a-level', el), lv, ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'], { center: 'challenges', label: 'Challenges by level' });
    else if (!lv.length) $('#a-level', el).innerHTML = '<div class="empty">No level breakdown provided</div>';
    const daysSoFar = Math.max(0.05, (Date.now() - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
    $('#a-mini', el).innerHTML = `
      <div class="mini"><div class="k">Pace today</div><div class="v">${ai.today != null ? int(ai.today / daysSoFar) : '—'}</div><div class="muted" style="font-size:11.5px">projected/day</div></div>
      <div class="mini"><div class="k">Top subject</div><div class="v" style="font-size:17px">${esc(ai.bySubject?.[0]?.name || '—')}</div></div>
      <div class="mini"><div class="k">Subjects</div><div class="v">${(ai.bySubject || []).length}</div></div>`;
    const q = $('#a-q', el).value.trim().toLowerCase();
    const list = (ai.recent || []).filter((c) => !q || `${c.title} ${c.subject} ${c.level}`.toLowerCase().includes(q));
    $('#a-recent', el).innerHTML = list.length ? list.map((c) => {
      const k = c.createdAt + c.title;
      return `<div class="row ${drawn && !seen.has(k) ? 'new' : ''}">
        <span class="tag">${esc(c.subject)}</span>
        <div class="grow"><div class="title">${esc(c.title)}</div><div class="desc">${esc([c.level, c.student].filter(Boolean).join(' · '))}</div></div>
        ${c.completed ? '<span class="status good">Completed</span>' : '<span class="status neutral">In progress</span>'}
        <span class="score">${c.score != null ? c.score + '%' : '—'}</span><span class="time">${ago(c.createdAt)}</span></div>`;
    }).join('') : '<div class="empty">No matching challenges</div>';
    seen = new Set((ai.recent || []).map((c) => c.createdAt + c.title));
    drawn = true;
  }
  return { update };
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
    title: 'Railway', desc: 'Service health, deploy status and CPU / memory from Railway’s API. Create a token in Railway → Account Settings → Tokens (or a project token in Project → Settings → Tokens).', test: true,
    fields: [
      { k: 'token', label: 'API token', secret: true, full: true },
      { k: 'tokenType', label: 'Token type', type: 'select', options: [['account', 'Account / team token'], ['project', 'Project token']] },
      { k: 'projectId', label: 'Project ID', hint: 'Project → Settings → General, or from the project URL.' },
      { k: 'environmentId', label: 'Environment ID (optional)', hint: 'Defaults to “production”.', full: true },
    ],
  },
  stats: {
    title: 'Business data', desc: 'Where subscribers, active customers, usage, revenue and AI challenge numbers come from. Either an admin stats endpoint on your Tutorise backend, or a direct read-only connection to its Railway Postgres database.', test: true,
    fields: [
      { k: 'mode', label: 'Source', type: 'select', options: [['api', 'Tutorise stats API endpoint'], ['postgres', 'Railway Postgres (direct SQL)']], full: true },
      { k: 'apiBaseUrl', label: 'API base URL', show: (v) => v.mode === 'api' },
      { k: 'apiPath', label: 'Stats path', show: (v) => v.mode === 'api' },
      { k: 'apiToken', label: 'Bearer token', secret: true, full: true, show: (v) => v.mode === 'api', hint: 'See docs/stats-endpoint.md for the JSON shape the endpoint should return.' },
      { k: 'databaseUrl', label: 'DATABASE_PUBLIC_URL', secret: true, full: true, show: (v) => v.mode === 'postgres', hint: 'From your Postgres service → Variables in Railway. Use a read-only database user if you can.' },
      { k: 'databaseSsl', label: 'Use SSL', type: 'check', show: (v) => v.mode === 'postgres' },
      { k: 'queries', label: 'SQL queries', type: 'queries', full: true, show: (v) => v.mode === 'postgres' },
    ],
  },
  stripe: {
    title: 'Stripe (optional)', desc: 'If set, MRR and revenue come straight from Stripe and override the business data source. Use a restricted key with read access to Subscriptions and Charges.', test: true,
    fields: [{ k: 'secretKey', label: 'Restricted API key (rk_live_…)', secret: true, full: true }],
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
  security: { title: 'Security & login', custom: true },
};

function renderSettings(el) {
  let data = null, section = 'general';
  el.innerHTML = `<div class="view"><div class="settings">
    <nav class="settings-nav" id="s-nav">${Object.entries(SECTIONS).map(([k, s]) => `<button data-s="${k}">${esc(s.title)}<span id="sn-${k}"></span></button>`).join('')}</nav>
    <div class="card" id="s-body"><div class="skeleton" style="height:200px"></div></div>
  </div></div>`;
  $$('#s-nav button', el).forEach((b) => (b.onclick = () => { section = b.dataset.s; draw(); }));

  async function load() { data = await api('/api/settings'); draw(); }
  function statusDot() {
    const map = { railway: 'railway', stats: 'stats', stripe: 'stripe', email: 'email', uptime: 'uptime' };
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
    if (def.custom) return drawSecurity(body);
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
      return `<div class="${cls}"><label for="${id}">${esc(f.label)}</label><input type="${f.type === 'number' ? 'number' : 'text'}" id="${id}" value="${esc(v)}">${hint}</div>`;
    };
    body.innerHTML = `<div class="card-head"><h3 style="font-size:17px">${esc(def.title)}</h3></div>
      <p class="section-desc">${esc(def.desc)}</p>
      <form id="s-form"><div class="form-grid">${def.fields.map(fieldHtml).join('')}</div>
      <div class="form-actions"><button class="btn primary" type="submit">Save</button>${def.test ? '<button class="btn" type="button" id="s-test">Test connection</button>' : ''}<span class="form-msg" id="s-msg"></span></div></form>`;
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
    $('#s-test', body)?.addEventListener('click', async () => {
      msg.className = 'form-msg muted'; msg.textContent = 'Testing…';
      try { const r = await api(`/api/settings/${section}/test`, { body: collect() }); msg.className = 'form-msg ok-msg'; msg.textContent = '✓ ' + r.message; }
      catch (err) { msg.className = 'form-msg error-msg'; msg.textContent = '✕ ' + err.message; }
    });
  }

  async function drawSecurity(body) {
    const a = await api('/api/auth/status');
    body.innerHTML = `<div class="card-head"><h3 style="font-size:17px">Security & login</h3></div>
      <p class="section-desc">Passkeys let you sign in with Touch ID or your iCloud Keychain — no password needed. Secrets are encrypted at rest in <code>${esc(data.dataDir)}</code>.</p>
      <h4 style="margin:18px 0 4px">Passkeys</h4>
      <div id="pk-list">${a.passkeys.length ? a.passkeys.map((p) => `<div class="passkey-row">${I.key.replace('<svg', '<svg width="20" height="20"')}<div class="grow" style="flex:1"><div><b>${esc(p.label)}</b></div><div class="muted" style="font-size:12.5px">Added ${new Date(p.createdAt).toLocaleDateString('en-GB')}</div></div><button class="btn sm danger" data-del="${esc(p.id)}">Remove</button></div>`).join('') : '<p class="muted">No passkeys yet.</p>'}</div>
      <div class="form-actions" style="margin-top:10px"><input type="text" id="pk-label" placeholder="Name, e.g. MacBook Pro" style="max-width:260px"><button class="btn primary" id="pk-add">${I.key} Add a passkey</button></div>
      <h4 style="margin:30px 0 10px">Change password</h4>
      <form id="pw-form" class="form-grid" style="max-width:560px">
        <div class="field"><label for="pw-c">Current password</label><input type="password" id="pw-c" autocomplete="current-password"></div>
        <div class="field"><label for="pw-n">New password</label><input type="password" id="pw-n" autocomplete="new-password" minlength="10"></div>
        <div class="form-actions full"><button class="btn">Update password</button><span class="form-msg" id="pw-msg"></span></div>
      </form>`;
    $('#pk-add', body).onclick = async () => {
      try { await registerPasskey($('#pk-label', body).value || 'Passkey'); toast('Passkey added'); drawSecurity(body); }
      catch (err) { if (err.name !== 'NotAllowedError') toast(err.message); }
    };
    $$('[data-del]', body).forEach((b) => (b.onclick = async () => {
      if (!confirm('Remove this passkey? You can still sign in with your password.')) return;
      await api(`/api/auth/passkey/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); drawSecurity(body);
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
