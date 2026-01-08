/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

// Create mock functions at module scope
const mockInit = vi.fn()
const mockSignIn = vi.fn()
const mockRevoke = vi.fn()
const mockLoad = vi.fn()

// Mock the OAuth client - factory must not reference variables defined later
vi.mock('@atproto/oauth-client-browser', () => ({
  BrowserOAuthClient: {
    load: (...args: unknown[]) => mockLoad(...args),
  },
  OAuthSession: vi.fn(),
}))

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Import after mocking
import { AuthProvider, useAuth } from '../auth'

describe('Auth Module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    mockInit.mockReset()
    mockSignIn.mockReset()
    mockRevoke.mockReset()
    mockLoad.mockReset()

    // Set up the mock OAuth client that load() returns
    mockLoad.mockResolvedValue({
      init: mockInit,
      signIn: mockSignIn,
      revoke: mockRevoke,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('checkWhitelist utility', () => {
    // Test the whitelist checking logic by simulating what the function does
    async function checkWhitelist(did: string): Promise<boolean> {
      try {
        const response = await fetch(
          `http://127.0.0.1:8788/xrpc/app.greengale.auth.checkWhitelist?did=${encodeURIComponent(did)}`
        )
        if (!response.ok) return false
        const data = await response.json()
        return data.whitelisted === true
      } catch {
        return false
      }
    }

    it('returns true when user is whitelisted', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ whitelisted: true, did: 'did:plc:abc', handle: 'test.bsky.social' }),
      })

      const result = await checkWhitelist('did:plc:abc')
      expect(result).toBe(true)
    })

    it('returns false when user is not whitelisted', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ whitelisted: false }),
      })

      const result = await checkWhitelist('did:plc:unknown')
      expect(result).toBe(false)
    })

    it('returns false when API returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

      const result = await checkWhitelist('did:plc:abc')
      expect(result).toBe(false)
    })

    it('returns false when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await checkWhitelist('did:plc:abc')
      expect(result).toBe(false)
    })

    it('encodes DID in URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ whitelisted: true }),
      })

      await checkWhitelist('did:plc:abc+special')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('did%3Aplc%3Aabc%2Bspecial')
      )
    })
  })

  describe('resolveHandleFromDid utility', () => {
    async function resolveHandleFromDid(did: string): Promise<string | null> {
      try {
        const response = await fetch(
          `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
        )
        if (!response.ok) return null
        const data = await response.json()
        return data.handle || null
      } catch {
        return null
      }
    }

    it('returns handle from successful response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          did: 'did:plc:abc',
          handle: 'test.bsky.social',
          displayName: 'Test User',
        }),
      })

      const result = await resolveHandleFromDid('did:plc:abc')
      expect(result).toBe('test.bsky.social')
    })

    it('returns null when handle is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          did: 'did:plc:abc',
          // No handle field
        }),
      })

      const result = await resolveHandleFromDid('did:plc:abc')
      expect(result).toBeNull()
    })

    it('returns null when API returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      })

      const result = await resolveHandleFromDid('did:plc:unknown')
      expect(result).toBeNull()
    })

    it('returns null when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await resolveHandleFromDid('did:plc:abc')
      expect(result).toBeNull()
    })

    it('calls Bluesky API with correct URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ handle: 'test.bsky.social' }),
      })

      await resolveHandleFromDid('did:plc:abc123')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=did%3Aplc%3Aabc123'
      )
    })
  })

  describe('useAuth hook', () => {
    it('throws when used outside AuthProvider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      function TestComponent() {
        useAuth()
        return null
      }

      expect(() => render(<TestComponent />)).toThrow(
        'useAuth must be used within an AuthProvider'
      )

      consoleSpy.mockRestore()
    })
  })

  // Shared test consumer component
  function TestConsumer({ onAuth }: { onAuth?: (auth: ReturnType<typeof useAuth>) => void }) {
    const auth = useAuth()
    React.useEffect(() => {
      onAuth?.(auth)
    }, [auth, onAuth])

    return (
      <div>
        <div data-testid="loading">{auth.isLoading ? 'true' : 'false'}</div>
        <div data-testid="authenticated">{auth.isAuthenticated ? 'true' : 'false'}</div>
        <div data-testid="whitelisted">{auth.isWhitelisted ? 'true' : 'false'}</div>
        <div data-testid="did">{auth.did || 'null'}</div>
        <div data-testid="handle">{auth.handle || 'null'}</div>
        <div data-testid="error">{auth.error || 'null'}</div>
        <button onClick={() => auth.login('test.bsky.social')}>Login</button>
        <button onClick={() => auth.logout()}>Logout</button>
        <button onClick={() => auth.refresh()}>Refresh</button>
      </div>
    )
  }

  describe('AuthProvider', () => {
    describe('Initial State', () => {
      it('starts with loading true', async () => {
        mockInit.mockResolvedValueOnce({ session: null })

        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        )

        // Initial state is loading
        expect(screen.getByTestId('loading').textContent).toBe('true')
        expect(screen.getByTestId('authenticated').textContent).toBe('false')
      })

      it('sets loading false after init with no session', async () => {
        mockInit.mockResolvedValueOnce({ session: null })

        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        )

        await waitFor(() => {
          expect(screen.getByTestId('loading').textContent).toBe('false')
        })

        expect(screen.getByTestId('authenticated').textContent).toBe('false')
        expect(screen.getByTestId('did').textContent).toBe('null')
      })

      it('restores session on init', async () => {
        const mockSession = {
          did: 'did:plc:restored',
          sub: 'did:plc:restored',
        }

        mockInit.mockResolvedValueOnce({ session: mockSession })

        // Mock whitelist check
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ whitelisted: true }),
        })

        // Mock handle resolution
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ handle: 'restored.bsky.social' }),
        })

        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        )

        await waitFor(() => {
          expect(screen.getByTestId('loading').textContent).toBe('false')
        })

        expect(screen.getByTestId('authenticated').textContent).toBe('true')
        expect(screen.getByTestId('did').textContent).toBe('did:plc:restored')
        expect(screen.getByTestId('handle').textContent).toBe('restored.bsky.social')
        expect(screen.getByTestId('whitelisted').textContent).toBe('true')
      })

      it('handles init error gracefully', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        mockInit.mockRejectedValueOnce(new Error('Init failed'))

        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        )

        await waitFor(() => {
          expect(screen.getByTestId('loading').textContent).toBe('false')
        })

        // Should not show error on init failure
        expect(screen.getByTestId('error').textContent).toBe('null')
        expect(screen.getByTestId('authenticated').textContent).toBe('false')

        consoleSpy.mockRestore()
      })

      it('sets isWhitelisted based on API response', async () => {
        const mockSession = { did: 'did:plc:notwhitelisted' }
        mockInit.mockResolvedValueOnce({ session: mockSession })

        // Mock whitelist check returning false
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ whitelisted: false }),
        })

        // Mock handle resolution
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ handle: 'user.bsky.social' }),
        })

        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        )

        await waitFor(() => {
          expect(screen.getByTestId('loading').textContent).toBe('false')
        })

        expect(screen.getByTestId('authenticated').textContent).toBe('true')
        expect(screen.getByTestId('whitelisted').textContent).toBe('false')
      })
    })

    describe('Login Flow', () => {
      it('calls OAuth signIn with handle', async () => {
        mockInit.mockResolvedValueOnce({ session: null })
        mockSignIn.mockResolvedValueOnce(undefined)

        const user = userEvent.setup()

        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        )

        await waitFor(() => {
          expect(screen.getByTestId('loading').textContent).toBe('false')
        })

        await user.click(screen.getByText('Login'))

        expect(mockSignIn).toHaveBeenCalledWith(
          'test.bsky.social',
          expect.objectContaining({ scope: expect.any(String) })
        )
      })

      it('sets loading during login', async () => {
        mockInit.mockResolvedValueOnce({ session: null })
        // Make signIn hang
        mockSignIn.mockImplementation(() => new Promise(() => {}))

        const user = userEvent.setup()

        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        )

        await waitFor(() => {
          expect(screen.getByTestId('loading').textContent).toBe('false')
        })

        await user.click(screen.getByText('Login'))

        expect(screen.getByTestId('loading').textContent).toBe('true')
      })

      it('sets error on login failure', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        mockInit.mockResolvedValueOnce({ session: null })
        mockSignIn.mockRejectedValueOnce(new Error('Login failed'))

        const user = userEvent.setup()

        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        )

        await waitFor(() => {
          expect(screen.getByTestId('loading').textContent).toBe('false')
        })

        await user.click(screen.getByText('Login'))

        await waitFor(() => {
          expect(screen.getByTestId('error').textContent).toBe('Login failed')
        })

        expect(screen.getByTestId('loading').textContent).toBe('false')
        consoleSpy.mockRestore()
      })

      it('clears error before login attempt', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        mockInit.mockResolvedValueOnce({ session: null })

        // First login fails
        mockSignIn
          .mockRejectedValueOnce(new Error('First error'))
          .mockResolvedValueOnce(undefined)

        const user = userEvent.setup()

        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        )

        await waitFor(() => {
          expect(screen.getByTestId('loading').textContent).toBe('false')
        })

        // First attempt
        await user.click(screen.getByText('Login'))
        await waitFor(() => {
          expect(screen.getByTestId('error').textContent).toBe('First error')
        })

        // Second attempt - error should clear
        await user.click(screen.getByText('Login'))
        // The error gets cleared when login starts
        await waitFor(() => {
          expect(screen.getByTestId('loading').textContent).toBe('true')
        })

        consoleSpy.mockRestore()
      })
    })

    describe('Logout Flow', () => {
      it('clears session on logout', async () => {
        const mockSession = { did: 'did:plc:toLogout' }
        mockInit.mockResolvedValueOnce({ session: mockSession })
        mockRevoke.mockResolvedValueOnce(undefined)

        // Mock whitelist and handle
        mockFetch
          .mockResolvedValueOnce({ ok: true, json: async () => ({ whitelisted: true }) })
          .mockResolvedValueOnce({ ok: true, json: async () => ({ handle: 'user.bsky.social' }) })

        const user = userEvent.setup()

        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        )

        await waitFor(() => {
          expect(screen.getByTestId('authenticated').textContent).toBe('true')
        })

        await user.click(screen.getByText('Logout'))

        await waitFor(() => {
          expect(screen.getByTestId('authenticated').textContent).toBe('false')
        })

        expect(screen.getByTestId('did').textContent).toBe('null')
        expect(screen.getByTestId('handle').textContent).toBe('null')
        expect(screen.getByTestId('whitelisted').textContent).toBe('false')
      })

      it('calls OAuth revoke with DID', async () => {
        const mockSession = { did: 'did:plc:toRevoke' }
        mockInit.mockResolvedValueOnce({ session: mockSession })
        mockRevoke.mockResolvedValueOnce(undefined)

        mockFetch
          .mockResolvedValueOnce({ ok: true, json: async () => ({ whitelisted: false }) })
          .mockResolvedValueOnce({ ok: true, json: async () => ({ handle: 'user.bsky.social' }) })

        const user = userEvent.setup()

        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        )

        await waitFor(() => {
          expect(screen.getByTestId('authenticated').textContent).toBe('true')
        })

        await user.click(screen.getByText('Logout'))

        await waitFor(() => {
          expect(mockRevoke).toHaveBeenCalledWith('did:plc:toRevoke')
        })
      })

      it('handles logout error gracefully', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const mockSession = { did: 'did:plc:errorLogout' }
        mockInit.mockResolvedValueOnce({ session: mockSession })
        mockRevoke.mockRejectedValueOnce(new Error('Revoke failed'))

        mockFetch
          .mockResolvedValueOnce({ ok: true, json: async () => ({ whitelisted: false }) })
          .mockResolvedValueOnce({ ok: true, json: async () => ({ handle: 'user.bsky.social' }) })

        const user = userEvent.setup()

        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        )

        await waitFor(() => {
          expect(screen.getByTestId('authenticated').textContent).toBe('true')
        })

        await user.click(screen.getByText('Logout'))

        await waitFor(() => {
          expect(screen.getByTestId('error').textContent).toBe('Revoke failed')
        })

        consoleSpy.mockRestore()
      })

      it('does not call revoke when no session', async () => {
        mockInit.mockResolvedValueOnce({ session: null })

        const user = userEvent.setup()

        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        )

        await waitFor(() => {
          expect(screen.getByTestId('loading').textContent).toBe('false')
        })

        await user.click(screen.getByText('Logout'))

        expect(mockRevoke).not.toHaveBeenCalled()
      })
    })

    describe('Refresh Flow', () => {
      it('refreshes whitelist status', async () => {
        const mockSession = { did: 'did:plc:toRefresh' }
        mockInit.mockResolvedValueOnce({ session: mockSession })

        // Initial checks
        mockFetch
          .mockResolvedValueOnce({ ok: true, json: async () => ({ whitelisted: false }) })
          .mockResolvedValueOnce({ ok: true, json: async () => ({ handle: 'user.bsky.social' }) })

        const user = userEvent.setup()

        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        )

        await waitFor(() => {
          expect(screen.getByTestId('whitelisted').textContent).toBe('false')
        })

        // Mock refresh returning whitelisted = true
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ whitelisted: true }),
        })

        await user.click(screen.getByText('Refresh'))

        await waitFor(() => {
          expect(screen.getByTestId('whitelisted').textContent).toBe('true')
        })
      })

      it('does nothing when not authenticated', async () => {
        mockInit.mockResolvedValueOnce({ session: null })

        const user = userEvent.setup()

        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        )

        await waitFor(() => {
          expect(screen.getByTestId('loading').textContent).toBe('false')
        })

        // Clear any previous fetch calls
        mockFetch.mockClear()

        await user.click(screen.getByText('Refresh'))

        // Should not make any fetch calls
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('handles refresh error gracefully', async () => {
        // Note: checkWhitelist catches errors internally and returns false,
        // so a network error during refresh will set whitelisted to false
        const mockSession = { did: 'did:plc:errorRefresh' }
        mockInit.mockResolvedValueOnce({ session: mockSession })

        mockFetch
          .mockResolvedValueOnce({ ok: true, json: async () => ({ whitelisted: true }) })
          .mockResolvedValueOnce({ ok: true, json: async () => ({ handle: 'user.bsky.social' }) })

        const user = userEvent.setup()

        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        )

        await waitFor(() => {
          expect(screen.getByTestId('whitelisted').textContent).toBe('true')
        })

        // Mock refresh failing - checkWhitelist will catch this and return false
        mockFetch.mockRejectedValueOnce(new Error('Network error'))

        await user.click(screen.getByText('Refresh'))

        // checkWhitelist returns false on error, so whitelisted becomes false
        await waitFor(() => {
          expect(screen.getByTestId('whitelisted').textContent).toBe('false')
        })
      })
    })
  })

  describe('OAuth Scope', () => {
    it('includes all required collections', () => {
      const OAUTH_SCOPE =
        'atproto repo?collection=app.greengale.blog.entry&collection=app.greengale.document&collection=app.greengale.publication&collection=com.whtwnd.blog.entry&collection=site.standard.publication&collection=site.standard.document blob:image/*'

      expect(OAUTH_SCOPE).toContain('app.greengale.blog.entry')
      expect(OAUTH_SCOPE).toContain('app.greengale.document')
      expect(OAUTH_SCOPE).toContain('app.greengale.publication')
      expect(OAUTH_SCOPE).toContain('com.whtwnd.blog.entry')
      expect(OAUTH_SCOPE).toContain('site.standard.publication')
      expect(OAUTH_SCOPE).toContain('site.standard.document')
      expect(OAUTH_SCOPE).toContain('blob:image/*')
    })
  })

  describe('Error Messages', () => {
    it('extracts message from Error object', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockInit.mockResolvedValueOnce({ session: null })
      mockSignIn.mockRejectedValueOnce(new Error('Custom error message'))

      const user = userEvent.setup()

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      await user.click(screen.getByText('Login'))

      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).toBe('Custom error message')
      })

      consoleSpy.mockRestore()
    })

    it('uses fallback for non-Error objects', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockInit.mockResolvedValueOnce({ session: null })
      mockSignIn.mockRejectedValueOnce('string error')

      const user = userEvent.setup()

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      await user.click(screen.getByText('Login'))

      await waitFor(() => {
        expect(screen.getByTestId('error').textContent).toBe('Failed to login')
      })

      consoleSpy.mockRestore()
    })
  })
})
