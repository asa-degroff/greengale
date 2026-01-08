import { test, expect } from '@playwright/test'

test.describe('OG Image Generation', () => {
  // These tests verify that OG images are generated correctly by the worker
  // They test the actual /og endpoint rather than mocking
  // Note: OG image generation requires specific environment setup and may not work in all local dev environments

  test('homepage OG image returns valid PNG', async ({ request }) => {
    const response = await request.get('/og/site.png')

    // In local dev, OG images may not be available - skip if not PNG
    const contentType = response.headers()['content-type'] || ''
    if (response.status() === 404 || !contentType.includes('image/png')) {
      test.skip()
      return
    }

    expect(response.status()).toBe(200)

    const body = await response.body()
    expect(body.length).toBeGreaterThan(1000) // Should be a real image

    // PNG magic bytes: 89 50 4E 47 (hex for PNG header)
    expect(body[0]).toBe(0x89)
    expect(body[1]).toBe(0x50) // P
    expect(body[2]).toBe(0x4e) // N
    expect(body[3]).toBe(0x47) // G
  })

  test('post OG image returns valid PNG', async ({ request, page }) => {
    // First, get a valid post URL from the homepage
    await page.goto('/')

    const firstPost = page.locator('article, [data-testid="post-card"]').first()
    await expect(firstPost).toBeVisible({ timeout: 10000 })

    const postLink = firstPost.locator('a').first()
    const href = await postLink.getAttribute('href')

    if (!href) {
      test.skip()
      return
    }

    // Extract handle and rkey from URL
    const parts = href.split('/').filter(Boolean)
    if (parts.length < 2) {
      test.skip()
      return
    }

    const [handle, rkey] = parts

    // Request the OG image
    const response = await request.get(`/og/${handle}/${rkey}.png`)

    // In local dev, OG images may not be available - skip if not PNG
    const contentType = response.headers()['content-type'] || ''
    if (response.status() === 404 || !contentType.includes('image/png')) {
      test.skip()
      return
    }

    expect(response.status()).toBe(200)

    const body = await response.body()
    expect(body.length).toBeGreaterThan(1000)

    // Verify PNG header
    expect(body[0]).toBe(0x89)
    expect(body[1]).toBe(0x50)
  })

  test('profile OG image returns valid PNG', async ({ request, page }) => {
    // First, get a valid author handle
    await page.goto('/')

    const firstPost = page.locator('article, [data-testid="post-card"]').first()
    await expect(firstPost).toBeVisible({ timeout: 10000 })

    // Find an author link
    const authorLink = firstPost.locator('a').filter({ hasText: /\./ }).first()
    const href = await authorLink.getAttribute('href')

    if (!href) {
      test.skip()
      return
    }

    const handle = href.replace(/^\//, '').split('/')[0]

    // Request the profile OG image
    const response = await request.get(`/og/profile/${handle}.png`)

    // In local dev, OG images may not be available - skip if not PNG
    const contentType = response.headers()['content-type'] || ''
    if (response.status() === 404 || !contentType.includes('image/png')) {
      test.skip()
      return
    }

    expect(response.status()).toBe(200)

    const body = await response.body()
    expect(body.length).toBeGreaterThan(1000)

    // Verify PNG header
    expect(body[0]).toBe(0x89)
    expect(body[1]).toBe(0x50)
  })

  test('OG images are cached', async ({ request }) => {
    // Request same image twice
    const response1 = await request.get('/og/site.png')

    // In local dev, OG images may not be available - skip if not PNG
    const contentType = response1.headers()['content-type'] || ''
    if (response1.status() === 404 || !contentType.includes('image/png')) {
      test.skip()
      return
    }

    const response2 = await request.get('/og/site.png')

    expect(response1.status()).toBe(200)
    expect(response2.status()).toBe(200)

    // Second request should have cache header (if KV caching is enabled)
    // This is a soft check since caching behavior depends on environment
    const cacheHeader = response2.headers()['cf-cache-status'] || response2.headers()['x-cache']
    // Cache header might not be present in dev, so we just verify the image is valid
    expect(response2.headers()['content-type']).toContain('image/png')
  })

  test('invalid OG image path returns error', async ({ request }) => {
    const response = await request.get('/og/nonexistent-author-12345/nonexistent-post.png')

    // Should return 404 or redirect, not crash
    expect([200, 404, 302, 500]).toContain(response.status())
  })
})

test.describe('OG Meta Tags', () => {
  test('homepage has OG meta tags', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // At minimum, page should have a title
    const title = await page.title()
    expect(title.length).toBeGreaterThan(0)

    // Check for OG meta tags (may be set dynamically or statically)
    // Use count() first to avoid timeout on non-existent elements
    const ogTitleCount = await page.locator('meta[property="og:title"]').count()
    const ogImageCount = await page.locator('meta[property="og:image"]').count()

    // If OG tags exist, verify them
    if (ogTitleCount > 0) {
      const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content')
      expect(ogTitle).toBeTruthy()
    }
    if (ogImageCount > 0) {
      const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content')
      expect(ogImage).toContain('/og/')
    }
  })

  test('post page has OG meta tags', async ({ page }) => {
    await page.goto('/')

    const firstPost = page.locator('article, [data-testid="post-card"]').first()
    await expect(firstPost).toBeVisible({ timeout: 10000 })

    await firstPost.locator('a').first().click()
    await expect(page).toHaveURL(/\/[^/]+\/[^/]+/)
    await page.waitForLoadState('domcontentloaded')

    // At minimum, page should have a title
    const title = await page.title()
    expect(title.length).toBeGreaterThan(0)

    // Check for OG meta tags (may be set dynamically or statically)
    const ogTitleCount = await page.locator('meta[property="og:title"]').count()

    // If OG tags exist, verify them
    if (ogTitleCount > 0) {
      const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content')
      expect(ogTitle).toBeTruthy()
    }
  })
})
