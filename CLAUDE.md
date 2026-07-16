# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

LisiLou Photography Portfolio — a photography booking and portfolio site for Elysse Hodgkin.
Built as a zero-framework SPA with a Node.js/Express booking API, deployed on a homelab Proxmox cluster.

**Live dev URL:** http://192.168.1.192:8080 (CT114, lisilou-dev LXC)
**Production URL:** https://lisilou.jerodrigged.com (CT111 via Cloudflare tunnel → NPM CT102)
**Gitea repo:** https://git.jerodrigged.com/jhodgkin/lisilou-portfolio (deploys dev, CT114)
**GitHub mirror:** https://github.com/jhodgkin/lisilou-portfolio (deploys prod, CT111 — push here too or prod drifts!)

## Technology Stack

| Layer | Tech |
|-------|------|
| Frontend | Vanilla HTML5/CSS3/JS (no framework), single file |
| Portfolio server | Nginx Alpine |
| Booking API | Node.js 20 / Express / better-sqlite3 |
| Deployment | Docker Compose (two services: `portfolio` + `api`) |
| CI/CD | Gitea Actions → CT114 (dev); GitHub Actions → CT111 (prod) on push to `main` |
| Image hosting | Immich (immich.jerodrigged.com) |

## Development Commands

```bash
# Start full stack locally (portfolio on :8080, API on :3001 internally)
docker compose up -d

# Rebuild after changes to src/index.html or api/
docker compose build && docker compose up -d

# API logs only
docker logs lisilou-api

# Run smoke tests against dev LXC
bash scripts/smoke-test.sh http://192.168.1.192:8080
```

**Volume-mounted (no rebuild needed):**
- `config/` — site content and booking config
- `public/images/` — portfolio and location photos
- `api/data/` — SQLite database
- `api/signed-contracts/` — completed contract PDFs

## Architecture

### Two-Service Docker Compose

```
Browser → Nginx (:8080)
              ├── /          → src/index.html (SPA)
              ├── /config/   → config/ volume (5-min cache)
              ├── /images/   → public/images/ volume (1-year cache)
              ├── /api/      → proxy → api:3001 (Node.js)
              └── /health    → 200 OK
```

### Single-File SPA (`src/index.html`, ~1800 lines)
- Lines 1–900: Inline CSS with CSS custom properties for theming
- Lines 900+: HTML structure and vanilla JavaScript
- Booking modal is a 7-step wizard rendered entirely in this file

### Configuration-Driven Content (`config/site.json`)

All content is loaded at runtime — no rebuild needed:

```
site.json
├── site         — title, tagline, logo, favicon, heroImage (optional hero photo)
├── photographer — name, bio, profile image
├── contact      — email, phone
├── social       — instagram, facebook, etc.
├── immich       — baseUrl, publicAlbumPrefix
├── portfolio    — categories with immichAlbumId
├── clientAccess — enable/disable client gallery login
├── locations[]  — location picker cards (see below)
├── booking      — sessionTypes[], pricing {mini, full}, venmoUsername
└── theme        — colors, fonts
```

### Booking API (`api/`)

Express app at port 3001 with SQLite (`api/data/bookings.db`).

```
api/
├── server.js       — Express app (routes, CORS, JSON middleware)
├── db.js           — SQLite init; creates bookings table on first run
├── package.json
├── package-lock.json  ← committed; required for npm ci in Docker
├── Dockerfile
├── .env            ← gitignored; copy from .env.example
└── .env.example    ← committed template
```

**Bookings table columns:** `id`, `created_at`, `client_name`, `client_email`,
`client_phone`, `client_sub` (OIDC), `session_date`, `session_type`,
`session_length`, `location`, `contract_signed_at`, `contract_pdf_path`,
`payment_status`, `payment_notified_at`, `status`, `notes`

**API env vars** (set in `api/.env` on the server, never committed):
```
PORT=3001
CORS_ORIGIN=http://localhost:8080
N8N_WEBHOOK_URL=
GOOGLE_CALENDAR_ID=
GOOGLE_SERVICE_ACCOUNT_JSON=
SESSION_SECRET=
OIDC_ISSUER=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_REDIRECT_URI=
```

### Location Photos

