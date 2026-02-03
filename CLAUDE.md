# GreenGale - Claude Code Reference

A markdown blog platform built on AT Protocol, compatible with WhiteWind and standard.site.

## Quick Reference

```bash
# Development
npm run dev              # Frontend (port 5173)
npm run worker:dev       # API worker (port 8787)

# Testing
npm run test             # Watch mode (re-runs on file changes)
npm run test:run         # Single run
npm run test:ui          # Browser UI for test exploration
npm run test:e2e         # Playwright E2E tests
npm run test:e2e -- --ui # E2E tests with interactive UI

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
│   ├── Agents.tsx           # /agents - AI agent integration docs
│   └── AuthCallback.tsx     # OAuth callback handler
├── lib/
│   ├── __tests__/           # Unit tests (see Testing section)
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
├── __tests__/               # Worker unit tests
├── api/index.ts             # Hono API server
├── firehose/index.ts        # Durable Object for firehose
├── schema.sql               # D1 database schema
└── migrations/              # Database migrations

lexicons/
├── app/greengale/
│   ├── blog/
│   │   ├── entry.json       # Blog entry V1 (legacy)
│   │   └── defs.json        # Shared type definitions
│   ├── document.json        # Blog document V2 (current)
│   └── publication.json     # Publication configuration
└── site/standard/
    ├── publication.json     # standard.site publication schema
    └── document.json        # standard.site document schema
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

Pipeline: Remark (GFM) → Rehype → Highlight.js → KaTeX → Sanitize → React

KaTeX math rendering is always enabled for GreenGale posts. Use `$...$` for inline math and `$$...$$` for display math.

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

**Note:** Images are supported for both GreenGale and WhiteWind formats. Images are uploaded to the user's PDS and referenced via standard markdown syntax, which works on any platform that renders markdown.

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

### Standard.site Publishing

GreenGale supports dual-publishing to the [standard.site](https://standard.site) ecosystem, enabling cross-platform blog discovery.

**How It Works:**
1. Posts are saved to `app.greengale.document` (primary format)
2. If enabled, posts are also published to `site.standard.document` (same rkey)
3. Publication metadata is similarly dual-published to both `app.greengale.publication` and `site.standard.publication`

**Configuration:**
- **Publication level**: Toggle in Author page publication settings (`enableSiteStandard`)
- **Per-post level**: Checkbox in Editor ("Publish to standard.site")
- **Default**: Enabled (opt-out)
- **Restriction**: Only public posts can be dual-published

```typescript
// Type definitions
interface SiteStandardPublication {
  url: string                    // Publication base URL
  name: string                   // Publication name
  description?: string
  basicTheme?: {
    primaryColor?: string        // Text color
    backgroundColor?: string     // Background color
    accentColor?: string         // Accent/link color
  }
  preferences?: unknown          // Platform-specific data
}

interface SiteStandardDocument {
  site: string                   // AT-URI to publication
  path?: string                  // URL path
  title: string
  description?: string           // Subtitle/excerpt
  content?: { uri: string }      // AT-URI to greengale document
  textContent?: string           // Plaintext for search
  publishedAt: string
  updatedAt?: string
}
```

**Theme Conversion:**
GreenGale themes are converted to standard.site's `basicTheme` format:
- Preset themes map to predefined colors
- Custom themes use colors directly
- Full GreenGale theme stored in `preferences.greengale` for round-trip

**Orphan Cleanup:**
The Author page includes a utility to scan for orphaned `site.standard.document` records (when the corresponding GreenGale document doesn't exist) and delete them.

**Implementation:** `src/lib/atproto.ts` (save functions, type definitions), `src/pages/Editor.tsx` (dual-publish logic), `src/pages/Author.tsx` (publication management).

### Data Fetching

```typescript
// Indexed metadata (fast, from D1)
import { getRecentPosts, getAuthorPosts } from '@/lib/appview'

