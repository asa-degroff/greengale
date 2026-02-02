/**
 * RSS 2.0 feed generation utilities
 */

/**
 * Convert markdown to basic HTML for RSS content.
 * Handles common markdown elements that display well in RSS readers.
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown) return ''

  let html = markdown

  // Escape HTML entities first (before we add our own HTML)
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Code blocks (fenced) - must be before other processing
  // Convert to <pre><code> blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`
  })

  // Inline code - must be before bold/italic to avoid conflicts
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Images - convert to linked images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Bold (must be before italic)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>')

  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>')

  // Strikethrough
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>')

  // Headers (h1-h6)
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr />')
  html = html.replace(/^\*\*\*+$/gm, '<hr />')

  // Blockquotes - handle multi-line
  html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>')
  // Merge consecutive blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n')

  // Unordered lists
  // First pass: mark list items
  html = html.replace(/^[-*+]\s+(.+)$/gm, '<li>$1</li>')
  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>\n$1</ul>\n')

  // Ordered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<oli>$1</oli>')
  html = html.replace(/((?:<oli>.*<\/oli>\n?)+)/g, '<ol>\n$1</ol>\n')
  html = html.replace(/<\/?oli>/g, (m) => m === '<oli>' ? '<li>' : '</li>')

  // Convert remaining double newlines to paragraph breaks
  // Split by double newlines, filter empty, wrap in <p> tags
  const blocks = html.split(/\n\n+/)
  html = blocks
    .map(block => {
      block = block.trim()
      if (!block) return ''
      // Don't wrap if already block-level element
      if (/^<(h[1-6]|p|ul|ol|li|pre|blockquote|hr|div|table)/i.test(block)) {
        return block
      }
      // Convert single newlines to <br> within paragraphs
      block = block.replace(/\n/g, '<br />\n')
      return `<p>${block}</p>`
    })
    .filter(b => b)
    .join('\n\n')

  return html
}

/**
 * Fetch full content for a post from PDS
 */
export async function fetchPostContent(
  pdsEndpoint: string,
  did: string,
  rkey: string
): Promise<string | null> {
  // Try collections in order: V2 document, V1 GreenGale, WhiteWind
  const collections = [
    'app.greengale.document',
    'app.greengale.blog.entry',
    'com.whtwnd.blog.entry',
  ]

  for (const collection of collections) {
    try {
      const url = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`
      const response = await fetch(url)

      if (response.ok) {
        const data = await response.json() as { value?: { content?: string } }
        if (data.value?.content) {
          return data.value.content
        }
      }
    } catch {
      // Try next collection
    }
  }

  return null
}

/**
 * RSS channel configuration
 */
export interface RSSChannel {
  title: string
  link: string
  description: string
  lastBuildDate?: string // ISO 8601
  selfLink: string // Atom self-reference URL
  imageUrl?: string // Channel image (e.g., avatar)
  imageTitle?: string
}

/**
 * RSS item (post) configuration
 */
export interface RSSItem {
  title: string
  link: string
  guid: string
  pubDate: string // ISO 8601
  description: string // Content preview
  creator?: string // dc:creator (author name)
  categories?: string[] // Tags
  enclosureUrl?: string // Image URL
  enclosureType?: string // MIME type
  enclosureLength?: number // File size in bytes
}

/**
 * Escape special XML characters
 */
export function escapeXML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Convert ISO 8601 date to RFC 2822 format
 * Required for RSS pubDate and lastBuildDate
 *
 * @example
 * formatRSSDate('2024-01-15T10:30:00.000Z')
 * // Returns: 'Mon, 15 Jan 2024 10:30:00 GMT'
 */
export function formatRSSDate(isoDate: string): string {
  const date = new Date(isoDate)

  // Check for invalid date
  if (isNaN(date.getTime())) {
    return ''
  }

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  const dayName = days[date.getUTCDay()]
  const day = date.getUTCDate().toString().padStart(2, '0')
  const month = months[date.getUTCMonth()]
  const year = date.getUTCFullYear()
  const hours = date.getUTCHours().toString().padStart(2, '0')
  const minutes = date.getUTCMinutes().toString().padStart(2, '0')
  const seconds = date.getUTCSeconds().toString().padStart(2, '0')

  return `${dayName}, ${day} ${month} ${year} ${hours}:${minutes}:${seconds} GMT`
}

/**
 * Build an RSS 2.0 feed XML string
 */
export function buildRSSFeed(channel: RSSChannel, items: RSSItem[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel>',
    `    <title>${escapeXML(channel.title)}</title>`,
    `    <link>${escapeXML(channel.link)}</link>`,
    `    <description>${escapeXML(channel.description)}</description>`,
  ]

  // Optional lastBuildDate
  if (channel.lastBuildDate) {
    const rfc2822Date = formatRSSDate(channel.lastBuildDate)
    if (rfc2822Date) {
      lines.push(`    <lastBuildDate>${rfc2822Date}</lastBuildDate>`)
    }
  }

  // Atom self-link (required for valid RSS)
  lines.push(`    <atom:link href="${escapeXML(channel.selfLink)}" rel="self" type="application/rss+xml"/>`)

  // Optional channel image
  if (channel.imageUrl) {
    lines.push('    <image>')
    lines.push(`      <url>${escapeXML(channel.imageUrl)}</url>`)
    lines.push(`      <title>${escapeXML(channel.imageTitle || channel.title)}</title>`)
    lines.push(`      <link>${escapeXML(channel.link)}</link>`)
    lines.push('    </image>')
  }

  // Add items
  for (const item of items) {
    lines.push('    <item>')
    lines.push(`      <title>${escapeXML(item.title)}</title>`)
    lines.push(`      <link>${escapeXML(item.link)}</link>`)
    lines.push(`      <guid isPermaLink="true">${escapeXML(item.guid)}</guid>`)

    const pubDate = formatRSSDate(item.pubDate)
    if (pubDate) {
      lines.push(`      <pubDate>${pubDate}</pubDate>`)
    }

    // Use CDATA for description to preserve formatting
    lines.push(`      <description><![CDATA[${item.description}]]></description>`)

    // Optional dc:creator
    if (item.creator) {
      lines.push(`      <dc:creator>${escapeXML(item.creator)}</dc:creator>`)
    }

    // Optional categories (tags)
    if (item.categories && item.categories.length > 0) {
      for (const category of item.categories) {
        lines.push(`      <category>${escapeXML(category)}</category>`)
      }
    }

    // Optional enclosure (image)
    if (item.enclosureUrl) {
      const type = item.enclosureType || 'image/avif'
      const length = item.enclosureLength || 0
      lines.push(`      <enclosure url="${escapeXML(item.enclosureUrl)}" type="${type}" length="${length}"/>`)
    }

    lines.push('    </item>')
  }

  lines.push('  </channel>')
  lines.push('</rss>')

  return lines.join('\n')
}
