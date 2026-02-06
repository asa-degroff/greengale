# GreenGale

A markdown blog platform built on [AT Protocol](https://atproto.com). Compatible with [WhiteWind](https://whtwnd.com) and powered by your Internet handle.

**Live at [greengale.app](https://greengale.app)**

## Features

- **WhiteWind Compatible** - View and create WhiteWind blog posts without any migration needed
- **Theme Selection** - Choose from preset themes (GitHub Light/Dark, Dracula, Nord, Solarized, Monokai) applied per-post
- **Custom Color Themes** - Create your own color scheme with automatic contrast validation and derived colors
- **KaTeX Support** - Write mathematical equations with full LaTeX rendering
- **Inline SVG Diagrams** - Embed sanitized SVG graphics directly in posts using fenced code blocks
- **Image Uploads** - Drag-and-drop images with automatic AVIF conversion, alt text support, and content warnings
- **Standard.site Compatible** - Dual-publish posts to the [standard.site](https://standard.site) ecosystem for cross-platform discovery
- **Text-to-Speech** - Listen to posts read aloud using the Kokoro TTS model running entirely in browser
- **Dynamic OG Images** - Auto-generated Open Graph images with post thumbnails and theme colors
- **Visibility Controls** - Public, unlisted (URL only), or private (author only) posts
- **OAuth Authentication** - Sign in with your AT Protocol identity via OAuth
- **Real-time Indexing** - Firehose consumer indexes posts from across the network

## Architecture

### Frontend

React SPA built with Vite, deployed to Cloudflare Pages.

- **Framework**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS with CSS custom properties for theming
- **Markdown**: unified/remark/rehype pipeline with GFM, syntax highlighting, and KaTeX
- **Auth**: `@atproto/oauth-client-browser` for AT Protocol OAuth

### Backend

Cloudflare Workers with D1 (SQLite) database and KV caching.

- **API**: Hono framework serving XRPC-style endpoints
- **Database**: Cloudflare D1 for indexed posts and author profiles
- **Cache**: Cloudflare KV with 30-minute TTL for recent posts feed
- **Firehose**: Durable Object consuming AT Protocol firehose for real-time indexing

### Data Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│  AT Protocol    │───▶│  Firehose DO     │───▶│  D1 Database │
│  Firehose       │     │  (indexer)       │     │  (posts,     │
└─────────────────┘     └──────────────────┘     │   authors)   │
                                                 └──────┬──────┘
                                                         │
┌─────────────────┐     ┌──────────────────┐             │
│  React Frontend │◀─▶│  API Worker      │◀───────────┘
│  (greengale.app)│     │  + KV Cache      │
└─────────────────┘     └──────────────────┘
```

Posts are also read directly from user PDSes for full content (the index stores metadata only).

## Project Structure

```
greengale/
├── src/                    # Frontend React app
│   ├── components/         # React components
│   │   ├── Sidebar.tsx     # Navigation sidebar
│   │   ├── BlogViewer.tsx  # Post display component
│   │   ├── BlogCard.tsx    # Post preview card
│   │   └── MarkdownRenderer.tsx
│   ├── pages/              # Route pages
│   │   ├── Home.tsx        # Landing + recent posts
│   │   ├── Author.tsx      # Author profile + posts
│   │   ├── Post.tsx        # Single post view
│   │   └── Editor.tsx      # Post composer
│   └── lib/                # Utilities
│       ├── auth.tsx        # OAuth provider
│       ├── atproto.ts      # Direct PDS fetching
│       ├── appview.ts      # API client
│       ├── themes.ts       # Theme definitions
│       └── markdown.ts     # Markdown processing
├── workers/                # Cloudflare Workers
│   ├── api/index.ts        # Main API worker
│   ├── firehose/index.ts   # Firehose consumer DO
│   └── schema.sql          # D1 database schema
├── public/                 # Static assets
│   └── client-metadata.json # OAuth client metadata
└── wrangler.toml           # Cloudflare config
```

## API Endpoints

Base URL: `https://greengale.asadegroff.workers.dev`

### Public Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /xrpc/app.greengale.feed.getRecentPosts` | Recent posts feed (cached) |
| `GET /xrpc/app.greengale.feed.getAuthorPosts?author=` | Posts by author |
| `GET /xrpc/app.greengale.feed.getPost?author=&rkey=` | Single post by author/rkey |
| `GET /xrpc/app.greengale.actor.getProfile?author=` | Author profile |
| `GET /xrpc/app.greengale.auth.checkWhitelist?did=` | Check beta access |

### Well-Known Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /.well-known/site.standard.publication` | GreenGale platform publication AT-URI |
| `GET /.well-known/site.standard.publication?handle=` | User's publication AT-URI |

### OpenGraph Image Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /og/site.png` | Homepage OG image |
| `GET /og/profile/:handle.png` | Author profile OG image |
| `GET /og/:handle/:rkey.png` | Post OG image |

### Admin Endpoints

Require `X-Admin-Secret` header.

| Endpoint | Description |
|----------|-------------|
| `POST /xrpc/app.greengale.admin.addToWhitelist` | Add user to whitelist |
| `POST /xrpc/app.greengale.admin.removeFromWhitelist` | Remove user from whitelist |
| `GET /xrpc/app.greengale.admin.listWhitelist` | List whitelisted users |
| `POST /xrpc/app.greengale.admin.startFirehose` | Start firehose indexing |
| `POST /xrpc/app.greengale.admin.refreshAuthorProfiles` | Refresh all author profiles |
| `POST /xrpc/app.greengale.admin.backfillFirstImageCid` | Backfill thumbnail CIDs |
| `POST /xrpc/app.greengale.admin.invalidateOGCache?handle=&rkey=` | Invalidate OG cache |

## Lexicons

GreenGale uses AT Protocol lexicons to define blog post and publication records. The lexicon files are located in `lexicons/`.

### Collections Overview

| Collection | Description |
|------------|-------------|
| `app.greengale.document` | Primary blog document format (V2) |
| `app.greengale.publication` | Publication/blog configuration |
| `site.standard.document` | Cross-platform document (dual-published) |
| `site.standard.publication` | Cross-platform publication (dual-published) |
| `app.greengale.blog.entry` | Legacy V1 format |
| `com.whtwnd.blog.entry` | WhiteWind format (read-only) |

### GreenGale Document (`app.greengale.document`)

The primary blog document format with theme, LaTeX, and standard.site compatibility.

**Record Key**: `tid` (timestamp identifier)

#### Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `content` | string | ✓ | Markdown content (max 1,000,000 UTF-8 bytes) |
| `url` | string (URI) | ✓ | Base publication URL (e.g., `https://greengale.app`) |
| `path` | string | ✓ | Document path relative to URL (e.g., `/handle/rkey`) |
| `title` | string | ✓ | Document title (max 1,000 chars) |
| `publishedAt` | datetime | ✓ | Publication timestamp |
| `subtitle` | string | | Post subtitle (max 1,000 chars) |
| `visibility` | enum | | `"public"`, `"url"` (unlisted), or `"author"` (private). Default: `"public"` |
| `theme` | object | | Theme configuration (see below) |
| `latex` | boolean | | Enable KaTeX math rendering. Default: `false` |
| `ogp` | object | | Open Graph image metadata |
| `blobs` | array | | Uploaded file references |

#### Example: Preset Theme

```json
{
  "$type": "app.greengale.document",
  "content": "# Hello World\n\nMarkdown content with **formatting**...",
  "url": "https://greengale.app",
  "path": "/user.bsky.social/3abc123",
  "title": "My Post",
  "subtitle": "A subtitle",
  "publishedAt": "2024-01-01T00:00:00.000Z",
  "visibility": "public",
  "theme": { "preset": "dracula" },
  "latex": true
}
```

#### Example: Custom Color Theme

```json
{
  "$type": "app.greengale.document",
  "content": "# Custom Themed Post\n\nThis post uses custom colors.",
  "url": "https://greengale.app",
  "path": "/user.bsky.social/3abc456",
  "title": "My Custom Theme",
  "publishedAt": "2024-01-01T00:00:00.000Z",
  "theme": {
    "custom": {
      "background": "#1a1a2e",
      "text": "#eaeaea",
      "accent": "#e94560"
    }
  }
}
```

### GreenGale Publication (`app.greengale.publication`)

Publication/blog configuration record. Stored with record key `self`.

#### Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `url` | string (URI) | ✓ | Publication base URL |
| `name` | string | ✓ | Publication/blog title (max 200 chars) |
| `description` | string | | Publication description (max 1,000 chars) |
| `theme` | object | | Default theme for posts |
| `enableSiteStandard` | boolean | | Dual-publish to standard.site collections. Default: `false` |

#### Example

```json
{
  "$type": "app.greengale.publication",
  "url": "https://greengale.app",
  "name": "My Blog",
  "description": "Thoughts on technology and design",
  "enableSiteStandard": true
}
```

### Theme Configuration (`app.greengale.blog.defs#theme`)

The `theme` object supports either a preset theme or custom colors.

#### Preset Themes

Set `theme.preset` to one of:

| Preset | Description |
|--------|-------------|
| `github-light` | GitHub light theme |
| `github-dark` | GitHub dark theme |
| `dracula` | Dracula dark theme |
| `nord` | Nord dark theme |
| `solarized-light` | Solarized light |
| `solarized-dark` | Solarized dark |
| `monokai` | Monokai dark theme |

If `theme` is omitted or empty, the post follows the user's preferred theme (or site light/dark mode).

#### Custom Colors (`app.greengale.blog.defs#customColors`)

Set `theme.custom` to define your own color scheme:

| Property | Type | Description |
|----------|------|-------------|
| `background` | string | Background color (CSS color value) |
| `text` | string | Primary text color |
| `accent` | string | Accent/link color |
| `codeBackground` | string | Code block background (optional, auto-derived if omitted) |

**Color Derivation**: GreenGale automatically derives additional colors from these 3-4 base colors:
- Secondary text (40% blend toward background)
- Borders (lightness-adjusted background)
- Link hover states (lightness-adjusted accent)
- Blockquote styling
- Code text color

**Contrast Correction**: If custom colors don't meet WCAG accessibility guidelines (4.5:1 for text, 3:1 for UI), GreenGale automatically adjusts them when rendering to ensure readability.

### OGP Metadata (`app.greengale.blog.defs#ogp`)

Open Graph Protocol image for social sharing previews.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `url` | string (URI) | ✓ | URL of the OGP image |
| `width` | integer | | Image width in pixels |
| `height` | integer | | Image height in pixels |

### Blob Metadata (`app.greengale.blog.defs#blobMetadata`)

References to uploaded binary content (images, files).

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `blobref` | blob | ✓ | AT Protocol blob reference |
| `name` | string | | Original filename |
| `alt` | string | | Alt text for accessibility (max 1,000 chars) |
| `labels` | selfLabels | | Content warning labels |

#### Content Warning Labels

Images can be labeled with content warnings using AT Protocol self-labels:

| Label | Description |
|-------|-------------|
| `nudity` | Non-sexual nudity (artistic, educational) |
| `sexual` | Sexually suggestive content |
| `porn` | Explicit sexual content (18+) |
| `graphic-media` | Violence, gore, or disturbing imagery |

Labeled images display blurred with a warning overlay until the viewer acknowledges.

### Standard.site Document (`site.standard.document`)

Cross-platform document record for content discovery. Automatically created when dual-publishing is enabled.

**Record Key**: `tid` (same as corresponding `app.greengale.document`)

#### Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `site` | string (URI) | ✓ | Parent publication URI (https:// or at://) |
| `title` | string | ✓ | Document title (max 128 graphemes) |
| `publishedAt` | datetime | ✓ | Publication timestamp |
| `path` | string | | URL path relative to site |
| `description` | string | | Brief description/excerpt (max 300 graphemes) |
| `coverImage` | blob | | Cover image (max 1MB) |
| `content` | unknown | | Open union for content reference |
| `textContent` | string | | Plaintext for search (max 100,000 chars) |
| `tags` | array | | Categorization tags (max 100 items) |
| `updatedAt` | datetime | | Last edit timestamp |

### Standard.site Publication (`site.standard.publication`)

Cross-platform publication record. Automatically created when dual-publishing is enabled.

**Record Key**: `self`

#### Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `url` | string (URI) | ✓ | Publication base URL |
| `name` | string | ✓ | Publication name (max 128 graphemes) |
| `description` | string | | Brief description (max 300 graphemes) |
| `icon` | blob | | Square icon image (min 256x256, max 1MB) |
| `basicTheme` | object | | Simplified theme (see below) |
| `preferences` | unknown | | Platform-specific preferences |

#### Basic Theme

| Property | Type | Description |
|----------|------|-------------|
| `primaryColor` | string | Primary/text color |
| `backgroundColor` | string | Background color |
| `accentColor` | string | Accent/link color |

### Legacy: GreenGale V1 (`app.greengale.blog.entry`)

The original GreenGale format, still supported for reading existing posts.

```json
{
  "$type": "app.greengale.blog.entry",
  "content": "# Hello World\n\nMarkdown content...",
  "title": "My Post",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "visibility": "public",
  "theme": { "preset": "dracula" }
}
```

### WhiteWind Compatibility (`com.whtwnd.blog.entry`)

GreenGale reads and displays WhiteWind posts. The WhiteWind format is simpler:

```json
{
  "$type": "com.whtwnd.blog.entry",
  "content": "# Hello World\n\nMarkdown content...",
  "title": "My Post",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "visibility": "public"
}
```

WhiteWind posts are displayed with default theming.

## Development

### Prerequisites

- Node.js 18+
- Cloudflare account (for Workers/D1/KV)

### Setup

```bash
# Install dependencies
npm install

# Start frontend dev server
npm run dev

# Start worker dev server (separate terminal)
npm run worker:dev
```

### Database

```bash
# Apply schema to local D1
npx wrangler d1 execute greengale --local --file=workers/schema.sql

# Apply schema to remote D1
npx wrangler d1 execute greengale --remote --file=workers/schema.sql
```

### Deployment

```bash
# Deploy worker
npx wrangler deploy

# Build and deploy frontend
npm run build
npx wrangler pages deploy dist --project-name greengale-app
```

## Environment Variables

### Worker (`wrangler.toml`)

- `RELAY_URL` - AT Protocol relay WebSocket URL (default: `wss://bsky.network`)
- `ADMIN_SECRET` - Secret for admin endpoints

### Frontend (`.env`)

- `VITE_APPVIEW_URL` - API worker URL (optional, auto-detected)

## Theme System

GreenGale themes can be applied to the entire site as a viewer, and also to individual posts as an author. Viewers can choose to view posts with either the post theme or their preferred site theme. 

### Site Theme (Light/Dark Mode)

The site respects system preferences for light/dark mode, togglable via the sidebar. This applies when the default theme is selected (no alternative theme has been specified by the user). 

### Post Themes

Posts can specify a theme that applies to the entire page when viewing:

| Preset | Description |
|--------|-------------|
| `default` | Follows user's preferred theme |
| `github-light` | GitHub light theme |
| `github-dark` | GitHub dark theme |
| `dracula` | Dracula dark theme |
| `nord` | Nord dark theme |
| `solarized-light` | Solarized light |
| `solarized-dark` | Solarized dark |
| `monokai` | Monokai dark theme |
| `custom` | Author-defined custom colors |

### Custom Color Themes

Authors can create custom color themes by specifying 3-4 base colors:

- **Background** - Page background color
- **Text** - Primary text color
- **Accent** - Links and interactive elements
- **Code Background** - Optional, auto-derived if omitted

GreenGale uses the [OKLCH color space](https://oklch.com/) to derive a full palette of 11+ CSS variables from these base colors, ensuring perceptually uniform color relationships.

**Accessibility**: The editor validates contrast ratios against WCAG guidelines and prevents publishing themes with insufficient contrast. When viewing posts created via API with low contrast, colors are automatically adjusted.

### User Preferences

Users can set their preferred theme in the sidebar settings:

- **Preset themes**: Apply to the home page and posts with default theme
- **Custom theme**: Users can define their own preferred color scheme
- **Override toggle**: "Use Preferred Style" button overrides post themes with user preference

Theme preferences are stored in localStorage and persist across sessions.

## Image Uploads

GreenGale supports embedding images in blog posts via drag-and-drop. Images are stored in your Personal Data Server (PDS) as blobs.

### Upload Process

1. **Drag and drop** an image onto the editor textarea
2. Images are automatically validated, resized, and converted to AVIF format
3. The processed image is uploaded to your PDS
4. Markdown image syntax is inserted at the cursor position

### Supported Formats

- JPEG, PNG, GIF, WebP, AVIF, BMP
- Maximum input size: 50MB
- Images are resized to max 10240px in either dimension (preserving aspect ratio)
- Output format: AVIF (target <1MB to stay within AT Protocol's blob limit)
- For images larger than 1MB, the AVIF encoder will try multiple passes at increasing compression levels if necessary. If the max compression level is reached and the image is still above 1MB, it will then be resized and compressed again. 

### Alt Text

Click any uploaded image in the "Uploaded Images" panel to add accessibility text (max 1,000 characters). When viewing posts, images display an "ALT" badge that reveals the description when clicked.

### Image Lightbox

Clicking an image in a blog post shows it in the image lightbox. The lightbox supports scroll to zoom, click+drag to pan, and hover the lower part to view alt text. 

### Content Warnings

Images can be labeled with content warnings for sensitive content:

| Label | Description |
|-------|-------------|
| `nudity` | Non-sexual nudity (artistic, educational) |
| `sexual` | Sexually suggestive content |
| `porn` | Explicit sexual content (18+) |
| `graphic-media` | Violence, gore, or disturbing imagery |

Labeled images display blurred with a warning overlay. Viewers must acknowledge the warning before the image is revealed.

### Limitations

- Image uploads are only available for **GreenGale format** posts
- WhiteWind format does not support blob attachments

## Inline SVG Diagrams

GreenGale supports embedding SVG graphics directly in blog posts using fenced code blocks with the `svg` language identifier. SVG content found in code blocks with empty, `xml`, and `html` language modifiers will also be rendered. 

````markdown
```svg
<svg viewBox="0 0 200 100" width="200" height="100">
  <rect x="10" y="10" width="80" height="80" fill="#3b82f6" rx="8"/>
  <circle cx="150" cy="50" r="40" fill="#10b981"/>
  <text x="50" y="55" text-anchor="middle" fill="white" font-size="14">Box</text>
</svg>
```
````

### Supported Elements

- **Shapes**: `circle`, `ellipse`, `rect`, `line`, `path`, `polygon`, `polyline`
- **Text**: `text`, `tspan`, `textPath`
- **Gradients**: `linearGradient`, `radialGradient`, `stop`
- **Structure**: `svg`, `g`, `defs`, `symbol`, `use`, `title`, `desc`, `style`
- **Effects**: `clipPath`, `mask`, `marker`, `pattern`
- **Filters**: `filter`, `feGaussianBlur`, `feOffset`, `feMerge`, `feMergeNode`, `feBlend`, `feColorMatrix`, `feFlood`, `feComposite`
- **Animation**: `animate`, `animateTransform`, `animateMotion`, `set`, `mpath`

### Security

SVG content is sanitized before rendering to prevent XSS attacks:

- **Blocked elements**: `script`, `foreignObject`, `iframe`, `object`, `embed`
- **Blocked attributes**: All event handlers (`onclick`, `onload`, etc.)
- **Restricted hrefs**: Only internal references (`#id`) are allowed; external URLs are stripped
- **CSS sanitization**: `style` elements and attributes are checked for dangerous patterns (`url()`, `expression()`, `javascript:`, `@import`, `-moz-binding`)
- **Size limit**: 100KB maximum per SVG block

Invalid or unsafe SVG content displays an error message instead of rendering.

## Standard.site Publishing

GreenGale supports dual-publishing to the [standard.site](https://standard.site) ecosystem, enabling cross-platform blog discovery.

### How It Works

1. Posts are saved to `app.greengale.document` (primary format)
2. If enabled, posts are also published to `site.standard.document` (same rkey)
3. Publication metadata is similarly dual-published to both `app.greengale.publication` and `site.standard.publication`

### Configuration

- **Publication level**: Toggle in Author page publication settings (`enableSiteStandard`)
- **Per-post level**: Checkbox in Editor ("Publish to standard.site")
- **Default**: Enabled when publication setting is on (opt-out per post)
- **Restriction**: Only public posts can be dual-published

### Theme Conversion

GreenGale themes are converted to standard.site's `basicTheme` format:
- Preset themes map to predefined colors
- Custom themes use colors directly
- Full GreenGale theme stored in `preferences.greengale` for round-trip preservation

### Well-Known Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /.well-known/site.standard.publication` | GreenGale platform publication AT-URI |
| `GET /.well-known/site.standard.publication?handle=` | User's publication AT-URI |

## Text-to-Speech

Blog posts can be read aloud using the Kokoro TTS model running entirely in the browser via WebGPU or WebAssembly.

### Features

- **Streaming playback**: Audio generates sentence-by-sentence with buffering for smooth playback
- **Sentence highlighting**: Current sentence is highlighted in the post content
- **Seek support**: Click any paragraph to jump to that position
- **Speed control**: Playback rates from 0.5x to 2x with pitch preservation
- **Offline capable**: Model cached in IndexedDB after first download

### Device Selection

| Platform | Backend | Model Size |
|----------|---------|------------|
| macOS | WebGPU (GPU acceleration) | ~326 MB |
| Other | WebAssembly (quantized) | ~92 MB |

Manual override: `localStorage.setItem('tts-force-webgpu', 'true')`

### Text Processing

1. Markdown stripped (code blocks, LaTeX removed)
2. Images with alt text read as "Image: {alt text}"
3. Split into sentences for streaming
4. Parentheses converted to commas for natural pauses
5. List items get trailing periods for sentence boundaries

### Model

Uses `onnx-community/Kokoro-82M-v1.0-ONNX` via Hugging Face Transformers.js.

**Known Issue**: WebGPU produces garbled audio on some Linux configurations. See [transformers.js#1320](https://github.com/huggingface/transformers.js/issues/1320).

## OpenGraph Images

Dynamic OG images are generated for posts, profiles, and the homepage using `workers-og` (Satori + resvg-wasm).

### Features

- **Post OG images**: Display title, subtitle, author info, theme colors, and optional thumbnail
- **Thumbnail support**: Posts with images show a 280x280 thumbnail on the right side
- **Theme-aware**: OG images reflect the post's color theme (preset or custom)
- **Multi-language**: Automatic font fallback for CJK, Arabic, Hebrew, Cyrillic, etc.

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /og/site.png` | Homepage OG image |
| `GET /og/profile/:handle.png` | Author profile OG image |
| `GET /og/:handle/:rkey.png` | Post OG image (with optional thumbnail) |

### Thumbnail Pipeline

1. First image CID extracted from `blobs` array during firehose indexing
2. Images with content labels (`nudity`, `sexual`, `porn`, `graphic-media`) are skipped
3. At generation time, image fetched via wsrv.nl proxy (converts AVIF to JPEG for Satori compatibility)
4. Embedded as base64 data URL in the OG image

### Caching

OG images are cached in KV for 7 days, invalidated on post update.

## License

GPLv3
