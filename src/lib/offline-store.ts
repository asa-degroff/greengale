import { openDB, type IDBPDatabase } from 'idb'
import type { BlogEntry, AuthorProfile, Publication } from './atproto'
import type { AppViewPost } from './appview'

const DB_NAME = 'greengale-offline'
const DB_VERSION = 1
const MAX_CACHED_POSTS = 50
const MAX_CACHED_FEEDS = 10

export interface CachedPost {
  key: string
  entry: BlogEntry
  author: AuthorProfile
  publication: Publication | null
  cachedAt: number
  cid: string
  isOwnPost: boolean
}

export interface CachedFeed {
  key: string
  posts: AppViewPost[]
  cachedAt: number
  cursor?: string
}

function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('posts')) {
        db.createObjectStore('posts', { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains('feeds')) {
        db.createObjectStore('feeds', { keyPath: 'key' })
      }
    },
  })
}

export async function cachePost(
  handle: string,
  rkey: string,
  entry: BlogEntry,
  author: AuthorProfile,
  publication: Publication | null,
  isOwnPost: boolean
): Promise<void> {
  try {
    const db = await getDB()
    const post: CachedPost = {
      key: `${handle}/${rkey}`,
      entry,
      author,
      publication,
      cachedAt: Date.now(),
      cid: entry.cid,
      isOwnPost,
    }
    await db.put('posts', post)
    await evictOldPosts(db)
  } catch (err) {
    console.warn('Failed to cache post:', err)
  }
}

export async function getCachedPost(handle: string, rkey: string): Promise<CachedPost | null> {
  try {
    const db = await getDB()
    const post = await db.get('posts', `${handle}/${rkey}`)
    return post || null
  } catch {
    return null
  }
}

export async function deleteCachedPost(handle: string, rkey: string): Promise<void> {
  try {
    const db = await getDB()
    await db.delete('posts', `${handle}/${rkey}`)
  } catch (err) {
    console.warn('Failed to delete cached post:', err)
  }
}

export async function cacheFeed(key: string, posts: AppViewPost[], cursor?: string): Promise<void> {
  try {
    const db = await getDB()
    const feed: CachedFeed = {
      key,
      posts,
      cachedAt: Date.now(),
      cursor,
    }
    await db.put('feeds', feed)
    await evictOldFeeds(db)
  } catch (err) {
    console.warn('Failed to cache feed:', err)
  }
}

export async function getCachedFeed(key: string): Promise<CachedFeed | null> {
  try {
    const db = await getDB()
    const feed = await db.get('feeds', key)
    return feed || null
  } catch {
    return null
  }
}

async function evictOldPosts(db: IDBPDatabase): Promise<void> {
  const allPosts = await db.getAll('posts') as CachedPost[]
  if (allPosts.length <= MAX_CACHED_POSTS) return

  allPosts.sort((a, b) => a.cachedAt - b.cachedAt)
  const toEvict = allPosts.slice(0, allPosts.length - MAX_CACHED_POSTS)
  const tx = db.transaction('posts', 'readwrite')
  await Promise.all(toEvict.map(post => tx.store.delete(post.key)))
  await tx.done
}

async function evictOldFeeds(db: IDBPDatabase): Promise<void> {
  const allFeeds = await db.getAll('feeds') as CachedFeed[]
  if (allFeeds.length <= MAX_CACHED_FEEDS) return

  allFeeds.sort((a, b) => a.cachedAt - b.cachedAt)
  const toEvict = allFeeds.slice(0, allFeeds.length - MAX_CACHED_FEEDS)
  const tx = db.transaction('feeds', 'readwrite')
  await Promise.all(toEvict.map(feed => tx.store.delete(feed.key)))
  await tx.done
}

export async function getCacheStats(): Promise<{ postCount: number; feedCount: number }> {
  try {
    const db = await getDB()
    const postCount = await db.count('posts')
    const feedCount = await db.count('feeds')
    return { postCount, feedCount }
  } catch {
    return { postCount: 0, feedCount: 0 }
  }
}

export async function clearAll(): Promise<void> {
  try {
    const db = await getDB()
    const tx1 = db.transaction('posts', 'readwrite')
    await tx1.store.clear()
    await tx1.done
    const tx2 = db.transaction('feeds', 'readwrite')
    await tx2.store.clear()
    await tx2.done
  } catch (err) {
    console.warn('Failed to clear offline cache:', err)
  }
}
