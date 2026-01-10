/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import {
  useDocumentMeta,
  buildPostCanonical,
  buildAuthorCanonical,
  buildHomeCanonical,
  buildPostOgImage,
  buildAuthorOgImage,
  buildHomeOgImage,
} from '../useDocumentMeta'

describe('useDocumentMeta helper functions', () => {
  describe('buildPostCanonical', () => {
    it('builds canonical URL for a post', () => {
      expect(buildPostCanonical('alice.bsky.social', '3abc123')).toBe(
        'https://greengale.app/alice.bsky.social/3abc123'
      )
    })

    it('handles handles with dots', () => {
      expect(buildPostCanonical('my.custom.domain', 'post-rkey')).toBe(
        'https://greengale.app/my.custom.domain/post-rkey'
      )
    })

    it('handles simple handles', () => {
      expect(buildPostCanonical('bob', 'xyz')).toBe(
        'https://greengale.app/bob/xyz'
      )
    })
  })

  describe('buildAuthorCanonical', () => {
    it('builds canonical URL for an author', () => {
      expect(buildAuthorCanonical('alice.bsky.social')).toBe(
        'https://greengale.app/alice.bsky.social'
      )
    })

    it('handles custom domains', () => {
      expect(buildAuthorCanonical('alice.example.com')).toBe(
        'https://greengale.app/alice.example.com'
      )
    })
  })

  describe('buildHomeCanonical', () => {
    it('returns the base URL', () => {
      expect(buildHomeCanonical()).toBe('https://greengale.app')
    })
  })

  describe('buildPostOgImage', () => {
    it('builds OG image URL for a post', () => {
      expect(buildPostOgImage('alice.bsky.social', '3abc123')).toBe(
        'https://greengale.asadegroff.workers.dev/og/alice.bsky.social/3abc123.png'
      )
    })

    it('handles various rkeys', () => {
      expect(buildPostOgImage('user', 'my-post-rkey')).toBe(
        'https://greengale.asadegroff.workers.dev/og/user/my-post-rkey.png'
      )
    })
  })

  describe('buildAuthorOgImage', () => {
    it('builds OG image URL for an author profile', () => {
      expect(buildAuthorOgImage('alice.bsky.social')).toBe(
        'https://greengale.asadegroff.workers.dev/og/profile/alice.bsky.social.png'
      )
    })
  })

  describe('buildHomeOgImage', () => {
    it('returns the site OG image URL', () => {
      expect(buildHomeOgImage()).toBe(
        'https://greengale.asadegroff.workers.dev/og/site.png'
      )
    })
  })
})

