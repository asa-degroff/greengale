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
│   ├── AuthorCard.tsx       # Author profile display
│   ├── ImageWithAlt.tsx     # Image display with alt text badge
│   ├── ContentWarningImage.tsx # Blurred preview for sensitive images
│   ├── ImageLightbox.tsx    # Full-screen image viewer
│   ├── ImageMetadataEditor.tsx # Alt text and content label editor
│   └── AudioPlayer.tsx      # TTS playback controls
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
│   ├── useThemePreference.tsx # Post theme override context
│   ├── image-upload.ts      # Image processing and PDS upload
│   ├── image-labels.ts      # Alt text and content label utilities
│   ├── tts.ts               # TTS types, text extraction, utilities
│   ├── tts.worker.ts        # Web Worker for Kokoro TTS model
│   └── useTTS.ts            # React hook for TTS playback
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

Blog posts support inline SVG diagrams via fenced code blocks with the `svg`, `xml`, or `html` language (content must start with `<svg`):

````markdown
```svg
<svg viewBox="0 0 100 100" width="200" height="200">
  <circle cx="50" cy="50" r="40" fill="#3b82f6"/>
  <text x="50" y="55" text-anchor="middle" fill="white">Hello</text>
</svg>
```
````

**Supported SVG elements:** Basic shapes (circle, rect, path, line, polygon, polyline, ellipse), text (text, tspan, textPath), gradients (linearGradient, radialGradient, stop), patterns, filters, clipPath, mask, markers, defs, g, use, symbol, style (with CSS sanitization).

**Security:** SVGs are sanitized before rendering. Blocked: script tags, event handlers (onclick, etc.), external references (only `#id` hrefs allowed), dangerous CSS patterns (url(), expression(), etc.). Size limit: 100KB.

**Implementation:** `src/lib/remark-svg.ts` (remark plugin), `src/lib/svg-sanitizer.ts` (sanitization).

### Image Uploads

Blog posts support embedded images via drag-and-drop in the editor. Images are stored in the user's PDS as blobs.

