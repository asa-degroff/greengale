// HTML template renderer for bot prerendering

import type { BlogEntry, AuthorProfile } from './atproto'
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

export async function renderPostHtml(options: RenderOptions): Promise<string> {
  const { entry, author, handle, rkey } = options

  const title = entry.title || 'Untitled'
  const description = entry.subtitle || extractText(entry.content, 160)
  const displayName = author.displayName || author.handle
  const canonicalUrl = `https://greengale.app/${handle}/${rkey}`
  const formattedDate = formatDate(entry.createdAt)
  const ogImageUrl = `https://greengale.asadegroff.workers.dev/og/${handle}/${rkey}.png`

  // Render markdown content to HTML
  const htmlContent = await renderMarkdownToHtml(entry.content)

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
