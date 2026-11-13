// IMAP inbox (ImapFlow, kept connected with IDLE so new mail shows up
// instantly) and SMTP replies (Nodemailer). Replies are threaded with
// In-Reply-To/References, flagged \Answered and copied to the Sent folder.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';

export const emailConfigured = (cfg) => !!(cfg.imapHost && cfg.imapUser && cfg.imapPassword);
export const smtpConfigured = (cfg) => !!(cfg.smtpHost && (cfg.smtpUser || cfg.imapUser) && (cfg.smtpPassword || cfg.imapPassword));

let client = null;
let clientKey = '';
let connecting = null;
let onNewMail = () => {};
let lastError = null;
const bodyCache = new Map(); // uid -> { text, html, preview, messageId, references }

const key = (cfg) => [cfg.imapHost, cfg.imapPort, cfg.imapSecure, cfg.imapUser, cfg.imapPassword, cfg.mailbox].join('|');

function makeClient(cfg) {
  return new ImapFlow({
    host: cfg.imapHost, port: Number(cfg.imapPort), secure: !!cfg.imapSecure,
    auth: { user: cfg.imapUser, pass: cfg.imapPassword },
    logger: false, emitLogs: false,
  });
}

async function getClient(cfg) {
  if (client?.usable && clientKey === key(cfg)) return client;
  if (connecting) return connecting;
  connecting = (async () => {
    try { await client?.logout(); } catch {}
    bodyCache.clear();
    const c = makeClient(cfg);
    c.on('error', (e) => { lastError = e.message; });
    c.on('close', () => { if (client === c) client = null; });
    c.on('exists', () => onNewMail());
    await c.connect();
    await c.mailboxOpen(cfg.mailbox || 'INBOX');
    client = c; clientKey = key(cfg); lastError = null;
    return c;
  })();
  try { return await connecting; } finally { connecting = null; }
}

export function setOnNewMail(cb) { onNewMail = cb; }
export const emailError = () => lastError;

export async function disconnectEmail() {
  const c = client; client = null; bodyCache.clear();
  try { await c?.logout(); } catch {}
}

const addr = (a) => (a && a[0] ? { name: a[0].name || '', address: a[0].address || '' } : { name: '', address: '' });

export async function listMessages(cfg) {
  const c = await getClient(cfg);
  const total = c.mailbox.exists;
  if (!total) return { messages: [], unread: 0 };
  const count = Math.min(Number(cfg.fetchCount) || 30, 100);
  const from = Math.max(1, total - count + 1);
  const msgs = [];
  const needBody = [];
  for await (const m of c.fetch(`${from}:*`, { uid: true, envelope: true, flags: true, internalDate: true, size: true })) {
    msgs.push({
      uid: m.uid,
      from: addr(m.envelope.from),
      to: addr(m.envelope.to),
      subject: m.envelope.subject || '(no subject)',
      date: (m.envelope.date || m.internalDate)?.toISOString?.() || null,
      seen: m.flags.has('\\Seen'),
      answered: m.flags.has('\\Answered'),
      flagged: m.flags.has('\\Flagged'),
      messageId: m.envelope.messageId,
    });
    if (!bodyCache.has(m.uid)) needBody.push(m.uid);
  }
  // Fetch bodies (for previews) of messages we have not parsed yet.
  if (needBody.length) {
    for await (const m of c.fetch(needBody.join(','), { uid: true, source: { maxLength: 256 * 1024 } }, { uid: true })) {
      try {
        const p = await simpleParser(m.source);
        const text = (p.text || '').trim() || htmlToText(p.html || '');
        bodyCache.set(m.uid, { text, html: p.html || null, preview: text.replace(/\s+/g, ' ').slice(0, 160), references: p.references, messageId: p.messageId });
      } catch { bodyCache.set(m.uid, { text: '', preview: '' }); }
    }
  }
  for (const m of msgs) m.preview = bodyCache.get(m.uid)?.preview || '';
  msgs.sort((a, b) => new Date(b.date) - new Date(a.date));
  const unread = (await c.status(cfg.mailbox || 'INBOX', { unseen: true }).catch(() => ({}))).unseen ?? msgs.filter((m) => !m.seen).length;
  return { messages: msgs, unread };
}

