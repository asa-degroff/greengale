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

})
