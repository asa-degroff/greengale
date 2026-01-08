/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import React from 'react'
import {
  getBlueskyWebUrl,
  getBlueskyShareUrl,
  renderTextWithFacets,
  type BlueskyFacet,
} from '../bluesky'

describe('Bluesky Utilities', () => {
  describe('getBlueskyWebUrl', () => {
    it('converts valid AT URI to Bluesky web URL', () => {
      const uri = 'at://did:plc:abc123/app.bsky.feed.post/xyz789'
      const url = getBlueskyWebUrl(uri)
      expect(url).toBe('https://bsky.app/profile/did:plc:abc123/post/xyz789')
    })

    it('handles did:web format', () => {
      const uri = 'at://did:web:example.com/app.bsky.feed.post/rkey123'
      const url = getBlueskyWebUrl(uri)
      expect(url).toBe('https://bsky.app/profile/did:web:example.com/post/rkey123')
    })

    it('returns base URL for invalid AT URI', () => {
      const uri = 'invalid-uri'
      const url = getBlueskyWebUrl(uri)
      expect(url).toBe('https://bsky.app')
    })

    it('returns base URL for non-post AT URI', () => {
      const uri = 'at://did:plc:abc123/app.bsky.actor.profile/self'
      const url = getBlueskyWebUrl(uri)
      expect(url).toBe('https://bsky.app')
    })

    it('returns base URL for empty string', () => {
      const url = getBlueskyWebUrl('')
      expect(url).toBe('https://bsky.app')
    })

    it('returns base URL for malformed AT URI without rkey', () => {
      const uri = 'at://did:plc:abc123/app.bsky.feed.post/'
      const url = getBlueskyWebUrl(uri)
      expect(url).toBe('https://bsky.app')
    })

    it('handles rkey with alphanumeric characters', () => {
      const uri = 'at://did:plc:abc123/app.bsky.feed.post/3kp7abc123XYZ'
      const url = getBlueskyWebUrl(uri)
      expect(url).toBe('https://bsky.app/profile/did:plc:abc123/post/3kp7abc123XYZ')
    })

    it('returns base URL for AT URI with extra path segments', () => {
      const uri = 'at://did:plc:abc123/app.bsky.feed.post/xyz789/extra'
      const url = getBlueskyWebUrl(uri)
      expect(url).toBe('https://bsky.app')
    })

    it('returns base URL for AT URI with wrong collection', () => {
      const uri = 'at://did:plc:abc123/app.bsky.feed.like/xyz789'
      const url = getBlueskyWebUrl(uri)
      expect(url).toBe('https://bsky.app')
    })
  })

  describe('getBlueskyShareUrl', () => {
    it('generates share URL with just the blog URL', () => {
      const url = getBlueskyShareUrl('https://example.com/post')
      expect(url).toBe('https://bsky.app/intent/compose?text=https%3A%2F%2Fexample.com%2Fpost')
    })

    it('generates share URL with title and blog URL', () => {
      const url = getBlueskyShareUrl('https://example.com/post', 'My Blog Post')
      expect(url).toBe('https://bsky.app/intent/compose?text=My%20Blog%20Post%0A%0Ahttps%3A%2F%2Fexample.com%2Fpost')
    })

    it('encodes special characters in title', () => {
      const url = getBlueskyShareUrl('https://example.com', 'Test & Demo!')
      expect(url).toContain('Test%20%26%20Demo!')
    })

    it('handles empty title as undefined', () => {
      const url = getBlueskyShareUrl('https://example.com/post', '')
      // Empty string is falsy, so just URL is used
      expect(url).toBe('https://bsky.app/intent/compose?text=https%3A%2F%2Fexample.com%2Fpost')
    })

    it('handles unicode in title', () => {
      const url = getBlueskyShareUrl('https://example.com', '你好世界')
      expect(url).toContain(encodeURIComponent('你好世界'))
    })

    it('handles emoji in title', () => {
      const url = getBlueskyShareUrl('https://example.com', 'Hello 🌍!')
      expect(url).toContain(encodeURIComponent('Hello 🌍!'))
    })

    it('formats title and URL with double newline', () => {
      const url = getBlueskyShareUrl('https://example.com', 'Title')
      const decoded = decodeURIComponent(url.split('text=')[1])
      expect(decoded).toBe('Title\n\nhttps://example.com')
    })
  })

  describe('renderTextWithFacets', () => {
    it('returns plain text array when no facets', () => {
      const result = renderTextWithFacets('Hello world', null)
      expect(result).toEqual(['Hello world'])
    })

    it('returns plain text array when facets is empty', () => {
      const result = renderTextWithFacets('Hello world', [])
      expect(result).toEqual(['Hello world'])
    })

    it('returns plain text array when facets is undefined', () => {
      const result = renderTextWithFacets('Hello world', undefined)
      expect(result).toEqual(['Hello world'])
    })

    it('renders link facet', () => {
      const text = 'Check out example.com for more'
      const facets: BlueskyFacet[] = [{
        index: { byteStart: 10, byteEnd: 21 },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com' }],
      }]
      const result = renderTextWithFacets(text, facets)

      expect(result).toHaveLength(3)
      expect(result[0]).toBe('Check out ')
      expect(React.isValidElement(result[1])).toBe(true)
      expect((result[1] as React.ReactElement).props.href).toBe('https://example.com')
      expect((result[1] as React.ReactElement).props.children).toBe('example.com')
      expect(result[2]).toBe(' for more')
    })

    it('renders mention facet', () => {
      const text = 'Hello @user.bsky.social!'
      const facets: BlueskyFacet[] = [{
        index: { byteStart: 6, byteEnd: 23 },
        features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:abc123' }],
      }]
      const result = renderTextWithFacets(text, facets)

      expect(result).toHaveLength(3)
      expect(result[0]).toBe('Hello ')
      expect(React.isValidElement(result[1])).toBe(true)
      expect((result[1] as React.ReactElement).props.href).toBe('https://bsky.app/profile/did:plc:abc123')
      expect(result[2]).toBe('!')
    })

    it('renders hashtag facet', () => {
      const text = 'Check out #coding today'
      const facets: BlueskyFacet[] = [{
        index: { byteStart: 10, byteEnd: 17 },
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'coding' }],
      }]
      const result = renderTextWithFacets(text, facets)

      expect(result).toHaveLength(3)
      expect(result[0]).toBe('Check out ')
      expect(React.isValidElement(result[1])).toBe(true)
      expect((result[1] as React.ReactElement).props.href).toBe('https://bsky.app/hashtag/coding')
      expect(result[2]).toBe(' today')
    })

    it('renders multiple facets', () => {
      const text = 'Hey @alice check example.com'
      const facets: BlueskyFacet[] = [
        {
          index: { byteStart: 4, byteEnd: 10 },
          features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:alice' }],
        },
        {
          index: { byteStart: 17, byteEnd: 28 },
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com' }],
        },
      ]
      const result = renderTextWithFacets(text, facets)

      expect(result).toHaveLength(4)
      expect(result[0]).toBe('Hey ')
      expect(React.isValidElement(result[1])).toBe(true) // @alice
      expect(result[2]).toBe(' check ')
      expect(React.isValidElement(result[3])).toBe(true) // example.com
    })

    it('sorts facets by byte position', () => {
      const text = 'First Second Third'
      // Provide facets out of order
      const facets: BlueskyFacet[] = [
        {
          index: { byteStart: 13, byteEnd: 18 },
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://third.com' }],
        },
        {
          index: { byteStart: 0, byteEnd: 5 },
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://first.com' }],
        },
        {
          index: { byteStart: 6, byteEnd: 12 },
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://second.com' }],
        },
      ]
      const result = renderTextWithFacets(text, facets)

      expect(result).toHaveLength(5)
      expect((result[0] as React.ReactElement).props.href).toBe('https://first.com')
      expect(result[1]).toBe(' ')
      expect((result[2] as React.ReactElement).props.href).toBe('https://second.com')
      expect(result[3]).toBe(' ')
      expect((result[4] as React.ReactElement).props.href).toBe('https://third.com')
    })

    it('handles facet at start of text', () => {
      const text = '@user hello'
      const facets: BlueskyFacet[] = [{
        index: { byteStart: 0, byteEnd: 5 },
        features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:user' }],
      }]
      const result = renderTextWithFacets(text, facets)

      expect(result).toHaveLength(2)
      expect(React.isValidElement(result[0])).toBe(true)
      expect(result[1]).toBe(' hello')
    })

    it('handles facet at end of text', () => {
      const text = 'hello @user'
      const facets: BlueskyFacet[] = [{
        index: { byteStart: 6, byteEnd: 11 },
        features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:user' }],
      }]
      const result = renderTextWithFacets(text, facets)

      expect(result).toHaveLength(2)
      expect(result[0]).toBe('hello ')
      expect(React.isValidElement(result[1])).toBe(true)
    })

    it('handles unknown facet type as plain text', () => {
      const text = 'Hello world'
      const facets: BlueskyFacet[] = [{
        index: { byteStart: 6, byteEnd: 11 },
        features: [{ $type: 'app.bsky.richtext.facet#unknown' }],
      }]
      const result = renderTextWithFacets(text, facets)

      expect(result).toHaveLength(2)
      expect(result[0]).toBe('Hello ')
      expect(result[1]).toBe('world')
    })

    describe('UTF-8 byte handling', () => {
      it('handles emoji correctly', () => {
        // "Hello 🌍 world" - 🌍 is 4 bytes in UTF-8
        const text = 'Hello 🌍 world'
        // "Hello " = 6 bytes, "🌍" = 4 bytes, " world" = 6 bytes
        const facets: BlueskyFacet[] = [{
          index: { byteStart: 6, byteEnd: 10 }, // 🌍 spans bytes 6-10
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://earth.com' }],
        }]
        const result = renderTextWithFacets(text, facets)

        expect(result).toHaveLength(3)
        expect(result[0]).toBe('Hello ')
        expect(React.isValidElement(result[1])).toBe(true)
        expect((result[1] as React.ReactElement).props.children).toBe('🌍')
        expect(result[2]).toBe(' world')
      })

      it('handles CJK characters correctly', () => {
        // "Hello 世界 test" - 世 and 界 are 3 bytes each in UTF-8
        const text = 'Hello 世界 test'
        // "Hello " = 6 bytes, "世界" = 6 bytes, " test" = 5 bytes
        const facets: BlueskyFacet[] = [{
          index: { byteStart: 6, byteEnd: 12 }, // 世界 spans bytes 6-12
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://world.com' }],
        }]
        const result = renderTextWithFacets(text, facets)

        expect(result).toHaveLength(3)
        expect(result[0]).toBe('Hello ')
        expect(React.isValidElement(result[1])).toBe(true)
        expect((result[1] as React.ReactElement).props.children).toBe('世界')
        expect(result[2]).toBe(' test')
      })

      it('handles mixed ASCII and multibyte characters', () => {
        // "café ☕" - é is 2 bytes, ☕ is 3 bytes
        const text = 'café ☕'
        // "caf" = 3 bytes, "é" = 2 bytes, " " = 1 byte, "☕" = 3 bytes
        // Total: 9 bytes
        const facets: BlueskyFacet[] = [{
          index: { byteStart: 6, byteEnd: 9 }, // ☕ spans bytes 6-9
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://coffee.com' }],
        }]
        const result = renderTextWithFacets(text, facets)

        expect(result).toHaveLength(2)
        expect(result[0]).toBe('café ')
        expect(React.isValidElement(result[1])).toBe(true)
        expect((result[1] as React.ReactElement).props.children).toBe('☕')
      })

      it('handles Korean characters', () => {
        // "안녕 hello" - each Korean char is 3 bytes
        const text = '안녕 hello'
        // "안녕" = 6 bytes, " hello" = 6 bytes
        const facets: BlueskyFacet[] = [{
          index: { byteStart: 0, byteEnd: 6 }, // 안녕
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://korean.com' }],
        }]
        const result = renderTextWithFacets(text, facets)

        expect(result).toHaveLength(2)
        expect(React.isValidElement(result[0])).toBe(true)
        expect((result[0] as React.ReactElement).props.children).toBe('안녕')
        expect(result[1]).toBe(' hello')
      })
    })

    it('opens links in new tab with security attributes', () => {
      const text = 'Visit example.com'
      const facets: BlueskyFacet[] = [{
        index: { byteStart: 6, byteEnd: 17 },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com' }],
      }]
      const result = renderTextWithFacets(text, facets)

      const link = result[1] as React.ReactElement
      expect(link.props.target).toBe('_blank')
      expect(link.props.rel).toBe('noopener noreferrer')
    })
  })
})