describe('useDocumentMeta hook', () => {
  let originalTitle: string

  beforeEach(() => {
    // Store original title
    originalTitle = document.title

    // Clear any existing meta tags and link tags
    document.querySelectorAll('meta[name], meta[property], link[rel="canonical"]').forEach(el => el.remove())
  })

  afterEach(() => {
    cleanup()
    // Restore original title
    document.title = originalTitle
  })

  describe('title', () => {
    it('sets document title with site name suffix', () => {
      renderHook(() => useDocumentMeta({ title: 'My Post' }))
      expect(document.title).toBe('My Post - GreenGale')
    })

    it('does not double-append site name if already present', () => {
      renderHook(() => useDocumentMeta({ title: 'My Post - GreenGale' }))
      expect(document.title).toBe('My Post - GreenGale')
    })

    it('restores original title on unmount', () => {
      document.title = 'Original Title'
      const { unmount } = renderHook(() => useDocumentMeta({ title: 'New Title' }))

      expect(document.title).toBe('New Title - GreenGale')

      unmount()

      expect(document.title).toBe('Original Title')
    })

    it('sets og:title meta tag', () => {
      renderHook(() => useDocumentMeta({ title: 'My Post' }))

      const ogTitle = document.querySelector('meta[property="og:title"]')
      expect(ogTitle).not.toBeNull()
      expect(ogTitle?.getAttribute('content')).toBe('My Post')
    })
  })

  describe('canonical', () => {
    it('adds canonical link tag', () => {
      renderHook(() => useDocumentMeta({
        canonical: 'https://greengale.app/alice/post123',
      }))

      const canonical = document.querySelector('link[rel="canonical"]')
      expect(canonical).not.toBeNull()
      expect(canonical?.getAttribute('href')).toBe('https://greengale.app/alice/post123')
    })

    it('sets og:url meta tag', () => {
      renderHook(() => useDocumentMeta({
        canonical: 'https://greengale.app/alice/post123',
      }))

      const ogUrl = document.querySelector('meta[property="og:url"]')
      expect(ogUrl).not.toBeNull()
      expect(ogUrl?.getAttribute('content')).toBe('https://greengale.app/alice/post123')
    })

    it('removes canonical link on unmount', () => {
      const { unmount } = renderHook(() => useDocumentMeta({
        canonical: 'https://greengale.app/test',
      }))

      expect(document.querySelector('link[rel="canonical"]')).not.toBeNull()

      unmount()

      expect(document.querySelector('link[rel="canonical"]')).toBeNull()
    })

    it('updates canonical when props change', () => {
      const { rerender } = renderHook(
        ({ canonical }) => useDocumentMeta({ canonical }),
        { initialProps: { canonical: 'https://greengale.app/old' } }
      )

      expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        'https://greengale.app/old'
      )

      rerender({ canonical: 'https://greengale.app/new' })

      expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        'https://greengale.app/new'
      )
    })
  })

  describe('description', () => {
    it('sets meta description', () => {
      renderHook(() => useDocumentMeta({
        description: 'This is a test description',
      }))

      const description = document.querySelector('meta[name="description"]')
      expect(description).not.toBeNull()
      expect(description?.getAttribute('content')).toBe('This is a test description')
    })

    it('sets og:description meta tag', () => {
      renderHook(() => useDocumentMeta({
        description: 'This is a test description',
      }))

      const ogDescription = document.querySelector('meta[property="og:description"]')
      expect(ogDescription).not.toBeNull()
      expect(ogDescription?.getAttribute('content')).toBe('This is a test description')
    })

    it('removes description meta tags on unmount', () => {
      const { unmount } = renderHook(() => useDocumentMeta({
        description: 'Test description',
      }))

      expect(document.querySelector('meta[name="description"]')).not.toBeNull()

      unmount()

      expect(document.querySelector('meta[name="description"]')).toBeNull()
    })
  })

  describe('ogImage', () => {
    it('sets og:image meta tag', () => {
      renderHook(() => useDocumentMeta({
        ogImage: 'https://example.com/image.png',
      }))

      const ogImage = document.querySelector('meta[property="og:image"]')
      expect(ogImage).not.toBeNull()
      expect(ogImage?.getAttribute('content')).toBe('https://example.com/image.png')
    })

    it('removes og:image on unmount', () => {
      const { unmount } = renderHook(() => useDocumentMeta({
        ogImage: 'https://example.com/image.png',
      }))

      expect(document.querySelector('meta[property="og:image"]')).not.toBeNull()

      unmount()

      expect(document.querySelector('meta[property="og:image"]')).toBeNull()
    })
  })

  describe('ogType', () => {
    it('defaults to website', () => {
      renderHook(() => useDocumentMeta({}))

      const ogType = document.querySelector('meta[property="og:type"]')
      expect(ogType).not.toBeNull()
      expect(ogType?.getAttribute('content')).toBe('website')
    })

    it('can be set to article', () => {
      renderHook(() => useDocumentMeta({ ogType: 'article' }))

      const ogType = document.querySelector('meta[property="og:type"]')
      expect(ogType?.getAttribute('content')).toBe('article')
    })
  })

  describe('noindex', () => {
    it('adds robots noindex meta tag when true', () => {
      renderHook(() => useDocumentMeta({ noindex: true }))

      const robots = document.querySelector('meta[name="robots"]')
      expect(robots).not.toBeNull()
      expect(robots?.getAttribute('content')).toBe('noindex, nofollow')
    })

    it('does not add robots meta tag when false', () => {
      renderHook(() => useDocumentMeta({ noindex: false }))

      const robots = document.querySelector('meta[name="robots"]')
      expect(robots).toBeNull()
    })

    it('removes robots meta tag on unmount', () => {
      const { unmount } = renderHook(() => useDocumentMeta({ noindex: true }))

      expect(document.querySelector('meta[name="robots"]')).not.toBeNull()

      unmount()

      expect(document.querySelector('meta[name="robots"]')).toBeNull()
    })
  })

  describe('og:site_name', () => {
    it('always sets og:site_name to GreenGale', () => {
      renderHook(() => useDocumentMeta({}))

      const ogSiteName = document.querySelector('meta[property="og:site_name"]')
      expect(ogSiteName).not.toBeNull()
      expect(ogSiteName?.getAttribute('content')).toBe('GreenGale')
    })
  })

  describe('combined usage', () => {
    it('sets all metadata at once', () => {
      renderHook(() => useDocumentMeta({
        title: 'My Blog Post',
        canonical: 'https://greengale.app/alice/post123',
        description: 'A great post about things',
        ogImage: 'https://greengale.asadegroff.workers.dev/og/alice/post123.png',
        ogType: 'article',
      }))

      expect(document.title).toBe('My Blog Post - GreenGale')
      expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        'https://greengale.app/alice/post123'
      )
      expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
        'A great post about things'
      )
      expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(
        'My Blog Post'
      )
      expect(document.querySelector('meta[property="og:description"]')?.getAttribute('content')).toBe(
        'A great post about things'
      )
      expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(
        'https://greengale.app/alice/post123'
      )
      expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe(
        'https://greengale.asadegroff.workers.dev/og/alice/post123.png'
      )
      expect(document.querySelector('meta[property="og:type"]')?.getAttribute('content')).toBe(
        'article'
      )
      expect(document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')).toBe(
        'GreenGale'
      )
    })

    it('cleans up all metadata on unmount', () => {
      const { unmount } = renderHook(() => useDocumentMeta({
        title: 'My Blog Post',
        canonical: 'https://greengale.app/alice/post123',
        description: 'A great post about things',
        ogImage: 'https://greengale.asadegroff.workers.dev/og/alice/post123.png',
        ogType: 'article',
      }))

      unmount()

      expect(document.querySelector('link[rel="canonical"]')).toBeNull()
      expect(document.querySelector('meta[name="description"]')).toBeNull()
      expect(document.querySelector('meta[property="og:title"]')).toBeNull()
      expect(document.querySelector('meta[property="og:description"]')).toBeNull()
      expect(document.querySelector('meta[property="og:url"]')).toBeNull()
      expect(document.querySelector('meta[property="og:image"]')).toBeNull()
      expect(document.querySelector('meta[property="og:type"]')).toBeNull()
      expect(document.querySelector('meta[property="og:site_name"]')).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('handles undefined values gracefully', () => {
      renderHook(() => useDocumentMeta({
        title: undefined,
        canonical: undefined,
        description: undefined,
      }))

      // Should not throw and should not add elements for undefined values
      // Only og:type and og:site_name should be present (they always are)
      expect(document.querySelector('meta[property="og:type"]')).not.toBeNull()
      expect(document.querySelector('meta[property="og:site_name"]')).not.toBeNull()
    })

    it('updates existing meta tags instead of creating duplicates', () => {
      // First render
      const { rerender } = renderHook(
        ({ title }) => useDocumentMeta({ title }),
        { initialProps: { title: 'First Title' } }
      )

      expect(document.querySelectorAll('meta[property="og:title"]').length).toBe(1)

      // Second render with new value
      rerender({ title: 'Second Title' })

      // Should still be only one meta tag, not two
      expect(document.querySelectorAll('meta[property="og:title"]').length).toBe(1)
      expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(
        'Second Title'
      )
    })

    it('handles empty string values', () => {
      renderHook(() => useDocumentMeta({
        title: '',
        description: '',
      }))

      // Empty strings are falsy, so these should not be set
      // But og:type and og:site_name should still be present
      expect(document.querySelector('meta[property="og:type"]')).not.toBeNull()
    })
  })
})
