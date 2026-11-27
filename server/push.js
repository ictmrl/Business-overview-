// Web push notifications + app badge for the installed (Home Screen) dashboard.
// iPhone: iOS 16.4+, app added to the Home Screen and opened from its icon.
// Keys are generated on first use and stored (private key encrypted) in the
// dashboard's state. Every push carries the current badge count.
import express from 'express';
import * as webpush from 'web-push';
import { getState, save, encrypt, decrypt } from './store.js';

const DEFAULT_PREFS = { email: true, subscribers: true, tasks: true, uptime: true };

function pushState() {
  const st = getState();
  st.push ||= {};
  st.push.subscriptions ||= [];
  st.push.prefs = { ...DEFAULT_PREFS, ...(st.push.prefs || {}) };
  st.push.seen ||= {};
  st.push.notifiedOverdue ||= [];
  return st.push;
}

function vapid() {
  const p = pushState();
  if (!p.vapid?.publicKey) {
    const k = webpush.generateVAPIDKeys();
    p.vapid = { publicKey: k.publicKey, privateKey: encrypt(k.privateKey) };
    save();
  }
  return { publicKey: p.vapid.publicKey, privateKey: decrypt(p.vapid.privateKey) };
}

// ---------------------------------------------------------------- badge
/**
 * Badge = unread emails + new subscribers since the app was last opened + overdue tasks.
 * Only live sources count (never demo data).
 */
export function badgeParts(snap) {
  const p = pushState();
  const emails = snap?.sources?.email?.state === 'live' ? (snap.inbox?.unread || 0) : 0;
  const total = snap?.sources?.stats?.state === 'live' ? snap.subscribers?.total : null;
  if (total != null && p.seen.subscribers == null) { p.seen.subscribers = total; save(); } // first live read sets the baseline
  const subscribers = total != null ? Math.max(0, total - (p.seen.subscribers ?? total)) : 0;
  const tasks = snap?.tasks?.red || 0;
  return { emails, subscribers, tasks, total: emails + subscribers + tasks };
}

/** Opening the app counts as having seen the new subscribers. */
export function markSeen(snap) {
  const p = pushState();
  if (snap?.sources?.stats?.state === 'live' && snap.subscribers?.total != null) { p.seen.subscribers = snap.subscribers.total; save(); }
}

// ---------------------------------------------------------------- sending
let subject = 'https://tutorise.uk';
export function setPushSubject(origin) { if (/^https:\/\//.test(origin || '')) subject = origin; }

export async function sendToAll(payload) {
  const p = pushState();
  if (!p.subscriptions.length) return { sent: 0, failed: 0 };
  const { publicKey, privateKey } = vapid();
  const body = JSON.stringify(payload);
  let sent = 0, failed = 0, removed = 0;
  await Promise.all(p.subscriptions.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, {
        TTL: 60 * 60 * 24, urgency: payload.urgency || 'normal', topic: payload.topic,
        vapidDetails: { subject, publicKey, privateKey },
      });
      s.lastOk = new Date().toISOString(); sent++;
    } catch (e) {
      failed++;
      // 404/410: the device unsubscribed or the app was removed; forget it.
      if (e.statusCode === 404 || e.statusCode === 410) { s.gone = true; removed++; }
      else s.lastError = `${e.statusCode || ''} ${e.body || e.message}`.trim().slice(0, 200);
    }
  }));
  if (removed) p.subscriptions = p.subscriptions.filter((s) => !s.gone);
  save();
  return { sent, failed, removed };
}

// ---------------------------------------------------------------- triggers
let prev = null;          // last snapshot's relevant values
const lastSent = {};      // per-type throttle
const THROTTLE_MS = 60_000;

/**
 * Compare the new snapshot with the previous one and notify about changes:
 * new email, new subscribers/trials, tasks that have just become overdue,
 * sites that have just gone down (or come back). Nothing fires on the first
 * snapshot after a start, so restarts don't replay old news.
 */