const htmlToText = (h) => h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();

export async function getMessage(cfg, uid) {
  const c = await getClient(cfg);
  const m = await c.fetchOne(String(uid), { uid: true, envelope: true, flags: true, source: { maxLength: 2 * 1024 * 1024 } }, { uid: true });
  if (!m) throw new Error('Message not found');
  const p = await simpleParser(m.source);
  await c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }).catch(() => {});
  return {
    uid: m.uid,
    from: addr(m.envelope.from),
    to: addr(m.envelope.to),
    cc: p.cc?.text || '',
    subject: m.envelope.subject || '(no subject)',
    date: m.envelope.date?.toISOString?.(),
    text: (p.text || '').trim() || htmlToText(p.html || ''),
    html: p.html || null,
    messageId: p.messageId,
    references: p.references,
    attachments: (p.attachments || []).map((a) => ({ filename: a.filename, size: a.size, contentType: a.contentType })),
    answered: m.flags.has('\\Answered'),
  };
}

export async function setFlag(cfg, uid, flag, on) {
  const c = await getClient(cfg);
  const f = { seen: '\\Seen', flagged: '\\Flagged' }[flag];
  if (!f) throw new Error('Unknown flag');
  if (on) await c.messageFlagsAdd(String(uid), [f], { uid: true });
  else await c.messageFlagsRemove(String(uid), [f], { uid: true });
}

export async function sendReply(cfg, uid, body) {
  if (!smtpConfigured(cfg)) throw new Error('SMTP is not configured (Settings → Email)');
  const original = await getMessage(cfg, uid);
  const refs = [].concat(original.references || [], original.messageId || []).filter(Boolean);
  const subject = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;
  const quoted = original.text.split('\n').map((l) => '> ' + l).join('\n');
  const from = { name: cfg.fromName || '', address: cfg.fromAddress || cfg.smtpUser || cfg.imapUser };
  const mail = {
    from, to: body.to || original.from.address, cc: body.cc || undefined, subject,
    text: `${body.text}\n\nOn ${new Date(original.date).toLocaleString('en-GB')}, ${original.from.name || original.from.address} wrote:\n${quoted}`,
    inReplyTo: original.messageId, references: refs,
  };
  const transport = nodemailer.createTransport({
    host: cfg.smtpHost, port: Number(cfg.smtpPort), secure: !!cfg.smtpSecure,
    auth: { user: cfg.smtpUser || cfg.imapUser, pass: cfg.smtpPassword || cfg.imapPassword },
  });
  const info = await transport.sendMail(mail);
  const c = await getClient(cfg);
  await c.messageFlagsAdd(String(uid), ['\\Answered'], { uid: true }).catch(() => {});
  // Save a copy to Sent (most IMAP servers don't do this for SMTP submissions).
  try {
    const boxes = await c.list();
    const sent = boxes.find((b) => b.specialUse === '\\Sent') || boxes.find((b) => /^(sent|sent items|sent messages)$/i.test(b.name));
    if (sent) {
      const raw = await new MailComposer({ ...mail, messageId: info.messageId, date: new Date() }).compile().build();
      await c.append(sent.path, raw, ['\\Seen']);
    }
  } catch {}
  return { ok: true, messageId: info.messageId };
}

export async function testEmail(cfg) {
  const c = makeClient(cfg);
  await c.connect();
  const st = await c.status(cfg.mailbox || 'INBOX', { messages: true, unseen: true });
  await c.logout();
  let smtp = 'SMTP not configured';
  if (smtpConfigured(cfg)) {
    await nodemailer.createTransport({ host: cfg.smtpHost, port: Number(cfg.smtpPort), secure: !!cfg.smtpSecure, auth: { user: cfg.smtpUser || cfg.imapUser, pass: cfg.smtpPassword || cfg.imapPassword } }).verify();
    smtp = 'SMTP OK';
  }
  return `IMAP OK — ${st.messages} messages, ${st.unseen} unread. ${smtp}.`;
}
