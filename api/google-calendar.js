/**
 * Google Calendar availability helper.
 *
 * Uses a service account JWT (no external npm deps — only Node.js built-in crypto).
 * Env vars required:
 *   GOOGLE_CALENDAR_ID          — e.g. "abc123@group.calendar.google.com"
 *   GOOGLE_SERVICE_ACCOUNT_JSON — full service account key JSON as a single-line string
 *   GOOGLE_TIMEZONE             — optional, defaults to "America/Denver"
 *
 * Setup (one-time):
 *   1. Enable Calendar API in Google Cloud Console.
 *   2. Create a service account; download the JSON key.
 *   3. Share the target calendar with the service account's client_email (View permission).
 *   4. Set GOOGLE_CALENDAR_ID to the calendar's ID (found in Calendar Settings → Integrate).
 *   5. Set GOOGLE_SERVICE_ACCOUNT_JSON to the contents of the JSON key file.
 */

'use strict';
const crypto = require('crypto');

// ── Simple in-memory cache ────────────────────────────────────────────────────

let _tokenCache = null; // { token, expiresAt }
const _busyCache = new Map(); // "YYYY-MM" → { dates: Set, fetchedAt }
const BUSY_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── JWT / OAuth ───────────────────────────────────────────────────────────────

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getAccessToken() {
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 60_000) {
    return _tokenCache.token;
  }

  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);

  const header  = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = b64url(Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })));

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = b64url(sign.sign(sa.private_key));

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${header}.${payload}.${sig}`,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google OAuth failed: ${res.status} ${err}`);
  }

  const { access_token, expires_in } = await res.json();
  _tokenCache = { token: access_token, expiresAt: Date.now() + expires_in * 1000 };
  return access_token;
}

// ── Busy-date fetcher ─────────────────────────────────────────────────────────

/**
 * Returns busy dates for the given month.
 * @param {number} year   — e.g. 2026
 * @param {number} month  — 1-based, e.g. 7 for July
 * @returns {{ busy: string[], configured: boolean }}
 */
async function getBusyDates(year, month) {
  const calId = process.env.GOOGLE_CALENDAR_ID;
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!calId || !saJson) {
    return { busy: [], configured: false };
  }

  const cacheKey = `${year}-${String(month).padStart(2, '0')}`;
  const cached = _busyCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < BUSY_TTL_MS) {
    return { busy: [...cached.dates], configured: true };
  }

  const tz = process.env.GOOGLE_TIMEZONE || 'America/Denver';
  // Full month window: first moment of the month → first moment of next month
  const timeMin = new Date(year, month - 1, 1).toISOString();
  const timeMax = new Date(year, month, 1).toISOString();

  const token = await getAccessToken();
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin, timeMax, timeZone: tz, items: [{ id: calId }] }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Calendar freeBusy failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  const busyRanges = data.calendars?.[calId]?.busy ?? [];

  // Expand each busy range into individual YYYY-MM-DD strings
  const busyDates = new Set();
  for (const { start, end } of busyRanges) {
    let d = new Date(start);
    const e = new Date(end);
    while (d < e) {
      busyDates.add(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }

  _busyCache.set(cacheKey, { dates: busyDates, fetchedAt: Date.now() });
  return { busy: [...busyDates], configured: true };
}

module.exports = { getBusyDates };
