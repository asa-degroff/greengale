# GreenGale - Claude Code Reference

A markdown blog platform built on AT Protocol, compatible with WhiteWind.

## Quick Reference

```bash
# Development
npm run dev              # Frontend (port 5173)
npm run worker:dev       # API worker (port 8787)

# Deployment
npm run deploy           # Full deploy (build + worker + pages)

# Database
npm run db:migrate       # Run migrations on remote D1
npm run db:migrate:local # Run migrations locally
```

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  React Frontend │────▶│ Cloudflare Worker│────▶│   D1 Database   │
│  (Pages)        │     │ (Hono API)       │     │   (SQLite)      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │ AT Protocol      │
                        │ (PDS + Firehose) │
                        └──────────────────┘
```

**Data Flow:**
- Posts stored in users' Personal Data Servers (PDS) via AT Protocol
- Firehose consumer indexes post metadata to D1 for fast queries
- Full post content fetched directly from PDS when viewing

## Project Structure

```
src/
├── components/
│   ├── Sidebar.tsx          # Navigation, auth UI, theme toggle
│   ├── BlogViewer.tsx       # Full post display
│   ├── BlogCard.tsx         # Post card for listings
│   ├── MarkdownRenderer.tsx # Markdown to React
│   └── AuthorCard.tsx       # Author profile display
├── pages/
│   ├── Home.tsx             # Recent posts feed
│   ├── Author.tsx           # /:handle - author's posts
│   ├── Post.tsx             # /:handle/:rkey - single post
│   ├── Editor.tsx           # /new, /edit/:rkey - post creation
│   └── AuthCallback.tsx     # OAuth callback handler
├── lib/
│   ├── atproto.ts           # AT Protocol client, PDS fetching
│   ├── appview.ts           # Indexed data API client
│   ├── auth.tsx             # OAuth context (useAuth hook)
│   ├── markdown.ts          # Markdown processing pipeline
│   ├── remark-svg.ts        # Remark plugin for SVG code blocks
│   ├── svg-sanitizer.ts     # SVG sanitization for security
│   ├── themes.ts            # Theme presets and utilities
│   ├── useDarkMode.ts       # Site light/dark mode hook
│   └── useThemePreference.tsx # Post theme override context
├── App.tsx                  # Router + providers
└── index.css                # Global styles + theme CSS vars

workers/
├── api/index.ts             # Hono API server
├── firehose/index.ts        # Durable Object for firehose
├── schema.sql               # D1 database schema
└── migrations/              # Database migrations

lexicons/app/greengale/blog/
├── entry.json               # Blog entry record schema
└── defs.json                # Shared type definitions
```

## Key Systems

### Authentication

OAuth 2.0 via AT Protocol. Access levels:
- **Public**: View posts and author pages
- **Authenticated**: Sign in with Bluesky handle
- **Whitelisted**: Can create/edit posts (beta access control)

```typescript
// Usage in components
const { isAuthenticated, isWhitelisted, session, handle } = useAuth()
```

### Theme System

Two-level theming:
1. **Site theme**: Light/dark mode (`data-site-theme` on `<html>`)
2. **Post theme**: Per-post presets (`data-active-theme` on `<html>`)

Presets: `default`, `github-light`, `github-dark`, `dracula`, `nord`, `solarized-light`, `solarized-dark`, `monokai`

```typescript
// Apply post theme globally
const { setActivePostTheme, forceDefaultTheme } = useThemePreference()
```

CSS variables: `--site-*` for site UI, `--theme-*` for post content.

### Markdown Processing

Pipeline: Remark (GFM) → Rehype → Highlight.js → KaTeX (optional) → Sanitize → React

```typescript
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
<MarkdownRenderer content={markdown} enableLatex={true} />
```

### Inline SVG

Blog posts support inline SVG diagrams via fenced code blocks with the `svg` language:

````markdown
```svg
<svg viewBox="0 0 100 100" width="200" height="200">
  <circle cx="50" cy="50" r="40" fill="#3b82f6"/>
  <text x="50" y="55" text-anchor="middle" fill="white">Hello</text>