**Upload Pipeline:**
1. **Validation** - Supported formats: JPEG, PNG, GIF, WebP, AVIF, BMP (max 50MB input)
2. **Resize** - Images resized to max 4096×4096 preserving aspect ratio
3. **Encode** - Converted to AVIF format with dynamic quality (target <900KB for AT Protocol's 1MB limit)
4. **Upload** - Blob uploaded to user's PDS via `com.atproto.repo.uploadBlob`

```typescript
// Upload result structure
interface UploadedBlob {
  cid: string           // Content identifier
  mimeType: string      // "image/avif"
  size: number          // Final size in bytes
  name: string          // Original filename
  alt?: string          // Accessibility text (max 1000 chars)
  labels?: SelfLabels   // Content warnings
  blobRef: BlobRef      // AT Protocol reference
}
```

**Alt Text:** Click any uploaded image in the "Uploaded Images" panel to open the metadata editor. Images display an "ALT" badge when viewed; clicking reveals the full description.

**Content Warnings:** Four self-label types available:
- `nudity` - Non-sexual nudity (artistic, educational)
- `sexual` - Sexually suggestive content
- `porn` - Explicit content (18+)
- `graphic-media` - Violence, gore, disturbing imagery

Labeled images display blurred with a warning overlay until the user acknowledges.

**Limitation:** Image uploads only work with GreenGale format posts (not WhiteWind compatibility mode).

**Implementation:** `src/lib/image-upload.ts` (processing), `src/lib/image-labels.ts` (utilities), `src/components/ImageMetadataEditor.tsx` (editor UI).

### Text-to-Speech (TTS)

Blog posts can be read aloud using the Kokoro TTS model running entirely in the browser via WebGPU or WebAssembly.

**Features:**
- **Streaming playback**: Audio generates sentence-by-sentence with buffering for smooth playback
- **Sentence highlighting**: Current sentence is highlighted in the post content
- **Seek support**: Click any paragraph to jump to that position
- **Speed control**: Playback rates from 0.5x to 2x with pitch preservation
- **Offline capable**: Model cached in IndexedDB after first download

**Architecture:**
```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  useTTS     │────▶│  tts.worker.ts   │────▶│  Kokoro TTS     │
│  (React)    │     │  (Web Worker)    │     │  (ONNX model)   │
└─────────────┘     └──────────────────┘     └─────────────────┘
      │                     │
      ▼                     ▼
┌─────────────┐     ┌──────────────────┐
│ AudioPlayer │     │  Audio chunks    │
│ (UI)        │     │  (Float32Array)  │
└─────────────┘     └──────────────────┘
```

**Device Selection:**
- **macOS**: WebGPU enabled by default (GPU acceleration, ~326 MB model)
- **Other platforms**: WebAssembly with quantized model (~92 MB model)
- **Manual override**: `localStorage.setItem('tts-force-webgpu', 'true')`

**Text Processing:**
1. Markdown stripped (code blocks, LaTeX removed)
2. Images with alt text read as "Image: {alt text}"
3. Split into sentences for streaming
4. Parentheses converted to commas for natural pauses
5. List items get trailing periods for sentence boundaries

```typescript
// Usage in components
const tts = useTTS()
await tts.start(markdownContent)  // Begin playback
tts.pause() / tts.resume()        // Control playback
tts.seek(sentenceText)            // Jump to sentence
tts.setPlaybackRate(1.5)          // Change speed
tts.stop()                        // Stop and cleanup
```

**Model:** `onnx-community/Kokoro-82M-v1.0-ONNX` via Hugging Face Transformers.js

**Known Issue:** WebGPU produces garbled audio on some Linux configurations. Tracked in [transformers.js#1320](https://github.com/huggingface/transformers.js/issues/1320).

**Implementation:** `src/lib/tts.ts` (types/utilities), `src/lib/tts.worker.ts` (Web Worker), `src/lib/useTTS.ts` (React hook), `src/components/AudioPlayer.tsx` (UI).

### OpenGraph Images

Dynamic OG images are generated for posts, profiles, and the homepage using `workers-og` (Satori + resvg-wasm).

**Features:**
- **Post OG images**: Display title, subtitle, author info, theme colors, and optional thumbnail
- **Thumbnail support**: Posts with images show a 280×280 thumbnail on the right side
- **Theme-aware**: OG images reflect the post's color theme (preset or custom)
- **Multi-language**: Automatic font fallback for CJK, Arabic, Hebrew, Cyrillic, etc.

**Thumbnail Pipeline:**
1. First image CID extracted from `blobs` array during firehose indexing
2. Images with content labels (`nudity`, `sexual`, `porn`, `graphic-media`) are skipped
3. At generation time, image fetched via wsrv.nl proxy (converts AVIF→JPEG for Satori compatibility)
4. Embedded as base64 data URL in the OG image

**Endpoints:**
- `GET /og/site.png` - Homepage OG image
- `GET /og/profile/:handle.png` - Author profile OG image
- `GET /og/:handle/:rkey.png` - Post OG image (with optional thumbnail)

**Caching:** OG images cached in KV for 7 days, invalidated on post update.

**Implementation:** `workers/lib/og-image.ts` (generation), `workers/lib/theme-colors.ts` (theming).

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
- `POST /xrpc/app.greengale.admin.refreshAuthorProfiles` - Refresh profile data for all authors
- `POST /xrpc/app.greengale.admin.backfillFirstImageCid` - Backfill first_image_cid for existing posts
- `POST /xrpc/app.greengale.admin.invalidateOGCache?handle=&rkey=` - Invalidate OG image cache

## Database Schema

**posts**: `uri` (PK), `author_did`, `rkey`, `title`, `subtitle`, `slug`, `source`, `visibility`, `created_at`, `indexed_at`, `content_preview`, `has_latex`, `theme_preset`, `first_image_cid`

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
