// HTML template renderer for bot prerendering

import type { BlogEntry, AuthorProfile, PostSummary } from './atproto'
import { renderMarkdownToHtml, extractText } from './markdown'

interface RenderOptions {
  entry: BlogEntry
  author: AuthorProfile
  handle: string
  rkey: string
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatDate(isoDate: string | undefined): string {
  if (!isoDate) return ''
  try {
    return new Date(isoDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}

export function renderPostHtml(options: RenderOptions): string {
  const { entry, author, handle, rkey } = options

  const title = entry.title || 'Untitled'
  const description = entry.subtitle || extractText(entry.content, 160)
  const displayName = author.displayName || author.handle
  const canonicalUrl = `https://greengale.app/${handle}/${rkey}`
  const formattedDate = formatDate(entry.createdAt)
  const ogImageUrl = `https://greengale.asadegroff.workers.dev/og/${handle}/${rkey}.png`

  // Render markdown content to HTML
  const htmlContent = renderMarkdownToHtml(entry.content)

  // Build JSON-LD structured data
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    description: description,
    datePublished: entry.createdAt,
    author: {
      '@type': 'Person',
      name: displayName,
      identifier: author.did,
    },
    publisher: {
      '@type': 'Organization',
      name: 'GreenGale',
      url: 'https://greengale.app',
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': canonicalUrl,
    },
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Primary Meta Tags -->
  <title>${escapeHtml(title)} - GreenGale</title>
  <meta name="title" content="${escapeHtml(title)} - GreenGale">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="author" content="${escapeHtml(displayName)} (@${escapeHtml(handle)})">

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="article">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:site_name" content="GreenGale">
  <meta property="og:image" content="${escapeHtml(ogImageUrl)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="article:author" content="${escapeHtml(displayName)}">
  ${entry.createdAt ? `<meta property="article:published_time" content="${escapeHtml(entry.createdAt)}">` : ''}

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta property="twitter:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="twitter:title" content="${escapeHtml(title)}">
  <meta property="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}">

  <!-- Canonical URL -->
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">

  ${entry.siteStandardUri ? `<!-- site.standard Document Verification -->
  <link rel="site.standard.document" href="${escapeHtml(entry.siteStandardUri)}">` : ''}

  ${entry.siteStandardPublicationUri ? `<!-- site.standard Publication Verification -->
  <link rel="site.standard.publication" href="${escapeHtml(entry.siteStandardPublicationUri)}">` : ''}

  <!-- JSON-LD Structured Data -->
  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
  </script>

  <!-- Minimal styling for readability -->
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      line-height: 1.6;
      color: #1a1a1a;
      background: #fff;
    }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; line-height: 1.2; }
    .subtitle { font-size: 1.25rem; color: #666; margin-bottom: 1rem; font-weight: normal; }
    .meta { color: #666; font-size: 0.9rem; margin-bottom: 2rem; border-bottom: 1px solid #eee; padding-bottom: 1rem; }
    .meta a { color: #0066cc; text-decoration: none; }
    .meta a:hover { text-decoration: underline; }
    article { font-size: 1.1rem; }
    article h1, article h2, article h3, article h4 { margin-top: 1.5em; margin-bottom: 0.5em; }
    article p { margin: 1em 0; }
    article a { color: #0066cc; }
    article code { background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
    article pre { background: #f4f4f4; padding: 1rem; overflow-x: auto; border-radius: 6px; }
    article pre code { background: none; padding: 0; }
    article blockquote { border-left: 4px solid #ddd; margin: 1em 0; padding-left: 1em; color: #555; }
    article img { max-width: 100%; height: auto; }
    article ul, article ol { padding-left: 1.5em; }
    article table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    article th, article td { border: 1px solid #ddd; padding: 0.5em; text-align: left; }
    article th { background: #f4f4f4; }
    footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #eee; color: #666; font-size: 0.9rem; }
    footer a { color: #0066cc; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    ${entry.subtitle ? `<p class="subtitle">${escapeHtml(entry.subtitle)}</p>` : ''}
    <p class="meta">
      By <a href="https://greengale.app/${escapeHtml(handle)}">${escapeHtml(displayName)}</a> (@${escapeHtml(handle)})
      ${formattedDate ? `<br>Published: <time datetime="${escapeHtml(entry.createdAt || '')}">${escapeHtml(formattedDate)}</time>` : ''}
    </p>
  </header>

  <article>
${htmlContent}
  </article>

  <footer>
    <p>Read on <a href="${escapeHtml(canonicalUrl)}">GreenGale</a> - A decentralized blogging platform on AT Protocol</p>
  </footer>
</body>
</html>`
}

/**
 * Common styles shared between pages
 */
const commonStyles = `
  body {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
    line-height: 1.6;
    color: #1a1a1a;
    background: #fff;
  }
  h1 { font-size: 2rem; margin-bottom: 0.5rem; line-height: 1.2; }
  a { color: #0066cc; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .post-list { list-style: none; padding: 0; }
  .post-item { padding: 1.5rem 0; border-bottom: 1px solid #eee; }
  .post-item:last-child { border-bottom: none; }
  .post-title { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem 0; }
  .post-subtitle { color: #666; margin: 0 0 0.5rem 0; }
  .post-meta { color: #888; font-size: 0.875rem; }
  .author-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 1px solid #eee; }
  .author-avatar { width: 80px; height: 80px; border-radius: 50%; object-fit: cover; }
  .author-info h1 { margin: 0; }
  .author-handle { color: #666; margin: 0.25rem 0; }
  .author-bio { color: #444; margin-top: 0.5rem; }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #eee; color: #666; font-size: 0.9rem; }
`

/**
 * Render a post item for lists
 */
function renderPostItem(post: PostSummary): string {
  const authorName = post.authorDisplayName || post.authorHandle
  const postUrl = `https://greengale.app/${post.authorHandle}/${post.rkey}`
  const authorUrl = `https://greengale.app/${post.authorHandle}`
  const formattedDate = formatDate(post.createdAt)

  return `
    <li class="post-item">
      <h2 class="post-title"><a href="${escapeHtml(postUrl)}">${escapeHtml(post.title || 'Untitled')}</a></h2>
      ${post.subtitle ? `<p class="post-subtitle">${escapeHtml(post.subtitle)}</p>` : ''}
      <p class="post-meta">
        By <a href="${escapeHtml(authorUrl)}">${escapeHtml(authorName)}</a>
        ${formattedDate ? ` · ${escapeHtml(formattedDate)}` : ''}
      </p>
    </li>
  `
}

/**
 * Render the homepage with recent posts
 */
export function renderHomepageHtml(posts: PostSummary[]): string {
  const title = 'GreenGale - Decentralized Blogging'
  const description = 'A decentralized blogging platform built on AT Protocol. Read and share blog posts with the Bluesky ecosystem.'
  const canonicalUrl = 'https://greengale.app'
  const ogImageUrl = 'https://greengale.asadegroff.workers.dev/og/site.png'

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'GreenGale',
    description,
    url: canonicalUrl,
    publisher: {
      '@type': 'Organization',
      name: 'GreenGale',
      url: canonicalUrl,
    },
  }

  const postListHtml = posts.length > 0
    ? `<ul class="post-list">${posts.map(renderPostItem).join('')}</ul>`
    : '<p>No posts yet. Check back soon!</p>'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Primary Meta Tags -->
  <title>${escapeHtml(title)}</title>
  <meta name="title" content="${escapeHtml(title)}">
  <meta name="description" content="${escapeHtml(description)}">

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:site_name" content="GreenGale">
  <meta property="og:image" content="${escapeHtml(ogImageUrl)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta property="twitter:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="twitter:title" content="${escapeHtml(title)}">
  <meta property="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}">

  <!-- Canonical URL -->
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">

  <!-- JSON-LD Structured Data -->
  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
  </script>

  <style>${commonStyles}</style>
</head>
<body>
  <header>
    <h1>GreenGale</h1>
    <p>A decentralized blogging platform on AT Protocol</p>
  </header>

  <main>
    <h2>Recent Posts</h2>
    ${postListHtml}
  </main>

  <footer>
    <p><a href="${escapeHtml(canonicalUrl)}">GreenGale</a> - Decentralized blogging for the Bluesky ecosystem</p>
  </footer>
</body>
</html>`
}

/**
 * Render an author's profile page with their posts
 */
export function renderProfileHtml(author: AuthorProfile, posts: PostSummary[]): string {
  const displayName = author.displayName || author.handle
  const title = `${displayName} (@${author.handle}) - GreenGale`
  const description = author.description || `Blog posts by ${displayName} on GreenGale`
  const canonicalUrl = `https://greengale.app/${author.handle}`
  const ogImageUrl = `https://greengale.asadegroff.workers.dev/og/profile/${author.handle}.png`

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: {
      '@type': 'Person',
      name: displayName,
      identifier: author.did,
      url: canonicalUrl,
      description: author.description,
      image: author.avatar,
    },
  }

  const postListHtml = posts.length > 0
    ? `<ul class="post-list">${posts.map(renderPostItem).join('')}</ul>`
    : '<p>No posts yet.</p>'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Primary Meta Tags -->
  <title>${escapeHtml(title)}</title>
  <meta name="title" content="${escapeHtml(title)}">
  <meta name="description" content="${escapeHtml(description)}">

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="profile">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:site_name" content="GreenGale">
  <meta property="og:image" content="${escapeHtml(ogImageUrl)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="profile:username" content="${escapeHtml(author.handle)}">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta property="twitter:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="twitter:title" content="${escapeHtml(title)}">
  <meta property="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}">

  <!-- Canonical URL -->
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">

  <!-- JSON-LD Structured Data -->
  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
  </script>

  <style>${commonStyles}</style>
</head>
<body>
  <header class="author-header">
    ${author.avatar ? `<img class="author-avatar" src="${escapeHtml(author.avatar)}" alt="${escapeHtml(displayName)}">` : ''}
    <div class="author-info">
      <h1>${escapeHtml(displayName)}</h1>
      <p class="author-handle">@${escapeHtml(author.handle)}</p>
      ${author.description ? `<p class="author-bio">${escapeHtml(author.description)}</p>` : ''}
    </div>
  </header>

  <main>
    <h2>Posts</h2>
    ${postListHtml}
  </main>

  <footer>
    <p>Read on <a href="${escapeHtml(canonicalUrl)}">GreenGale</a> - A decentralized blogging platform on AT Protocol</p>
  </footer>
</body>
</html>`
}