Drop images into `public/images/locations/<location-id>/` on the server.
No rebuild needed — nginx serves the volume directly with 1-year caching.

```
public/images/locations/
├── river-bottoms/   hero.jpg, 1.jpg, 2.jpg
├── city-park/       hero.jpg, 1.jpg, 2.jpg
├── downtown/        hero.jpg, 1.jpg, 2.jpg
└── studio/          hero.jpg, 1.jpg, 2.jpg
```

Missing images fall back to a styled placeholder — safe to deploy before photos are ready.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.html` | Complete SPA — CSS + HTML + booking wizard JS |
| `config/site.json` | All runtime content: portfolio, booking, locations, theme |
| `config/profiles.json` | Multi-tenant domain → config file routing |
| `nginx.conf` | Proxy rules, caching, security headers, SPA fallback |
| `Dockerfile` | Portfolio image (Node Alpine → Nginx Alpine, multi-stage) |
| `api/Dockerfile` | API image (Node 20 Alpine + build tools for native deps) |
| `docker-compose.yml` | Both services, volumes, healthchecks |
| `.gitea/workflows/deploy.yml` | Push-to-main → SSH deploy → smoke tests |
| `scripts/smoke-test.sh` | 6 curl assertions; exits non-zero on failure |

## CI/CD — Trunk-Based Development

Every push to `main`:
1. Gitea runner (CT117) SSHes into CT114 (dev LXC at 192.168.1.192)
2. `git fetch origin && git reset --hard origin/main` — robust, never fails on drift
3. `docker compose build && docker compose up -d`
4. Health check loop (24 × 5s attempts)
5. `bash scripts/smoke-test.sh` — 6 tests; pipeline fails if any fail

**Gitea secrets required:** `DEV_SSH_KEY`, `DEV_HOST`, `DEV_USER`

## Booking Wizard — Implementation Status

| Step | Feature | Issue | Status |
|------|---------|-------|--------|
| 1 | Date picker | #3 | Done — Google Calendar busy dates (graceful when unconfigured) |
| 2 | Session type | #4 | Done — config-driven from `sessionTypes[]` |
| 3 | Session length | #4 | Done — mini/full with pricing from config |
| 4 | Location picker | #5 | Done — photo cards with detail expand panel |
| 5 | Contract e-signature | #6 | Done — PDF.js viewer + canvas pad; needs `api/contracts/model-release.pdf` on volume |
| 6 | Venmo payment | #7 | Done — deep link + server-generated QR |
| 7 | Confirm & submit | — | Done — summary + POST /api/bookings |

Also done: n8n webhooks (#8), admin dashboard at `/dashboard` (#11), Authentik OIDC
login (#10, needs Authentik-side setup), client portal at `/my-bookings` (#13).
Auth lives in `api/auth.js` (zero-dep OIDC + HMAC cookie sessions); admin routes
accept an OIDC admin session or the legacy `ADMIN_SECRET` bearer.

### Booking JS Functions (in `src/index.html`)

| Function | Purpose |
|----------|---------|
| `openBooking()` | Reset state, render all cards, show modal |
| `closeBooking()` | Hide modal, restore scroll |
| `goToStep(n)` | Activate step panel, update step bar |
| `renderSessionTypeCards()` | Builds step 2 from `siteConfig.booking.sessionTypes` |
| `renderSessionLengthCards()` | Builds step 3 with pricing from `siteConfig.booking.pricing` |
| `renderLocationCards()` | Builds step 4 from `siteConfig.locations` |
| `selectOption(card, field)` | Generic card select; handles "other" field show/hide |
| `selectLocation(id)` | Location card select + toggle detail panel |
| `validateStep(step)` | Returns bool; validates "other" text on step 2 |
| `populateSummary()` | Fills step 7 confirm rows from bookingState + config labels |
| `submitBooking()` | POST /api/bookings; shows success state |

## Pending Work

All original wizard issues (#3–#13) are code-complete. Remaining items — mostly
infrastructure setup, secrets, and content — are catalogued in
`docs/BACKLOG-2026-07-16.md` and should be transferred to Gitea issues.

Issues are tracked at: https://git.jerodrigged.com/jhodgkin/homelab/issues
