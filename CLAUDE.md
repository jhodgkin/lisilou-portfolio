# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LisiLou Photography Portfolio is a lightweight, zero-framework photography portfolio website designed to integrate with Immich for image hosting and client gallery access. It's a single-page application with all code in one HTML file, using vanilla JavaScript and inline CSS.

## Technology Stack

- **Frontend:** Vanilla HTML5, CSS3, JavaScript (no framework)
- **Server:** Nginx (Alpine-based)
- **Deployment:** Docker + Docker Compose
- **CI/CD:** Gitea Actions

## Development Commands

```bash
# Start development server (serves at http://localhost:8080)
docker compose up -d

# Rebuild after code changes to src/index.html
docker compose build && docker compose up -d

# View container logs
docker logs lisilou-portfolio
```

**Note:** Configuration (`config/`) and image (`public/images/`) changes are applied immediately without rebuild since they're mounted as volumes.

## Architecture

### Single-File SPA
The entire application lives in `src/index.html` (~865 lines):
- Lines 1-605: Inline CSS with CSS custom properties for theming
- Lines 606-865: HTML structure and vanilla JavaScript

### Configuration-Driven Content
All site content is loaded dynamically from `config/site.json` at runtime:
- Site branding (title, tagline, logo)
- Theme colors (applied to CSS variables)
- Portfolio categories with Immich album links
- Social media links
- Client gallery access settings

### Immich Integration
The app serves as a gateway to Immich shared albums:
- Portfolio categories link to Immich albums via `immichAlbumId`
- Client gallery codes are Immich share IDs
- Full URLs constructed as: `{baseUrl}{publicAlbumPrefix}{albumId}`

### Multi-Tenant Support
Multiple photographers can be supported via `config/profiles.json`, mapping domains to different configuration files.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.html` | Complete SPA (CSS + HTML + JS) |
| `config/site.json` | Runtime configuration for all content |
| `config/profiles.json` | Multi-tenant profile routing |
| `nginx.conf` | Caching rules, security headers, SPA routing |
| `Dockerfile` | Multi-stage build (Node Alpine → Nginx Alpine) |
| `.gitea/workflows/deploy.yml` | CI/CD pipeline |

## Nginx Configuration Highlights

- **Caching:** Images = 1 year, CSS/JS = 1 month, Config = 5 minutes
- **Health Check:** `/health` endpoint for container monitoring
- **SPA Routing:** Falls back to `index.html` for all unmatched routes
- **Security Headers:** X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy
