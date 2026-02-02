/**
 * Sitemap XML generation utilities
 */

export interface SitemapUrl {
  loc: string
  lastmod?: string // ISO 8601 date
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
  priority?: number // 0.0 to 1.0
}

/**
 * Escape special XML characters in URLs
 */
function escapeXML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Format date to W3C Datetime format (YYYY-MM-DD)
 * Sitemaps use this simplified ISO 8601 format
 */
export function formatSitemapDate(isoDate: string): string {
  const date = new Date(isoDate)
  if (isNaN(date.getTime())) return ''
  return date.toISOString().split('T')[0]
}

/**
 * Build a sitemap XML string
 */
export function buildSitemap(urls: SitemapUrl[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ]

  for (const url of urls) {
    lines.push('  <url>')
    lines.push(`    <loc>${escapeXML(url.loc)}</loc>`)

    if (url.lastmod) {
      const formatted = formatSitemapDate(url.lastmod)
      if (formatted) {
        lines.push(`    <lastmod>${formatted}</lastmod>`)
      }
    }

    if (url.changefreq) {
      lines.push(`    <changefreq>${url.changefreq}</changefreq>`)
    }

    if (url.priority !== undefined) {
      lines.push(`    <priority>${url.priority.toFixed(1)}</priority>`)
    }

    lines.push('  </url>')
  }

  lines.push('</urlset>')
  return lines.join('\n')
}