export async function checkForNotifications(snap, overdue = []) {
  const p = pushState();
  const prefs = p.prefs;
  const badge = badgeParts(snap);
  const cur = {
    emailLive: snap.sources?.email?.state === 'live',
    unread: snap.inbox?.unread ?? null,
    latest: snap.inbox?.latest?.[0] || null,
    statsLive: snap.sources?.stats?.state === 'live',
    subs: snap.subscribers?.total ?? null,
    trials: snap.subscribers?.trialing ?? null,
    down: new Set((snap.uptime?.checks || []).filter((c) => c.up === false).map((c) => c.url)),
    upKnown: new Set((snap.uptime?.checks || []).filter((c) => c.up != null).map((c) => c.url)),
  };
  const before = prev;
  prev = cur;
  const jobs = [];
  const fire = (type, payload) => {
    if (Date.now() - (lastSent[type] || 0) < THROTTLE_MS && !payload.always) return;
    lastSent[type] = Date.now();
    jobs.push(sendToAll({ ...payload, badge: badge.total }));
  };

  // Overdue tasks: notify once per task per due date, also across restarts.
  if (prefs.tasks) {
    const red = overdue;
    const keys = new Set(red.map((t) => `${t.id}@${t.dueDate}`));
    const known = new Set(p.notifiedOverdue);
    const fresh = red.filter((t) => !known.has(`${t.id}@${t.dueDate}`));
    if (fresh.length && p.overdueBaselineSet) {
      fire('tasks', { title: fresh.length === 1 ? 'Task overdue' : `${fresh.length} tasks overdue`, body: fresh.slice(0, 3).map((t) => t.title).join(', ') + (fresh.length > 3 ? '…' : ''), url: '/#tasks', tag: 'tasks', always: true });
    }
    p.notifiedOverdue = [...keys]; p.overdueBaselineSet = true;
    save();
  }

  if (before) {
    if (prefs.email && cur.emailLive && before.emailLive && cur.unread != null && before.unread != null && cur.unread > before.unread) {
      const n = cur.unread - before.unread, m = cur.latest;
      fire('email', { title: n === 1 && m ? `Email from ${m.from?.name || m.from?.address || 'someone'}` : `${n} new emails`, body: n === 1 && m ? m.subject : `${cur.unread} unread`, url: m ? `/#inbox/${m.uid}` : '/#inbox', tag: 'email' });
    }
    if (prefs.subscribers && cur.statsLive && before.statsLive && cur.subs != null && before.subs != null && cur.subs > before.subs) {
      const n = cur.subs - before.subs, t = (cur.trials ?? 0) - (before.trials ?? 0);
      fire('subscribers', { title: n === 1 ? 'New subscriber' : `${n} new subscribers`, body: `Now ${cur.subs} subscribers${t > 0 ? ` (${t} new on trial)` : ''}`, url: '/', tag: 'subscribers' });
    }
    if (prefs.uptime) {
      const wentDown = [...cur.down].filter((u) => !before.down.has(u) && before.upKnown.has(u));
      const cameBack = [...before.down].filter((u) => !cur.down.has(u) && cur.upKnown.has(u));
      const host = (u) => u.replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (wentDown.length) fire('uptime-down', { title: `${wentDown.map(host).join(', ')} is down`, body: 'The uptime check is failing.', url: '/#infra', tag: 'uptime', urgency: 'high', always: true });
      if (cameBack.length) fire('uptime-up', { title: `${cameBack.map(host).join(', ')} is back up`, body: 'The uptime check is passing again.', url: '/#infra', tag: 'uptime', always: true });
    }
  }
  await Promise.all(jobs);
}

// ---------------------------------------------------------------- API
export function pushRouter(getSnapshot) {
  const r = express.Router();
  r.get('/', (req, res) => {
    const p = pushState();
    res.json({
      publicKey: vapid().publicKey,
      prefs: p.prefs,
      devices: p.subscriptions.map((s) => ({ endpoint: s.endpoint, label: s.label, createdAt: s.createdAt, lastOk: s.lastOk, lastError: s.lastError })),
      badge: badgeParts(getSnapshot()),
    });
  });
  r.post('/subscribe', (req, res) => {
    const sub = req.body?.subscription;
    if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return res.status(400).json({ error: 'Invalid subscription' });
    const p = pushState();
    p.subscriptions = p.subscriptions.filter((s) => s.endpoint !== sub.endpoint);
    p.subscriptions.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, label: String(req.body.label || 'Device').slice(0, 60), createdAt: new Date().toISOString() });
    p.subscriptions = p.subscriptions.slice(-10);
    save();
    setPushSubject(req.get('origin'));
    res.json({ ok: true });
  });
  r.post('/unsubscribe', (req, res) => {
    const p = pushState();
    p.subscriptions = p.subscriptions.filter((s) => s.endpoint !== req.body?.endpoint);
    save();
    res.json({ ok: true });
  });
  r.put('/prefs', (req, res) => {
    const p = pushState();
    for (const k of Object.keys(DEFAULT_PREFS)) if (k in (req.body || {})) p.prefs[k] = !!req.body[k];
    save();
    res.json({ ok: true, prefs: p.prefs });
  });
  r.post('/test', async (req, res) => {
    const badge = badgeParts(getSnapshot());
    const r2 = await sendToAll({ title: 'Tutorise HQ', body: `Notifications are working. Badge: ${badge.total} (${badge.emails} email, ${badge.subscribers} new subscribers, ${badge.tasks} overdue tasks).`, url: '/#settings/notifications', tag: 'test', badge: badge.total });
    if (!r2.sent) return res.status(400).json({ error: r2.failed ? 'Sending failed. See the device list for the error.' : 'No devices are set up for notifications yet.' });
    res.json({ ok: true, ...r2 });
  });
  // The app was opened: clear "new subscribers" and return the current badge.
  r.post('/seen', (req, res) => { markSeen(getSnapshot()); res.json({ ok: true, badge: badgeParts(getSnapshot()) }); });
  return r;
}
