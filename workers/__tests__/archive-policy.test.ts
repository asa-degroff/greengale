import { describe, expect, it } from 'vitest'
import {
  publicPostCountDelta,
  shouldRetainSiteStandardPost,
} from '../lib/archive-policy'

describe('site.standard archive retention', () => {
  it('admits a valid post while the retained window has room', () => {
    expect(shouldRetainSiteStandardPost({
      uri: 'at://did/site.standard.document/new',
      createdAt: '2026-08-01T00:00:00.000Z',
    })).toBe(true)
  })

  it('rejects records without a valid published timestamp', () => {
    expect(shouldRetainSiteStandardPost({
      uri: 'at://did/site.standard.document/bad',
      createdAt: null,
    })).toBe(false)
    expect(shouldRetainSiteStandardPost({
      uri: 'at://did/site.standard.document/bad',
      createdAt: 'not-a-date',
    })).toBe(false)
  })

  it('only admits records newer than the retained boundary', () => {
    const boundary = {
      uri: 'at://did/site.standard.document/boundary',
      createdAt: '2025-01-01T00:00:00.000Z',
    }

    expect(shouldRetainSiteStandardPost({
      uri: 'at://did/site.standard.document/newer',
      createdAt: '2025-01-02T00:00:00.000Z',
    }, boundary)).toBe(true)
    expect(shouldRetainSiteStandardPost({
      uri: 'at://did/site.standard.document/older',
      createdAt: '2024-12-31T00:00:00.000Z',
    }, boundary)).toBe(false)
  })

  it('uses the URI as a stable timestamp tie-breaker', () => {
    const boundary = {
      uri: 'at://did/site.standard.document/b',
      createdAt: '2025-01-01T00:00:00.000Z',
    }

    expect(shouldRetainSiteStandardPost({
      uri: 'at://did/site.standard.document/c',
      createdAt: boundary.createdAt,
    }, boundary)).toBe(true)
    expect(shouldRetainSiteStandardPost({
      uri: 'at://did/site.standard.document/a',
      createdAt: boundary.createdAt,
    }, boundary)).toBe(false)
  })
})

describe('incremental public post counts', () => {
  it('increments for a new public post', () => {
    expect(publicPostCountDelta(undefined, 'public')).toBe(1)
  })

  it('does not change for a public-to-public update', () => {
    expect(publicPostCountDelta('public', 'public')).toBe(0)
  })

  it('decrements when a public post becomes private', () => {
    expect(publicPostCountDelta('public', 'author')).toBe(-1)
  })

  it('keeps the count stable when a new public post evicts a public post', () => {
    expect(publicPostCountDelta(undefined, 'public', 'public')).toBe(0)
  })
})