// Full content (from user's PDS)
import { getBlogEntry, getAuthorProfile } from '@/lib/atproto'
```

## Testing

Unit tests use [Vitest](https://vitest.dev/) with 823 tests covering API endpoints, workers, auth flows, and core library functions.

### Running Tests

```bash
npm run test             # Watch mode - re-runs on file changes
npm run test:run         # Single run - for CI or quick verification
npm run test:ui          # Browser UI - visual test exploration
```

Run specific test file:
```bash
npm run test:run -- src/lib/__tests__/themes.test.ts
```

### Test Structure

```
src/lib/__tests__/
├── appview.test.ts            # API client with fetch mocking (31)
├── atproto.test.ts            # slugify, theme conversion, plaintext (46)
├── auth.test.tsx              # OAuth login/logout/refresh, whitelist (30)
├── bluesky.test.ts            # AT URI conversion, facet rendering (32)
├── extractHeadings.test.ts    # TOC generation, slug creation (33)
├── image-labels.test.ts       # CID extraction, content labels (60)
├── image-upload.test.ts       # File validation, blob URL generation (34)
├── markdown.test.ts           # Text extraction, title/image parsing (31)
├── rehype-heading-ids.test.ts # Heading ID generation, duplicates (55)
├── remark-bluesky-embed.test.ts # Embed detection, URL parsing (29)
├── remark-svg.test.ts         # SVG code block processing (31)
├── svg-sanitizer.test.ts      # XSS prevention, allowed elements (31)
├── themes.test.ts             # Color contrast, WCAG validation (34)
└── tts.test.ts                # Text extraction, WAV encoding, capabilities (88)

workers/__tests__/
├── api.test.ts                # All XRPC endpoints, admin auth (46)
├── firehose.test.ts           # Post indexing, cache invalidation (76)
├── og-image.test.ts           # OG generation, emoji, fonts (76)
└── theme-colors.test.ts       # OG theming, luminance calculation (60)
```

### Test Coverage by Category

| Category | Tests | Key Areas |
|----------|-------|-----------|
| API & Workers | 198 | XRPC endpoints, firehose indexing, OG images |
| Auth & Security | 61 | OAuth flow, SVG sanitization, XSS prevention |
| Theming | 94 | Color contrast, WCAG AA, presets, OG colors |
| Text Processing | 238 | Markdown, headings, TTS, rehype plugins |
| Image Handling | 94 | Validation, labels, CID extraction, uploads |
| AT Protocol | 138 | URLs, facets, embeds, API client, Bluesky |

### Writing New Tests

Tests focus on **pure functions** that don't require complex mocking:

```typescript
// src/lib/__tests__/example.test.ts
import { describe, it, expect } from 'vitest'
import { myFunction } from '../example'

describe('myFunction', () => {
  it('handles normal input', () => {
    expect(myFunction('input')).toBe('expected')
  })

  it('handles edge cases', () => {
    expect(myFunction('')).toBe('')
    expect(myFunction(null)).toBeNull()
  })
})
```

For functions requiring fetch, use `vi.stubGlobal`:

```typescript
import { vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('handles API response', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ data: 'value' }),
  })

  const result = await myApiFunction()
  expect(result.data).toBe('value')
})
```

For DOM-dependent tests, add the jsdom environment directive:

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
```

### Test Configuration

Configuration in `vitest.config.ts`:
- Default environment: `node` (fast, no DOM overhead)
- Path alias: `@` → `src/`
- Test pattern: `src/**/*.test.{ts,tsx}`, `workers/**/*.test.ts`

For React component/hook tests, use `@testing-library/react`:

```typescript
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

it('renders component', async () => {
  render(<MyComponent />)
  await waitFor(() => {
    expect(screen.getByText('Expected')).toBeInTheDocument()
  })
})
```

### E2E Tests (Playwright)

