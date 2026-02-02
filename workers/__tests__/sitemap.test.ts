import { describe, it, expect } from 'vitest'
import { buildSitemap, formatSitemapDate, type SitemapUrl } from '../lib/sitemap'

describe('formatSitemapDate', () => {
  it('formats ISO date to W3C date format', () => {
    expect(formatSitemapDate('2024-01-15T10:30:00.000Z')).toBe('2024-01-15')
  })

  it('handles dates without time', () => {
    expect(formatSitemapDate('2024-06-20')).toBe('2024-06-20')
  })

  it('returns empty string for invalid date', () => {
    expect(formatSitemapDate('not-a-date')).toBe('')
  })

  it('returns empty string for empty input', () => {
    expect(formatSitemapDate('')).toBe('')
  })

  it('handles different timezones correctly', () => {
    // UTC date should be extracted correctly
    expect(formatSitemapDate('2024-12-31T23:59:59Z')).toBe('2024-12-31')
  })
})

describe('buildSitemap', () => {
  it('generates valid sitemap XML structure', () => {
    const sitemap = buildSitemap([])

    expect(sitemap).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(sitemap).toContain('</urlset>')
  })

  it('includes URL location', () => {
    const urls: SitemapUrl[] = [{ loc: 'https://greengale.app/' }]
    const sitemap = buildSitemap(urls)

    expect(sitemap).toContain('<url>')
    expect(sitemap).toContain('<loc>https://greengale.app/</loc>')
    expect(sitemap).toContain('</url>')
  })

  it('includes lastmod when provided', () => {
    const urls: SitemapUrl[] = [{
      loc: 'https://greengale.app/post',
      lastmod: '2024-01-15T10:30:00.000Z',
    }]
    const sitemap = buildSitemap(urls)

    expect(sitemap).toContain('<lastmod>2024-01-15</lastmod>')
  })

  it('omits lastmod when not provided', () => {
    const urls: SitemapUrl[] = [{ loc: 'https://greengale.app/' }]
    const sitemap = buildSitemap(urls)

    expect(sitemap).not.toContain('<lastmod>')
  })

  it('includes changefreq when provided', () => {
    const urls: SitemapUrl[] = [{
      loc: 'https://greengale.app/',
      changefreq: 'daily',
    }]
    const sitemap = buildSitemap(urls)

    expect(sitemap).toContain('<changefreq>daily</changefreq>')
  })

  it('includes priority when provided', () => {
    const urls: SitemapUrl[] = [{
      loc: 'https://greengale.app/',
      priority: 1.0,
    }]
    const sitemap = buildSitemap(urls)

    expect(sitemap).toContain('<priority>1.0</priority>')
  })

  it('formats priority with one decimal place', () => {
    const urls: SitemapUrl[] = [{
      loc: 'https://greengale.app/',
      priority: 0.8,
    }]
    const sitemap = buildSitemap(urls)

    expect(sitemap).toContain('<priority>0.8</priority>')
  })

  it('handles multiple URLs', () => {
    const urls: SitemapUrl[] = [
      { loc: 'https://greengale.app/' },
      { loc: 'https://greengale.app/author' },
      { loc: 'https://greengale.app/author/post' },
    ]
    const sitemap = buildSitemap(urls)

    expect(sitemap).toContain('<loc>https://greengale.app/</loc>')
    expect(sitemap).toContain('<loc>https://greengale.app/author</loc>')
    expect(sitemap).toContain('<loc>https://greengale.app/author/post</loc>')
    expect((sitemap.match(/<url>/g) || []).length).toBe(3)
  })

  it('escapes special XML characters in URLs', () => {
    const urls: SitemapUrl[] = [{
      loc: 'https://greengale.app/search?q=foo&bar=baz',
    }]
    const sitemap = buildSitemap(urls)

    expect(sitemap).toContain('&amp;')
    expect(sitemap).not.toMatch(/<loc>[^<]*[^;]&[^a][^<]*<\/loc>/)
  })

  it('handles all changefreq values', () => {
    const freqs: Array<'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'> =
      ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']

    for (const freq of freqs) {
      const urls: SitemapUrl[] = [{ loc: 'https://greengale.app/', changefreq: freq }]
      const sitemap = buildSitemap(urls)
      expect(sitemap).toContain(`<changefreq>${freq}</changefreq>`)
    }
  })

  it('handles URL with all optional fields', () => {
    const urls: SitemapUrl[] = [{
      loc: 'https://greengale.app/author/post',
      lastmod: '2024-06-15T12:00:00Z',
      changefreq: 'monthly',
      priority: 0.6,
    }]
    const sitemap = buildSitemap(urls)

    expect(sitemap).toContain('<loc>https://greengale.app/author/post</loc>')
    expect(sitemap).toContain('<lastmod>2024-06-15</lastmod>')
    expect(sitemap).toContain('<changefreq>monthly</changefreq>')
    expect(sitemap).toContain('<priority>0.6</priority>')
  })

  it('handles empty URL array', () => {
    const sitemap = buildSitemap([])

    expect(sitemap).toContain('<urlset')
    expect(sitemap).toContain('</urlset>')
    expect(sitemap).not.toContain('<url>')
  })

  it('handles unicode in URLs', () => {
    const urls: SitemapUrl[] = [{
      loc: 'https://greengale.app/%E6%97%A5%E6%9C%AC%E8%AA%9E',
    }]
    const sitemap = buildSitemap(urls)

    expect(sitemap).toContain('%E6%97%A5%E6%9C%AC%E8%AA%9E')
  })
})
