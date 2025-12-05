# GreenGale

A markdown blog platform built on [AT Protocol](https://atproto.com). Compatible with [WhiteWind](https://whtwnd.com) and powered by your Internet handle.

**Live at [greengale.app](https://greengale.app)**

## Features

- **WhiteWind Compatible** - View and create WhiteWind blog posts without any migration needed
- **Theme Selection** - Choose from preset themes (GitHub Light/Dark, Dracula, Nord, Solarized, Monokai) applied per-post
- **KaTeX Support** - Write mathematical equations with full LaTeX rendering
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
│  AT Protocol    │────▶│  Firehose DO     │────▶│  D1 Database │
│  Firehose       │     │  (indexer)       │     │  (posts,     │
└─────────────────┘     └──────────────────┘     │   authors)   │
                                                  └──────┬──────┘
                                                         │
┌─────────────────┐     ┌──────────────────┐            │
│  React Frontend │◀───▶│  API Worker      │◀───────────┘
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

### GreenGale (`app.greengale.blog.entry`)

Extended blog entry format with additional features:

```json
{
  "$type": "app.greengale.blog.entry",
  "content": "# Hello World\n\nMarkdown content...",
  "title": "My Post",
  "subtitle": "A subtitle",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "visibility": "public",
  "theme": { "preset": "dracula" },
  "latex": true
}
```

### WhiteWind (`com.whtwnd.blog.entry`)

Compatible with whtwnd.com:

```json
{
  "$type": "com.whtwnd.blog.entry",
  "content": "# Hello World\n\nMarkdown content...",
  "title": "My Post",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "visibility": "public"
}
```

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

Posts can specify a theme preset that applies to the entire page when viewing:

| Preset | Description |
|--------|-------------|
| `default` | Follows site light/dark mode |
| `github-light` | GitHub light theme |
| `github-dark` | GitHub dark theme |
| `dracula` | Dracula dark theme |
| `nord` | Nord dark theme |
| `solarized-light` | Solarized light |
| `solarized-dark` | Solarized dark |
| `monokai` | Monokai dark theme |

Users can override post themes via the sidebar toggle.

## License

GPLv3
