import { describe, expect, it, vi } from 'vitest'
import {
  GLOBAL_FEED_FAMILIES,
  SITE_STANDARD_FEED_FAMILIES,
  bumpFeedsForPostChange,
  getFeedFamiliesForCollection,
} from '../lib/cache'

function createMockD1() {
  const statements: Array<{ family?: string }> = []
  const db = {
    prepare: vi.fn(() => {
      const statement: { family?: string; bind: (family: string) => unknown } = {
        bind(family: string) {
          statement.family = family
          statements.push(statement)
          return statement
        },
      }
      return statement
    }),
    batch: vi.fn().mockResolvedValue([]),
  }
  return { db: db as unknown as D1Database, statements }
}

describe('cache generation routing', () => {
  it('uses all feed families for native posts', () => {
    expect(getFeedFamiliesForCollection('app.greengale.document')).toEqual([
      ...GLOBAL_FEED_FAMILIES,
    ])
    expect(getFeedFamiliesForCollection('com.whtwnd.blog.entry')).toEqual([
      ...GLOBAL_FEED_FAMILIES,
    ])
  })

  it('limits site.standard invalidation to feeds that display external posts', () => {
    expect(getFeedFamiliesForCollection('site.standard.document')).toEqual([
      ...SITE_STANDARD_FEED_FAMILIES,
    ])
  })

  it('does not bump native RSS, OG, or tag families for site.standard posts', async () => {
    const { db, statements } = createMockD1()

    await bumpFeedsForPostChange(db, {
      collection: 'site.standard.document',
      handle: 'example.com',
      rkey: 'post',
      tags: ['typescript'],
    })

    expect(statements.map(statement => statement.family)).toEqual([
      ...SITE_STANDARD_FEED_FAMILIES,
    ])
  })

  it('bumps native entity families once alongside the global families', async () => {
    const { db, statements } = createMockD1()

    await bumpFeedsForPostChange(db, {
      collection: 'app.greengale.document',
      handle: 'example.com',
      rkey: 'post',
      tags: ['typescript', 'typescript'],
    })

    expect(statements.map(statement => statement.family)).toEqual([
      ...GLOBAL_FEED_FAMILIES,
      'rss:author:example.com',
      'og:example.com:post',
      'tag_posts:typescript',
    ])
  })
})
