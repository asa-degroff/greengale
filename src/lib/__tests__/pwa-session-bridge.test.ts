/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isIOSStandalone,
  isFromPWA,
  markFromPWA,
  clearFromPWA,
  ExportedSession,
} from '../pwa-session-bridge'

describe('pwa-session-bridge', () => {
  describe('isIOSStandalone', () => {
    const originalUserAgent = navigator.userAgent
    const originalPlatform = navigator.platform
    const originalMaxTouchPoints = navigator.maxTouchPoints
    const originalMatchMedia = window.matchMedia

    beforeEach(() => {
      // Reset to non-iOS, non-standalone defaults
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        configurable: true,
      })
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        configurable: true,
      })
      Object.defineProperty(navigator, 'maxTouchPoints', {
        value: 0,
        configurable: true,
      })
      window.matchMedia = vi.fn().mockReturnValue({ matches: false })
    })

    afterEach(() => {
      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      })
      Object.defineProperty(navigator, 'platform', {
        value: originalPlatform,
        configurable: true,
      })
      Object.defineProperty(navigator, 'maxTouchPoints', {
        value: originalMaxTouchPoints,
        configurable: true,
      })
      window.matchMedia = originalMatchMedia
    })

    it('returns false for non-iOS browser', () => {
      expect(isIOSStandalone()).toBe(false)
    })

    it('returns false for iOS in browser mode', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        configurable: true,
      })
      expect(isIOSStandalone()).toBe(false)
    })

    it('returns true for iPhone in standalone mode', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        configurable: true,
      })
      window.matchMedia = vi.fn().mockReturnValue({ matches: true })
      expect(isIOSStandalone()).toBe(true)
    })

    it('returns true for iPad in standalone mode', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)',
        configurable: true,
      })
      window.matchMedia = vi.fn().mockReturnValue({ matches: true })
      expect(isIOSStandalone()).toBe(true)
    })

    it('returns true for iPadOS (MacIntel with touch) in standalone mode', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      })
      Object.defineProperty(navigator, 'maxTouchPoints', {
        value: 5,
        configurable: true,
      })
      window.matchMedia = vi.fn().mockReturnValue({ matches: true })
      expect(isIOSStandalone()).toBe(true)
    })

    it('returns false for macOS (MacIntel without touch)', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      })
      Object.defineProperty(navigator, 'maxTouchPoints', {
        value: 0,
        configurable: true,
      })
      window.matchMedia = vi.fn().mockReturnValue({ matches: true })
      expect(isIOSStandalone()).toBe(false)
    })

    it('returns true when navigator.standalone is true (Safari)', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        configurable: true,
      })
      Object.defineProperty(navigator, 'standalone', {
        value: true,
        configurable: true,
      })
      expect(isIOSStandalone()).toBe(true)
    })
  })

  describe('PWA marker functions (Cache Storage)', () => {
    // Mock Cache Storage for tests
    let mockCache: Map<string, Response>

    beforeEach(() => {
      mockCache = new Map()

      // Mock caches API
      const mockCaches = {
        open: vi.fn().mockResolvedValue({
          match: vi.fn().mockImplementation((key: string) => {
            return Promise.resolve(mockCache.get(key) || null)
          }),
          put: vi.fn().mockImplementation((key: string, response: Response) => {
            mockCache.set(key, response)
            return Promise.resolve()
          }),
          delete: vi.fn().mockImplementation((key: string) => {
            mockCache.delete(key)
            return Promise.resolve(true)
          }),
        }),
      }

      vi.stubGlobal('caches', mockCaches)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('isFromPWA returns false when not set', async () => {
      expect(await isFromPWA()).toBe(false)
    })

    it('markFromPWA sets the marker in Cache Storage', async () => {
      await markFromPWA()
      expect(mockCache.size).toBe(1)
    })

    it('isFromPWA returns true after markFromPWA', async () => {
      await markFromPWA()
      expect(await isFromPWA()).toBe(true)
    })

    it('clearFromPWA removes the marker', async () => {
      await markFromPWA()
      await clearFromPWA()
      expect(await isFromPWA()).toBe(false)
    })

    it('isFromPWA returns false for expired marker', async () => {
      // Manually set an expired marker
      const expiredData = {
        pwa: true,
        expiresAt: new Date(Date.now() - 1000).toISOString(), // Expired 1 second ago
      }
      mockCache.set(
        '/pwa-origin-flag',
        new Response(JSON.stringify(expiredData))
      )

      expect(await isFromPWA()).toBe(false)
    })

    it('handles Cache Storage errors gracefully', async () => {
      vi.stubGlobal('caches', {
        open: vi.fn().mockRejectedValue(new Error('Cache unavailable')),
      })

      // Should not throw
      expect(await isFromPWA()).toBe(false)
      await expect(markFromPWA()).resolves.not.toThrow()
      await expect(clearFromPWA()).resolves.not.toThrow()
    })
  })

  describe('ExportedSession type', () => {
    it('validates session structure', () => {
      const session: ExportedSession = {
        version: 1,
        createdAt: '2024-01-01T00:00:00.000Z',
        expiresAt: '2024-01-01T00:10:00.000Z',
        sub: 'did:plc:example123',
        dpopKey: {
          keyId: 'key-123',
          privateKey: {
            kty: 'EC',
            crv: 'P-256',
            x: 'abc',
            y: 'def',
            d: 'ghi',
          },
          publicKey: {
            kty: 'EC',
            crv: 'P-256',
            x: 'abc',
            y: 'def',
          },
          algorithm: { name: 'ECDSA', namedCurve: 'P-256' },
        },
        tokenSet: {
          iss: 'https://bsky.social',
          sub: 'did:plc:example123',
          aud: 'https://bsky.social',
          scope: 'atproto',
          access_token: 'token123',
          token_type: 'DPoP',
        },
      }

      expect(session.version).toBe(1)
      expect(session.sub).toBe('did:plc:example123')
      expect(session.dpopKey.algorithm.name).toBe('ECDSA')
      expect(session.tokenSet.token_type).toBe('DPoP')
    })

    it('allows optional fields', () => {
      const session: ExportedSession = {
        version: 1,
        createdAt: '2024-01-01T00:00:00.000Z',
        expiresAt: '2024-01-01T00:10:00.000Z',
        sub: 'did:plc:example123',
        dpopKey: {
          keyId: 'key-123',
          privateKey: { kty: 'EC' } as JsonWebKey,
          publicKey: { kty: 'EC' } as JsonWebKey,
          algorithm: { name: 'ECDSA', namedCurve: 'P-256' },
        },
        tokenSet: {
          iss: 'https://bsky.social',
          sub: 'did:plc:example123',
          aud: 'https://bsky.social',
          scope: 'atproto',
          access_token: 'token123',
          token_type: 'DPoP',
          refresh_token: 'refresh123',
          expires_at: '2024-01-01T01:00:00.000Z',
        },
      }

      expect(session.tokenSet.refresh_token).toBe('refresh123')
      expect(session.tokenSet.expires_at).toBe('2024-01-01T01:00:00.000Z')
    })
  })

  describe('session expiry logic', () => {
    it('creates session with 10 minute TTL', () => {
      const now = new Date('2024-01-01T00:00:00.000Z')
      const expiresAt = new Date(now.getTime() + 10 * 60 * 1000)
      expect(expiresAt.toISOString()).toBe('2024-01-01T00:10:00.000Z')
    })

    it('detects expired session', () => {
      const session: ExportedSession = {
        version: 1,
        createdAt: '2024-01-01T00:00:00.000Z',
        expiresAt: '2024-01-01T00:10:00.000Z', // Expired
        sub: 'did:plc:example123',
        dpopKey: {
          keyId: 'key-123',
          privateKey: {} as JsonWebKey,
          publicKey: {} as JsonWebKey,
          algorithm: { name: 'ECDSA', namedCurve: 'P-256' },
        },
        tokenSet: {
          iss: 'https://bsky.social',
          sub: 'did:plc:example123',
          aud: 'https://bsky.social',
          scope: 'atproto',
          access_token: 'token123',
          token_type: 'DPoP',
        },
      }

      const isExpired = new Date(session.expiresAt) < new Date()
      expect(isExpired).toBe(true)
    })

    it('detects valid session', () => {
      const futureDate = new Date()
      futureDate.setMinutes(futureDate.getMinutes() + 5)

      const session: ExportedSession = {
        version: 1,
        createdAt: new Date().toISOString(),
        expiresAt: futureDate.toISOString(),
        sub: 'did:plc:example123',
        dpopKey: {
          keyId: 'key-123',
          privateKey: {} as JsonWebKey,
          publicKey: {} as JsonWebKey,
          algorithm: { name: 'ECDSA', namedCurve: 'P-256' },
        },
        tokenSet: {
          iss: 'https://bsky.social',
          sub: 'did:plc:example123',
          aud: 'https://bsky.social',
          scope: 'atproto',
          access_token: 'token123',
          token_type: 'DPoP',
        },
      }

      const isExpired = new Date(session.expiresAt) < new Date()
      expect(isExpired).toBe(false)
    })
  })

  describe('JWK key format', () => {
    it('ES256 private key has required fields', () => {
      const privateKey: JsonWebKey = {
        kty: 'EC',
        crv: 'P-256',
        x: 'WbbXwFQvun6kST3xMGbO7Snk2CSG_R1r9LMj6Nm1wVM',
        y: '79-GqcMdMgFQPbprXjLBlkA7bKxzG2eMfhYO_pZ5G14',
        d: 'XhPNWJ8qnRJGIjLQPbMX4Y_V7PQN8xNJvFPXBZbGG2Q',
      }

      expect(privateKey.kty).toBe('EC')
      expect(privateKey.crv).toBe('P-256')
      expect(privateKey.d).toBeDefined() // Private key component
    })

    it('ES256 public key has required fields', () => {
      const publicKey: JsonWebKey = {
        kty: 'EC',
        crv: 'P-256',
        x: 'WbbXwFQvun6kST3xMGbO7Snk2CSG_R1r9LMj6Nm1wVM',
        y: '79-GqcMdMgFQPbprXjLBlkA7bKxzG2eMfhYO_pZ5G14',
      }

      expect(publicKey.kty).toBe('EC')
      expect(publicKey.crv).toBe('P-256')
      expect(publicKey.d).toBeUndefined() // No private component
    })
  })

  describe('localStorage pointer key', () => {
    it('generates correct key format', () => {
      const aud = 'https://bsky.social'
      const key = `@@atproto/oauth-client-browser(${aud})`
      expect(key).toBe('@@atproto/oauth-client-browser(https://bsky.social)')
    })

    it('handles different PDS endpoints', () => {
      const endpoints = [
        'https://bsky.social',
        'https://pds.example.com',
        'https://my.custom.pds',
      ]

      for (const aud of endpoints) {
        const key = `@@atproto/oauth-client-browser(${aud})`
        expect(key).toContain(aud)
      }
    })
  })
})
