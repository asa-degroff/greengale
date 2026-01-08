import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('shows login button when not authenticated', async ({ page }) => {
    await page.goto('/')

    // Sign in button should be visible
    const signIn = page.getByRole('button', { name: /sign in|login/i })
      .or(page.getByRole('link', { name: /sign in|login/i }))

    await expect(signIn.first()).toBeVisible()
  })

  test('login button opens auth modal or redirects', async ({ page }) => {
    await page.goto('/')

    const signIn = page.getByRole('button', { name: /sign in|login/i })
      .or(page.getByRole('link', { name: /sign in|login/i }))

    await signIn.first().click()

    // Should either:
    // 1. Open a modal/dropdown with handle input
    // 2. Redirect to OAuth flow
    // 3. Show a handle input inline (in sidebar)

    // Wait briefly for UI to update
    await page.waitForTimeout(500)

    // Check for various auth UI patterns
    const modal = page.locator('[role="dialog"], .modal, [data-testid="auth-modal"]')
    // Look for a second Sign In button (which appears after clicking first one in sidebar auth flow)
    const secondSignIn = page.getByRole('button', { name: /sign in/i }).nth(1)
    const cancelButton = page.getByRole('button', { name: /cancel/i })

    const modalVisible = await modal.isVisible().catch(() => false)
    const secondSignInVisible = await secondSignIn.isVisible().catch(() => false)
    const cancelVisible = await cancelButton.isVisible().catch(() => false)
    const urlChanged = !page.url().endsWith('/')

    // At least one of these should be true (sidebar auth flow shows second Sign In + Cancel)
    const anyAuthUIVisible = modalVisible || secondSignInVisible || cancelVisible || urlChanged
    expect(anyAuthUIVisible).toBe(true)
  })

  test('protected routes redirect unauthenticated users', async ({ page }) => {
    // Try to access editor without auth
    await page.goto('/new')

    // Should either:
    // 1. Redirect to home
    // 2. Show login prompt
    // 3. Show unauthorized message

    await page.waitForLoadState('networkidle')

    const url = page.url()
    const content = await page.locator('body').textContent()

    const redirectedHome = url.endsWith('/') || !url.includes('/new')
    const showsAuthPrompt = /sign in|login|authenticate|unauthorized/i.test(content || '')

    expect(redirectedHome || showsAuthPrompt).toBe(true)
  })

  test('edit route requires authentication', async ({ page }) => {
    // Try to access edit page
    await page.goto('/edit/test-rkey')

    await page.waitForLoadState('networkidle')

    const url = page.url()
    const content = await page.locator('body').textContent()

    const redirected = !url.includes('/edit/')
    const showsAuthPrompt = /sign in|login|authenticate|unauthorized/i.test(content || '')

    expect(redirected || showsAuthPrompt).toBe(true)
  })
})

test.describe('OAuth Callback', () => {
  test('callback page handles missing params', async ({ page }) => {
    // Access callback without params
    await page.goto('/auth/callback')

    // Should handle gracefully (show error or redirect)
    await page.waitForLoadState('networkidle')

    const body = page.locator('body')
    await expect(body).toBeVisible()

    // Should not crash - either shows error or redirects
    const content = await body.textContent()
    expect(content).not.toContain('Uncaught')
  })

  test('callback page handles invalid state', async ({ page }) => {
    // Access callback with invalid params
    await page.goto('/auth/callback?state=invalid&code=invalid')

    await page.waitForLoadState('networkidle')

    // Should handle error gracefully
    const body = page.locator('body')
    await expect(body).toBeVisible()
  })
})

test.describe('Session Persistence', () => {
  test('refreshing page maintains UI state', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Get initial state
    const signInVisible = await page
      .getByRole('button', { name: /sign in/i })
      .or(page.getByRole('link', { name: /sign in/i }))
      .first()
      .isVisible()
      .catch(() => false)

    // Refresh
    await page.reload()
    await page.waitForLoadState('networkidle')

    // State should be consistent
    const signInVisibleAfter = await page
      .getByRole('button', { name: /sign in/i })
      .or(page.getByRole('link', { name: /sign in/i }))
      .first()
      .isVisible()
      .catch(() => false)

    expect(signInVisibleAfter).toBe(signInVisible)
  })
})
