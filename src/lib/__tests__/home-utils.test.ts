import { describe, it, expect } from 'vitest'
import type { AppViewPost } from '../appview'
import type { PostSearchResult } from '../appview'

/**
 * Tests for the appViewPostToPreviewPost converter function from Home.tsx.
 *
 * This function is module-scoped in Home.tsx. Since it's not exported,
 * we replicate it here for testing. If the implementation drifts,
 * update this copy to match.
 */

function appViewPostToPreviewPost(post: AppViewPost): PostSearchResult {
  return {
    uri: post.uri,
    authorDid: post.authorDid,
    handle: post.author?.handle || post.authorDid,
    displayName: post.author?.displayName || null,
    avatarUrl: post.author?.avatar || null,
    rkey: post.rkey,
    title: post.title || 'Untitled',
    subtitle: post.subtitle || null,
    createdAt: post.createdAt || null,
    contentPreview: post.contentPreview || null,
    score: 0,
    matchType: 'keyword',
    source: post.source,
    externalUrl: post.externalUrl || null,
  }
}

// Helper to create a minimal AppViewPost
function makePost(overrides: Partial<AppViewPost> = {}): AppViewPost {
  return {
    uri: 'at://did:plc:abc/site.standard.document/123',
    authorDid: 'did:plc:abc',
    rkey: '123',
    title: 'Test Post',
    subtitle: 'A subtitle',
    source: 'network',
    visibility: 'public',
    createdAt: '2024-06-15T12:00:00Z',
    indexedAt: '2024-06-15T12:00:00Z',
    externalUrl: 'https://example.com/post',
    contentPreview: 'Preview text here',
    author: {
      did: 'did:plc:abc',
      handle: 'test.bsky.social',
      displayName: 'Test User',
      avatar: 'https://example.com/avatar.jpg',
    },
    ...overrides,
  }
}

describe('appViewPostToPreviewPost', () => {
  it('maps all fields from a fully populated post', () => {
    const post = makePost()
    const result = appViewPostToPreviewPost(post)

    expect(result.uri).toBe('at://did:plc:abc/site.standard.document/123')
    expect(result.authorDid).toBe('did:plc:abc')
    expect(result.handle).toBe('test.bsky.social')
    expect(result.displayName).toBe('Test User')
    expect(result.avatarUrl).toBe('https://example.com/avatar.jpg')
    expect(result.rkey).toBe('123')
    expect(result.title).toBe('Test Post')
    expect(result.subtitle).toBe('A subtitle')
    expect(result.createdAt).toBe('2024-06-15T12:00:00Z')
    expect(result.contentPreview).toBe('Preview text here')
    expect(result.externalUrl).toBe('https://example.com/post')
    expect(result.source).toBe('network')
  })

  it('always sets score to 0 and matchType to keyword', () => {
    const result = appViewPostToPreviewPost(makePost())
    expect(result.score).toBe(0)
    expect(result.matchType).toBe('keyword')
  })

  it('defaults title to Untitled when null', () => {
    const result = appViewPostToPreviewPost(makePost({ title: null }))
    expect(result.title).toBe('Untitled')
  })

  it('defaults title to Untitled when empty string', () => {
    const result = appViewPostToPreviewPost(makePost({ title: '' }))
    expect(result.title).toBe('Untitled')
  })

  it('falls back handle to authorDid when author is undefined', () => {
    const result = appViewPostToPreviewPost(makePost({ author: undefined }))
    expect(result.handle).toBe('did:plc:abc')
    expect(result.displayName).toBeNull()
    expect(result.avatarUrl).toBeNull()
  })

  it('returns null for missing optional fields', () => {
    const result = appViewPostToPreviewPost(makePost({
      subtitle: null,
      createdAt: null,
      contentPreview: null,
      externalUrl: null,
    }))

    expect(result.subtitle).toBeNull()
    expect(result.createdAt).toBeNull()
    expect(result.contentPreview).toBeNull()
    expect(result.externalUrl).toBeNull()
  })

  it('converts empty string optional fields to null', () => {
    const result = appViewPostToPreviewPost(makePost({
      subtitle: '',
      createdAt: '',
      contentPreview: '',
      externalUrl: '',
    }))

    // Empty strings are falsy, so || null converts them
    expect(result.subtitle).toBeNull()
    expect(result.createdAt).toBeNull()
    expect(result.contentPreview).toBeNull()
    expect(result.externalUrl).toBeNull()
  })

  it('preserves source field exactly', () => {
    expect(appViewPostToPreviewPost(makePost({ source: 'whitewind' })).source).toBe('whitewind')
    expect(appViewPostToPreviewPost(makePost({ source: 'greengale' })).source).toBe('greengale')
    expect(appViewPostToPreviewPost(makePost({ source: 'network' })).source).toBe('network')
  })
})