End-to-end tests use [Playwright](https://playwright.dev/) to test the full application in a real browser.

**Running E2E tests:**
```bash
npm run test:e2e           # Run all E2E tests
npm run test:e2e -- --ui   # Interactive UI mode
npm run test:e2e -- --grep "Homepage"  # Run specific tests
```

**Test structure:**
```
e2e/
├── home.spec.ts      # Homepage tests (title, posts, navigation)
├── post.spec.ts      # Post page tests (content, author, TOC)
├── author.spec.ts    # Author page tests (profile, posts)
├── auth.spec.ts      # Authentication flow tests
├── og-image.spec.ts  # OG image generation tests
└── seed.sql          # Test data for local D1 database
```

**Local setup for E2E tests:**
```bash
# Install Playwright browsers (first time only)
npx playwright install chromium

# Seed the local database with test data
npx wrangler d1 execute greengale --local --file=./workers/schema.sql
npx wrangler d1 execute greengale --local --file=./e2e/seed.sql

# Run tests (starts frontend + API worker automatically)
npm run test:e2e
```

**Configuration:** `playwright.config.ts`
- Starts both frontend (`npm run dev`) and API worker (`npm run worker:dev`)
- Uses Chromium browser
- Retries twice in CI, no retries locally
- Screenshots on failure, traces on retry

**Note:** Some tests (OG image generation) are skipped in local dev because they require the full Cloudflare environment.

### Continuous Integration

GitHub Actions runs on every push/PR to main:

| Job | Description |
|-----|-------------|
| `unit-tests` | Runs 823+ Vitest unit tests |
| `e2e-tests` | Runs Playwright E2E tests (after unit tests pass) |
| `typecheck` | TypeScript type checking |
| `build` | Production build verification |

**Workflow file:** `.github/workflows/ci.yml`

Test artifacts (Playwright report, failure screenshots) are uploaded and retained for 30 days.

## API Endpoints

Base: `https://greengale.asadegroff.workers.dev`

| Endpoint | Description |
|----------|-------------|
| `GET /xrpc/app.greengale.feed.getRecentPosts` | Recent posts feed |
| `GET /xrpc/app.greengale.feed.getAuthorPosts?author=` | Author's posts |
| `GET /xrpc/app.greengale.feed.getPost?author=&rkey=` | Single post |
| `GET /xrpc/app.greengale.actor.getProfile?author=` | Author profile |
| `GET /xrpc/app.greengale.auth.checkWhitelist?did=` | Check beta access |

**Well-known endpoints:**
| Endpoint | Description |
|----------|-------------|
| `GET /.well-known/site.standard.publication` | GreenGale platform publication AT-URI |
| `GET /.well-known/site.standard.publication?handle=` | User's publication AT-URI |
| `GET /.well-known/app.greengale.publication` | Legacy publication endpoint |

Admin endpoints require `X-Admin-Secret` header:
- `POST /xrpc/app.greengale.admin.addToWhitelist`
- `POST /xrpc/app.greengale.admin.removeFromWhitelist`
- `GET /xrpc/app.greengale.admin.listWhitelist`
- `POST /xrpc/app.greengale.admin.startFirehose`
- `POST /xrpc/app.greengale.admin.refreshAuthorProfiles` - Refresh profile data for all authors
- `POST /xrpc/app.greengale.admin.backfillFirstImageCid` - Backfill first_image_cid for existing posts
- `POST /xrpc/app.greengale.admin.backfillAuthor` - Index all posts from a specific author (body: `{"did":"..."}` or `{"handle":"..."}`)
- `POST /xrpc/app.greengale.admin.discoverWhiteWindAuthors?limit=20` - Discover and backfill WhiteWind authors from the network
- `POST /xrpc/app.greengale.admin.invalidateOGCache?handle=&rkey=` - Invalidate OG image cache
- `POST /xrpc/app.greengale.admin.invalidateRSSCache` - Invalidate RSS feed cache (body: `{"handle":"..."}` for author, or `{"type":"all"}` for all)

**RSS Feed endpoints:**
| Endpoint | Description |
|----------|-------------|
| `GET /feed/recent.xml` | Site-wide recent posts RSS feed |
| `GET /feed/:handle.xml` | Author-specific RSS feed |

### RSS Feed Cache Invalidation

RSS feeds are cached in KV for 30 minutes (`rss:recent`, `rss:author:${handle}`). The cache is automatically invalidated when:

1. **Firehose indexes a post** - Both `rss:recent` and the author's RSS feed are invalidated
2. **Firehose deletes a post** - Same as above

**Important for future development:** When adding new admin endpoints or backfill operations that create, update, or delete posts, you MUST also invalidate RSS caches:

```typescript
// After indexing/updating posts:
await Promise.all([
  c.env.CACHE.delete('recent_posts:24:'),  // Feed cache
  c.env.CACHE.delete('rss:recent'),         // RSS cache
  authorHandle ? c.env.CACHE.delete(`rss:author:${authorHandle}`) : Promise.resolve(),
])
```

**Endpoints that currently invalidate RSS caches:**
- `workers/firehose/index.ts` - Real-time post indexing and deletion
- `backfillAuthor` - Manual author backfill
- `backfillMissedPosts` - Backfill missed posts
- `discoverWhiteWindAuthors` - WhiteWind author discovery
- `reindexPost` (in refreshSinglePost) - Single post re-index
- Duplicate cleanup operations

## Database Schema

**posts**: `uri` (PK), `author_did`, `rkey`, `title`, `subtitle`, `slug`, `source`, `visibility`, `created_at`, `indexed_at`, `content_preview`, `has_latex`, `theme_preset`, `first_image_cid`, `site_uri`, `external_url`

**publications**: `did` (PK), `url`, `name`, `description`, `theme`, `enable_site_standard`, `indexed_at`

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

**Primary (V2):**
- `app.greengale.document` - GreenGale blog posts
- `app.greengale.publication` - Publication metadata

**Standard.site (dual-published):**
- `site.standard.document` - Cross-platform blog posts
- `site.standard.publication` - Cross-platform publication metadata

**Legacy/Compatibility:**
- `app.greengale.blog.entry` - GreenGale V1 posts (legacy)
- `com.whtwnd.blog.entry` - WhiteWind posts (read-only)

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
| `/agents` | AgentsPage | Public |
| `/:handle` | AuthorPage | Public |
| `/:handle/:rkey` | PostPage | Public |
| `/auth/callback` | AuthCallbackPage | Public |

## Agent Integration

GreenGale provides documentation for AI agents to publish blog posts programmatically.

**Files:**
- `public/llms.txt` - Index file following the [llms.txt standard](https://llmstxt.org/)
- `public/llms-full.txt` - Complete documentation with schema, auth, and code examples
- `src/pages/Agents.tsx` - Human-readable `/agents` page with copyable skills

**Key Information for Agents:**
- **Collection**: `app.greengale.document`
- **Record Key**: TID format (13 base32-sortable characters)
- **API**: `com.atproto.repo.putRecord` on user's PDS
- **Auth**: App password via `com.atproto.server.createSession`

**Required Fields:**
| Field | Description |
|-------|-------------|
| `content` | Markdown content (max 100K chars) |
| `title` | Post title (max 1K chars) |
| `url` | Always `https://greengale.app` |
| `path` | Format: `/{handle}/{rkey}` |
| `publishedAt` | ISO 8601 timestamp |

**Optional Fields:** `subtitle`, `visibility` (public/url/author), `tags`, `theme`

See `/llms-full.txt` for complete examples in Python and TypeScript.

## Deployment

Frontend deploys to Cloudflare Pages, API to Cloudflare Workers.

```bash
npm run deploy  # Runs: build → worker:deploy → pages:deploy
```

D1 Database ID: `81ee3700-f80c-45fc-ac0b-37b6cdcd23e3`
KV Cache ID: `fffa62967ac248d59085cc895ddd7044`
