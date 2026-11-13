// Single-owner authentication: password (scrypt) plus passkeys (WebAuthn —
// Touch ID / iCloud Keychain on a Mac). Passkeys need a secure context, which
// browsers grant to http://localhost, so always open the dashboard on
// localhost (not 127.0.0.1).
import crypto from 'node:crypto';
import express from 'express';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { getState, save } from './store.js';

const RP_NAME = 'Tutorise Dashboard';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = hashPassword(password, salt).split(':')[1];
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

const rp = (req) => ({ rpID: req.hostname, origin: `${req.protocol}://${req.get('host')}` });

// Basic brute-force protection for the password form.
const attempts = new Map();
function throttled(ip) {
  const a = attempts.get(ip);
  return a && a.count >= 5 && Date.now() - a.first < 15 * 60_000;
}
function recordFail(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.first > 15 * 60_000) attempts.set(ip, { count: 1, first: Date.now() });
  else a.count++;
}

export function requireAuth(req, res, next) {
  if (req.session?.authed) return next();
  res.status(401).json({ error: 'Not signed in' });
}

export const authRouter = express.Router();

authRouter.get('/status', (req, res) => {
  const { user, passkeys } = getState();
  res.json({
    setupRequired: !user,
    authed: !!req.session?.authed,
    user: req.session?.authed && user ? { name: user.name, email: user.email } : null,
    passkeys: req.session?.authed ? passkeys.map((p) => ({ id: p.id, label: p.label, createdAt: p.createdAt })) : undefined,
    hasPasskeys: passkeys.length > 0,
  });
});

authRouter.post('/setup', (req, res) => {
  const state = getState();
  if (state.user) return res.status(409).json({ error: 'Already set up' });
  const { name, email, password } = req.body || {};
  if (!name || !password || password.length < 10) {
    return res.status(400).json({ error: 'Name and a password of at least 10 characters are required' });
  }
  state.user = { id: crypto.randomBytes(16).toString('base64url'), name, email: email || '', password: hashPassword(password) };
  save();
  req.session.regenerate(() => {
    req.session.authed = true;
    res.json({ ok: true });
  });
});

authRouter.post('/login', (req, res) => {
  const { user } = getState();
  if (throttled(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  if (!user || !checkPassword(req.body?.password || '', user.password)) {
    recordFail(req.ip);
    return res.status(401).json({ error: 'Incorrect password' });
  }
  attempts.delete(req.ip);
  req.session.regenerate(() => {
    req.session.authed = true;
    res.json({ ok: true });
  });
});

authRouter.post('/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

authRouter.post('/password', requireAuth, (req, res) => {
  const state = getState();
  const { current, next } = req.body || {};
  if (!checkPassword(current || '', state.user.password)) return res.status(401).json({ error: 'Current password is incorrect' });
  if (!next || next.length < 10) return res.status(400).json({ error: 'New password must be at least 10 characters' });
  state.user.password = hashPassword(next);
  save();
  res.json({ ok: true });
});

// ---- Passkey registration (must already be signed in) ----
authRouter.post('/passkey/register/options', requireAuth, async (req, res) => {
  const { user, passkeys } = getState();
  const { rpID } = rp(req);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.email || user.name,
    userDisplayName: user.name,
    userID: Buffer.from(user.id, 'base64url'),
    attestationType: 'none',
    excludeCredentials: passkeys.map((p) => ({ id: p.id, transports: p.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  req.session.regChallenge = options.challenge;
  res.json(options);
});

authRouter.post('/passkey/register/verify', requireAuth, async (req, res) => {
  const state = getState();
  const { rpID, origin } = rp(req);
  try {
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response: req.body.response,
      expectedChallenge: req.session.regChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
    if (!verified) throw new Error('Passkey could not be verified');
    const { credential } = registrationInfo;
    state.passkeys.push({
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports || [],
      label: (req.body.label || 'Passkey').slice(0, 60),
      rpID,
      createdAt: new Date().toISOString(),
    });
    save();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    delete req.session.regChallenge;
  }
});

authRouter.delete('/passkey/:id', requireAuth, (req, res) => {
  const state = getState();
  state.passkeys = state.passkeys.filter((p) => p.id !== req.params.id);
  save();
  res.json({ ok: true });
});

// ---- Passkey sign-in ----
authRouter.post('/passkey/login/options', async (req, res) => {
  const { rpID } = rp(req);
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred', allowCredentials: [] });
  req.session.authChallenge = options.challenge;
  res.json(options);
});

authRouter.post('/passkey/login/verify', async (req, res) => {
  const state = getState();
  const { rpID, origin } = rp(req);
  const body = req.body?.response;
  const pk = state.passkeys.find((p) => p.id === body?.id);
  try {
    if (!pk) throw new Error('This passkey is not registered with this dashboard');
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: req.session.authChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: { id: pk.id, publicKey: Buffer.from(pk.publicKey, 'base64url'), counter: pk.counter, transports: pk.transports },
      requireUserVerification: false,
    });
    if (!verified) throw new Error('Passkey verification failed');
    pk.counter = authenticationInfo.newCounter;
    pk.lastUsedAt = new Date().toISOString();
    save();
    req.session.regenerate(() => {
      req.session.authed = true;
      res.json({ ok: true });
    });
  } catch (e) {
    delete req.session.authChallenge;
    res.status(401).json({ error: e.message });
  }
});
