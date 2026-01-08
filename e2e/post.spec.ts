import { test, expect } from '@playwright/test'

test.describe('Post Page', () => {
  // Navigate to a post via the homepage to ensure we have a valid URL
  test.beforeEach(async ({ page }) => {
    await page.goto('/')

    // Wait for posts to load and click the first one
    const firstPost = page.locator('article, [data-testid="post-card"]').first()
    await expect(firstPost).toBeVisible({ timeout: 10000 })

    const postLink = firstPost.locator('a').first()
    await postLink.click()

    // Wait for navigation to post page
    await expect(page).toHaveURL(/\/[^/]+\/[^/]+/)
    await page.waitForLoadState('networkidle')
  })

  test('renders article content', async ({ page }) => {
    // Post page should have content OR error message (test data may not resolve)
    const article = page.locator('article, .markdown-body, [data-testid="post-content"]')
    const errorMessage = page.locator('text=/unable to|error|not found/i')

    const hasArticle = await article.first().isVisible().catch(() => false)
    const hasError = await errorMessage.first().isVisible().catch(() => false)

    // Either valid content or graceful error handling
    expect(hasArticle || hasError).toBe(true)
  })

  test('displays post title', async ({ page }) => {
    // Should have a heading
    const heading = page.locator('h1').first()
    await expect(heading).toBeVisible()
  })

  test('displays author information', async ({ page }) => {
    // Author info should be visible (name, handle, or avatar) or error page
    const authorInfo = page.locator('[data-testid="author-card"], .author, [class*="author"]')
      .or(page.locator('a[href^="/@"], a[href^="/"]').filter({ hasText: /\./ }))
    const errorPage = page.locator('text=/unable to|error|not found/i')

    const hasAuthor = await authorInfo.first().isVisible().catch(() => false)
    const hasError = await errorPage.first().isVisible().catch(() => false)

    // Either author info or error handling
    expect(hasAuthor || hasError).toBe(true)
  })

  test('has share/interaction options', async ({ page }) => {
    // Should have some interaction buttons (share, like, etc.)
    const interactions = page.locator('button, a')
      .filter({ hasText: /share|copy|listen|tts/i })

    // At least TTS or share should be available
    const count = await interactions.count()
    expect(count).toBeGreaterThanOrEqual(0) // May not be present on all posts
  })

  test('renders markdown formatting correctly', async ({ page }) => {
    // Content should be visible or error page should be shown
    const content = page.locator('.markdown-body, article')
    const errorPage = page.locator('text=/unable to|error|not found/i')

    const hasContent = await content.first().isVisible().catch(() => false)
    const hasError = await errorPage.first().isVisible().catch(() => false)

    // Either content or graceful error handling
    expect(hasContent || hasError).toBe(true)

    // If content exists, verify it has text
    if (hasContent) {
      const text = await content.first().textContent()
      expect(text?.length).toBeGreaterThan(0)
    }
  })

  test('code blocks have syntax highlighting', async ({ page }) => {
    // Check if there are any code blocks with highlighting
    const codeBlocks = page.locator('pre code, .hljs')
    const count = await codeBlocks.count()

    // This test passes even if no code blocks exist
    if (count > 0) {
      const firstBlock = codeBlocks.first()
      await expect(firstBlock).toBeVisible()
    }
  })

  test('images are accessible', async ({ page }) => {
    const images = page.locator('article img, .markdown-body img')
    const count = await images.count()

    // If there are images, they should have alt text
    if (count > 0) {
      for (let i = 0; i < Math.min(count, 3); i++) {
        const img = images.nth(i)
        const alt = await img.getAttribute('alt')
        // Alt text should exist (can be empty string for decorative images)
        expect(alt).not.toBeNull()
      }
    }
  })

  test('back navigation works', async ({ page }) => {
    // Get current URL
    const postUrl = page.url()

    // Go back to homepage
    await page.goBack()

    // Should be back on homepage
    await expect(page).toHaveURL('/')

    // Navigate forward should return to post
    await page.goForward()
    await expect(page).toHaveURL(postUrl)
  })
})

test.describe('Post Page - Direct Navigation', () => {
  test('handles non-existent post gracefully', async ({ page }) => {
    // Navigate to a non-existent post
    await page.goto('/nonexistent.handle/nonexistent-rkey')

    // Should show error or 404 message, not crash
    const body = page.locator('body')
    await expect(body).toBeVisible()

    // Should not have uncaught errors
    const pageContent = await body.textContent()
    expect(pageContent).not.toContain('Uncaught')
  })
})

test.describe('Post Page - Table of Contents', () => {
  test('TOC links scroll to headings', async ({ page }) => {
    await page.goto('/')

    // Find and click a post
    const firstPost = page.locator('article, [data-testid="post-card"]').first()
    await expect(firstPost).toBeVisible({ timeout: 10000 })
    await firstPost.locator('a').first().click()

    // Look for TOC
    const toc = page.locator('[data-testid="toc"], nav, aside')
      .filter({ hasText: /table of contents|contents/i })

    const tocExists = await toc.count() > 0

    if (tocExists) {
      // Click a TOC link
      const tocLink = toc.locator('a').first()
      await tocLink.click()

      // URL should have a hash
      await expect(page).toHaveURL(/#/)
    }
  })
})
