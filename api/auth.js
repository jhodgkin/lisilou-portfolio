/**
 * Authentik OIDC authentication (issue #10).
 *
 * Authorization-code flow with PKCE for a confidential client, implemented with
 * Node.js built-ins only (fetch + crypto) — same zero-dependency approach as
 * google-calendar.js. Sessions are stateless HMAC-signed cookies.
 *
 * Env vars (all required for OIDC to activate; otherwise routes return 503 and
 * the legacy ADMIN_SECRET bearer check in server.js keeps working):
 *   OIDC_ISSUER         — e.g. "https://auth.jerodrigged.com/application/o/lisilou/"
 *   OIDC_CLIENT_ID
 *   OIDC_CLIENT_SECRET
 *   OIDC_REDIRECT_URI   — e.g. "https://lisilou.jerodrigged.com/api/auth/callback"
 *   SESSION_SECRET      — HMAC key for session cookies (any long random string)
 *   OIDC_ADMIN_GROUP    — optional, Authentik group that grants admin (default "lisilou-admin")
 *
 * Authentik setup (one-time, in the Authentik admin UI):
 *   1. Create an OAuth2/OpenID Provider (confidential client, redirect URI above).
 *   2. Create an Application "LisiLou Portfolio" bound to that provider.
 *   3. Create a group (default name "lisilou-admin") and add the photographer.
 *   4. Copy client ID/secret into api/.env on the server.
 */

'use strict';
const crypto = require('crypto');
const express = require('express');

const SESSION_COOKIE = 'lisilou_sess';
const TXN_COOKIE = 'lisilou_oidc_txn';
const SESSION_TTL_S = 8 * 60 * 60; // 8 hours
const TXN_TTL_S = 10 * 60;         // 10 minutes to complete the login round-trip

let _discoveryCache = null; // { config, fetchedAt }

function configured() {
  return Boolean(
    process.env.OIDC_ISSUER &&
    process.env.OIDC_CLIENT_ID &&
    process.env.OIDC_CLIENT_SECRET &&
    process.env.OIDC_REDIRECT_URI &&
    process.env.SESSION_SECRET
  );
}

// ── Cookie signing ────────────────────────────────────────────────────────────

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function sign(payloadObj) {
  const payload = b64url(JSON.stringify(payloadObj));
  const mac = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest();
  return `${payload}.${b64url(mac)}`;
}

function verify(token) {
  if (!token || !process.env.SESSION_SECRET) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const mac = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest();
  const expected = b64url(mac);
  const given = token.slice(dot + 1);
  if (expected.length !== given.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return null;
  try {
    const obj = JSON.parse(b64urlDecode(payload));
    if (!obj.exp || obj.exp < Math.floor(Date.now() / 1000)) return null;
    return obj;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function isSecureDeployment() {
  return (process.env.OIDC_REDIRECT_URI || '').startsWith('https://');
}

function cookieAttrs(maxAgeS) {
  const secure = isSecureDeployment() ? '; Secure' : '';
  return `; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure}`;
}

function setCookie(res, name, value, maxAgeS) {
  const prev = res.getHeader('Set-Cookie');
  const cookie = `${name}=${encodeURIComponent(value)}${cookieAttrs(maxAgeS)}`;
  res.setHeader('Set-Cookie', prev ? [].concat(prev, cookie) : cookie);
}

function clearCookie(res, name) {
  setCookie(res, name, '', 0);
}

// ── Session access (used by server.js middleware) ─────────────────────────────

function getSession(req) {
  return verify(parseCookies(req)[SESSION_COOKIE]);
}

// ── OIDC provider discovery ───────────────────────────────────────────────────

async function discover() {
  if (_discoveryCache && Date.now() - _discoveryCache.fetchedAt < 60 * 60 * 1000) {
    return _discoveryCache.config;
  }
  const issuer = process.env.OIDC_ISSUER.replace(/\/$/, '');
  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  const config = await res.json();
  _discoveryCache = { config, fetchedAt: Date.now() };
  return config;
}

// ── Routes ────────────────────────────────────────────────────────────────────

const router = express.Router();

// Begin login. ?redirect=/dashboard controls where the user lands afterwards.
router.get('/api/auth/login', async (req, res) => {
  if (!configured()) return res.status(503).json({ error: 'SSO not configured' });
  try {
    const config = await discover();
    const state = b64url(crypto.randomBytes(24));
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    // Only allow same-site relative redirect targets
    const redirect = (req.query.redirect || '/').startsWith('/') && !String(req.query.redirect || '/').startsWith('//')
      ? (req.query.redirect || '/') : '/';

    setCookie(res, TXN_COOKIE, sign({
      state, verifier, redirect,
      exp: Math.floor(Date.now() / 1000) + TXN_TTL_S,
    }), TXN_TTL_S);

    const url = new URL(config.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', process.env.OIDC_CLIENT_ID);
    url.searchParams.set('redirect_uri', process.env.OIDC_REDIRECT_URI);
    url.searchParams.set('scope', 'openid profile email');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    res.redirect(url.toString());
  } catch (err) {
    console.error('[auth] login failed:', err.message);
    res.status(502).json({ error: 'SSO provider unavailable' });
  }
});

router.get('/api/auth/callback', async (req, res) => {
  if (!configured()) return res.status(503).json({ error: 'SSO not configured' });
  const txn = verify(parseCookies(req)[TXN_COOKIE]);
  clearCookie(res, TXN_COOKIE);
  if (!txn || !req.query.code || req.query.state !== txn.state) {
    return res.status(400).send('Login session expired or invalid. <a href="/api/auth/login">Try again</a>.');
  }
  try {
    const config = await discover();
    const tokenRes = await fetch(config.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: req.query.code,
        redirect_uri: process.env.OIDC_REDIRECT_URI,
        client_id: process.env.OIDC_CLIENT_ID,
        client_secret: process.env.OIDC_CLIENT_SECRET,
        code_verifier: txn.verifier,
      }),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      throw new Error(`token exchange failed: ${tokenRes.status} ${body.slice(0, 200)}`);
    }
    const tokens = await tokenRes.json();

    // Claims come from the userinfo endpoint over TLS directly from the issuer,
    // so a local JWT signature check is not required for this trust model.
    const uiRes = await fetch(config.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!uiRes.ok) throw new Error(`userinfo failed: ${uiRes.status}`);
    const claims = await uiRes.json();

    const adminGroup = process.env.OIDC_ADMIN_GROUP || 'lisilou-admin';
    const groups = Array.isArray(claims.groups) ? claims.groups : [];

    setCookie(res, SESSION_COOKIE, sign({
      sub: claims.sub,
      email: claims.email || null,
      name: claims.name || claims.preferred_username || null,
      admin: groups.includes(adminGroup),
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S,
    }), SESSION_TTL_S);

    res.redirect(txn.redirect || '/');
  } catch (err) {
    console.error('[auth] callback failed:', err.message);
    res.status(502).send('Login failed. <a href="/api/auth/login">Try again</a>.');
  }
});

router.post('/api/auth/logout', (req, res) => {
  clearCookie(res, SESSION_COOKIE);
  res.json({ ok: true });
});

// Session probe for the frontend
router.get('/api/auth/me', (req, res) => {
  const session = getSession(req);
  if (!session) return res.json({ authenticated: false, ssoConfigured: configured() });
  res.json({
    authenticated: true,
    ssoConfigured: true,
    sub: session.sub,
    email: session.email,
    name: session.name,
    admin: Boolean(session.admin),
  });
});

module.exports = { router, getSession, configured };
