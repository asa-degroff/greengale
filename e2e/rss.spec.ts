import { test, expect } from '@playwright/test'

// Worker URL for direct API calls (Pages Functions not available in Vite dev server)
const WORKER_URL = 'http://localhost:8787'

test.describe('RSS Feeds', () => {
  test('recent posts RSS feed returns valid XML', async ({ request }) => {
    const response = await request.get(`${WORKER_URL}/feed/recent.xml`)

    // Check response status
    expect(response.status()).toBe(200)

    // Check content type
    const contentType = response.headers()['content-type'] || ''
    expect(contentType).toContain('application/rss+xml')

    // Check XML content
    const body = await response.text()
    expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(body).toContain('<rss version="2.0"')
    expect(body).toContain('xmlns:atom="http://www.w3.org/2005/Atom"')
    expect(body).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"')
    expect(body).toContain('<channel>')
    expect(body).toContain('<title>GreenGale - Recent Posts</title>')
    expect(body).toContain('<link>https://greengale.app</link>')
    expect(body).toContain('</channel>')
    expect(body).toContain('</rss>')

    // Check Atom self-link for valid RSS
    expect(body).toContain('<atom:link')
    expect(body).toContain('rel="self"')
    expect(body).toContain('type="application/rss+xml"')
  })

  test('recent posts RSS feed contains posts', async ({ request }) => {
    const response = await request.get(`${WORKER_URL}/feed/recent.xml`)
    const body = await response.text()

    // Should contain at least one post item (unless the DB is empty)
    // Check for item structure rather than count since DB may be empty in test env
    if (body.includes('<item>')) {
      expect(body).toContain('<title>')
      expect(body).toContain('<link>')
      expect(body).toContain('<guid')
      expect(body).toContain('<pubDate>')
      expect(body).toContain('<description>')
    }
  })

  test('author RSS feed returns valid XML for existing author', async ({ request, page }) => {
    // First, get a valid author handle from the homepage
    await page.goto('/')

    const firstPost = page.locator('article, [data-testid="post-card"]').first()
    await expect(firstPost).toBeVisible({ timeout: 10000 })

    const postLink = firstPost.locator('a').first()
    const href = await postLink.getAttribute('href')

    if (!href) {
      test.skip()
      return
    }

    // Extract handle from URL (format: /handle/rkey)
    const parts = href.split('/').filter(Boolean)
    if (parts.length < 1) {
      test.skip()
      return
    }

    const handle = parts[0]

    // Request the author's RSS feed (directly from worker)
    const response = await request.get(`${WORKER_URL}/feed/${handle}.xml`)

    // Check response status
    expect(response.status()).toBe(200)

    // Check content type
    const contentType = response.headers()['content-type'] || ''
    expect(contentType).toContain('application/rss+xml')

    // Check XML content
    const body = await response.text()
    expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(body).toContain('<rss version="2.0"')
    expect(body).toContain('<channel>')
    expect(body).toContain(`<link>https://greengale.app/${handle}</link>`)
    expect(body).toContain('</channel>')
    expect(body).toContain('</rss>')
  })

  test('author RSS feed returns 404 for non-existent author', async ({ request }) => {
    const response = await request.get(`${WORKER_URL}/feed/nonexistent-author-that-does-not-exist-12345.xml`)

    // Should return 404 for unknown author
    expect(response.status()).toBe(404)
  })

  test('RSS feed has proper cache headers', async ({ request }) => {
    const response = await request.get(`${WORKER_URL}/feed/recent.xml`)

    const cacheControl = response.headers()['cache-control'] || ''

    // Should have public caching enabled
    expect(cacheControl).toContain('public')

    // Should have browser and CDN cache times
    expect(cacheControl).toMatch(/max-age=\d+/)
    expect(cacheControl).toMatch(/s-maxage=\d+/)
  })

  test('homepage has RSS feed discovery link', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Wait for React to hydrate and set the RSS link
    await page.waitForTimeout(1000)

    // Check for RSS alternate link in head
    const rssLink = page.locator('link[rel="alternate"][type="application/rss+xml"]')
    await expect(rssLink).toHaveAttribute('href', /\/rss$/)
    await expect(rssLink).toHaveAttribute('title', /GreenGale.*Recent Posts/i)
  })

  test('author page has RSS feed discovery link', async ({ page }) => {
    // First, get a valid author handle from the homepage
    await page.goto('/')

    const firstPost = page.locator('article, [data-testid="post-card"]').first()
    await expect(firstPost).toBeVisible({ timeout: 10000 })

    const postLink = firstPost.locator('a').first()
    const href = await postLink.getAttribute('href')

    if (!href) {
      test.skip()
      return
    }

    // Extract handle from URL (format: /handle/rkey)
    const parts = href.split('/').filter(Boolean)
    if (parts.length < 1) {
      test.skip()
      return
    }

    const handle = parts[0]

    // Navigate to author page
    await page.goto(`/${handle}`)
    await page.waitForLoadState('domcontentloaded')

    // Wait for React to hydrate and set the RSS link
    await page.waitForTimeout(1000)

    // Check for RSS alternate link in head
    const rssLink = page.locator('link[rel="alternate"][type="application/rss+xml"]')
    await expect(rssLink).toHaveAttribute('href', new RegExp(`/${handle}/rss$`))
    await expect(rssLink).toHaveAttribute('title', /RSS$/i)
  })

  test('RSS feed items have valid RFC 2822 dates', async ({ request }) => {
    const response = await request.get(`${WORKER_URL}/feed/recent.xml`)
    const body = await response.text()

    // Extract pubDate values
    const pubDateMatches = body.match(/<pubDate>([^<]+)<\/pubDate>/g)

    if (pubDateMatches && pubDateMatches.length > 0) {
      for (const match of pubDateMatches) {
        const dateStr = match.replace(/<\/?pubDate>/g, '')

        // RFC 2822 format: Day, DD Mon YYYY HH:MM:SS GMT
        expect(dateStr).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/)
      }
    }
  })

  test('RSS feed escapes special characters', async ({ request }) => {
    const response = await request.get(`${WORKER_URL}/feed/recent.xml`)
    const body = await response.text()

    // Verify XML is well-formed by checking for proper structure
    // The XML should not contain unescaped & outside of CDATA
    // Split by CDATA sections and check non-CDATA parts
    const nonCdataParts = body.split(/<!\[CDATA\[.*?\]\]>/gs)
    for (const part of nonCdataParts) {
      // Unescaped & should not appear (except in &amp; &lt; &gt; &quot; &apos;)
      const unescapedAmpersands = part.match(/&(?!(amp|lt|gt|quot|apos);)/g)
      expect(unescapedAmpersands).toBeNull()
    }
  })
})