</svg>
```
````

**Supported SVG elements:** Basic shapes (circle, rect, path, line, polygon, polyline, ellipse), text (text, tspan, textPath), gradients (linearGradient, radialGradient, stop), patterns, filters, clipPath, mask, markers, defs, g, use, symbol.

**Security:** SVGs are sanitized before rendering. Blocked: script tags, event handlers (onclick, etc.), external references (only `#id` hrefs allowed), dangerous CSS patterns (url(), expression(), etc.). Size limit: 100KB.

**Implementation:** `src/lib/remark-svg.ts` (remark plugin), `src/lib/svg-sanitizer.ts` (sanitization).

### Data Fetching

```typescript
// Indexed metadata (fast, from D1)
import { getRecentPosts, getAuthorPosts } from '@/lib/appview'

// Full content (from user's PDS)
import { getBlogEntry, getAuthorProfile } from '@/lib/atproto'
```

## API Endpoints

Base: `https://greengale.asadegroff.workers.dev`

| Endpoint | Description |
|----------|-------------|
| `GET /xrpc/app.greengale.feed.getRecentPosts` | Recent posts feed |
| `GET /xrpc/app.greengale.feed.getAuthorPosts?author=` | Author's posts |
| `GET /xrpc/app.greengale.feed.getPost?author=&rkey=` | Single post |
| `GET /xrpc/app.greengale.actor.getProfile?author=` | Author profile |
| `GET /xrpc/app.greengale.auth.checkWhitelist?did=` | Check beta access |

Admin endpoints require `X-Admin-Secret` header:
- `POST /xrpc/app.greengale.admin.addToWhitelist`
- `POST /xrpc/app.greengale.admin.removeFromWhitelist`
- `GET /xrpc/app.greengale.admin.listWhitelist`
- `POST /xrpc/app.greengale.admin.startFirehose`

## Database Schema

**posts**: `uri` (PK), `author_did`, `rkey`, `title`, `subtitle`, `source`, `visibility`, `created_at`, `indexed_at`, `content_preview`, `has_latex`, `theme_preset`

**authors**: `did` (PK), `handle`, `display_name`, `description`, `avatar_url`, `pds_endpoint`, `posts_count`

**whitelist**: `did` (PK), `handle`, `added_at`, `added_by`, `notes`

**sync_state**: Firehose cursor position

## Environment Variables

```toml
# wrangler.toml
[vars]
RELAY_URL = "wss://bsky.network"

# Set via wrangler secret
ADMIN_SECRET = "..."
```

```env
# .env (frontend)
VITE_APPVIEW_URL=http://localhost:8787  # dev
VITE_APPVIEW_URL=https://greengale.asadegroff.workers.dev  # prod
```

## Collections

- `app.greengale.blog.entry` - GreenGale posts
- `com.whtwnd.blog.entry` - WhiteWind posts (read-only compatibility)

## Common Tasks

### Add user to whitelist
```bash
curl -X POST "https://greengale.asadegroff.workers.dev/xrpc/app.greengale.admin.addToWhitelist" \
  -H "X-Admin-Secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"did": "did:plc:...", "handle": "user.bsky.social"}'
```

### Trigger firehose indexing
```bash
curl -X POST "https://greengale.asadegroff.workers.dev/xrpc/app.greengale.admin.startFirehose" \
  -H "X-Admin-Secret: $ADMIN_SECRET"
```

### Run database migrations
```bash
npm run db:migrate
```

## Routes

| Path | Component | Access |
|------|-----------|--------|
| `/` | HomePage | Public |
| `/new` | EditorPage | Whitelisted |
| `/edit/:rkey` | EditorPage | Whitelisted |
| `/:handle` | AuthorPage | Public |
| `/:handle/:rkey` | PostPage | Public |
| `/auth/callback` | AuthCallbackPage | Public |

## Deployment

Frontend deploys to Cloudflare Pages, API to Cloudflare Workers.

```bash
npm run deploy  # Runs: build → worker:deploy → pages:deploy
```

D1 Database ID: `81ee3700-f80c-45fc-ac0b-37b6cdcd23e3`
KV Cache ID: `fffa62967ac248d59085cc895ddd7044`
