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
- **Dual Lexicon Support** - Create posts in either GreenGale (`app.greengale.blog.entry`) or WhiteWind (`com.whtwnd.blog.entry`) format
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

| Endpoint | Description |
|----------|-------------|
| `GET /xrpc/app.greengale.feed.getRecentPosts` | Recent posts feed (cached) |
| `GET /xrpc/app.greengale.feed.getAuthorPosts` | Posts by author |
| `GET /xrpc/app.greengale.feed.getPost` | Single post by author/rkey |
| `GET /xrpc/app.greengale.actor.getProfile` | Author profile |
| `GET /xrpc/app.greengale.auth.checkWhitelist` | Check beta access |

## Lexicons

GreenGale uses AT Protocol lexicons to define blog post records. The lexicon files are located in `lexicons/app/greengale/blog/`.

### GreenGale Entry (`app.greengale.blog.entry`)

Extended blog entry format with theme and LaTeX support.

**Record Key**: `tid` (timestamp identifier)

#### Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `content` | string | ✓ | Markdown content (max 100,000 chars) |
| `title` | string | | Post title (max 1,000 chars) |
| `subtitle` | string | | Post subtitle (max 1,000 chars) |
| `createdAt` | datetime | | ISO 8601 timestamp |
| `visibility` | enum | | `"public"`, `"url"` (unlisted), or `"author"` (private). Default: `"public"` |
| `theme` | object | | Theme configuration (see below) |
| `latex` | boolean | | Enable KaTeX math rendering. Default: `false` |
| `ogp` | object | | Open Graph image metadata |
| `blobs` | array | | Uploaded file references |

#### Example: Preset Theme

```json
{
  "$type": "app.greengale.blog.entry",
  "content": "# Hello World\n\nMarkdown content with **formatting**...",
  "title": "My Post",
  "subtitle": "A subtitle",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "visibility": "public",
  "theme": { "preset": "dracula" },
  "latex": true
}
```

#### Example: Custom Color Theme

```json
{
  "$type": "app.greengale.blog.entry",
  "content": "# Custom Themed Post\n\nThis post uses custom colors.",
  "title": "My Custom Theme",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "theme": {
    "custom": {
      "background": "#1a1a2e",
      "text": "#eaeaea",
      "accent": "#e94560"
    }
  }
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

GreenGale has a two-level theme system:

### Site Theme (Light/Dark Mode)

The site respects system preferences for light/dark mode, togglable via the sidebar.

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
- Images are resized to max 4096×4096 (preserving aspect ratio)
- Output format: AVIF (target <900KB to stay within AT Protocol's 1MB blob limit)

### Alt Text

Click any uploaded image in the "Uploaded Images" panel to add accessibility text (max 1,000 characters). When viewing posts, images display an "ALT" badge that reveals the description when clicked.

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

GreenGale supports embedding SVG graphics directly in blog posts using fenced code blocks with the `svg` language identifier:

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
- **Structure**: `g`, `defs`, `symbol`, `use`, `title`, `desc`
- **Effects**: `clipPath`, `mask`, `marker`, `pattern`
- **Filters**: `filter`, `feGaussianBlur`, `feOffset`, `feMerge`, `feBlend`, `feColorMatrix`, `feFlood`, `feComposite`

### Security

SVG content is sanitized before rendering to prevent XSS attacks:

- **Blocked elements**: `script`, `foreignObject`, `iframe`, `object`, `embed`
- **Blocked attributes**: All event handlers (`onclick`, `onload`, etc.)
- **Restricted hrefs**: Only internal references (`#id`) are allowed; external URLs are stripped
- **Blocked CSS patterns**: `url()`, `expression()`, `javascript:`, `@import`
- **Size limit**: 100KB maximum per SVG block

Invalid or unsafe SVG content displays an error message instead of rendering.

## License

GPLv3
