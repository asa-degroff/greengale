/**
 * Generation-key cache invalidation.
 *
 * Problem: the firehose processes every WhiteWind / standard.site post
 * on the network. For each event it issued ~12 `CACHE.delete()` calls. KV charges
 * per delete whether or not the key existed, so most of these were no-ops billed
 * at full price.
 *
 * Solution: a "generation" counter per cache family lives in D1
 * (`cache_generations` table). Readers embed the current generation in their KV
 * keys (`recent_posts:50:42`). Writers bump the generation with a single
 * `UPDATE cache_generations SET gen = gen + 1`. Every KV entry written under the
 * old generation is now unreachable (the new key includes the new generation),
 * so it expires via TTL or gets overwritten lazily. This collapses N deletes per
 * event into a single D1 write while keeping readers O(1).
 *
 * Per-author / per-tag / per-post families use a parameterised family name:
 * `rss:author:<handle>`, `tag_posts:<tag>`, `og:profile:<handle>`. These get
 * their own rows in `cache_generations` (lazily created on first bump).
 */

/**
 * The cache families that are bumped on a generic post change.
 * Per-handle / per-tag families are handled separately.
 */
export const GLOBAL_FEED_FAMILIES = [
  'recent_posts',
  'network_posts',
  'popular_tags',
  'rss:recent',
  'subscriptions',
  'sitemap',
  'following:feed',
] as const

/**
 * Bump (increment) the generation for a single cache family.
 * Creates the row if it doesn't exist yet (defaults to gen=1, then bumps to 2).
 */
export async function bumpGeneration(db: D1Database, family: string): Promise<number> {
  // INSERT ... ON CONFLICT DO UPDATE ensures the row exists, then we read it back.
  await db.prepare(
    `INSERT INTO cache_generations (family, gen, updated_at)
     VALUES (?, 2, datetime('now'))
     ON CONFLICT(family) DO UPDATE SET
       gen = cache_generations.gen + 1,
       updated_at = datetime('now')`
  ).bind(family).run()
  const row = await db.prepare(
    'SELECT gen FROM cache_generations WHERE family = ?'
  ).bind(family).first<{ gen: number }>()
  return row?.gen ?? 1
}

/**
 * Bump many cache families in a single D1 batch (one round-trip).
 * Each family is lazily created.
 */
export async function bumpGenerations(db: D1Database, families: string[]): Promise<void> {
  if (families.length === 0) return
  const statements = families.map(f =>
    db.prepare(
      `INSERT INTO cache_generations (family, gen, updated_at)
       VALUES (?, 2, datetime('now'))
       ON CONFLICT(family) DO UPDATE SET
         gen = cache_generations.gen + 1,
         updated_at = datetime('now')`
    ).bind(f)
  )
  await db.batch(statements)
}

/**
 * Read the current generation for a cache family.
 * Returns 1 if the family has no row yet (i.e. never bumped).
 */
export async function getGeneration(db: D1Database, family: string): Promise<number> {
  const row = await db.prepare(
    'SELECT gen FROM cache_generations WHERE family = ?'
  ).bind(family).first<{ gen: number }>()
  return row?.gen ?? 1
}

/**
 * Build a cache key with the current generation embedded.
 * e.g. buildCacheKey(db, 'recent_posts', 50) -> "recent_posts:50:42"
 */
export async function buildCacheKey(
  db: D1Database,
  family: string,
  params?: string | number
): Promise<string> {
  const gen = await getGeneration(db, family)
  return params === undefined
    ? `${family}:${gen}`
    : `${family}:${params}:${gen}`
}

/**
 * Bump every global feed family (called after a post changes).
 * Per-handle / per-tag / per-post OG families are bumped by the caller.
 */
export async function bumpGlobalFeeds(db: D1Database): Promise<void> {
  await bumpGenerations(db, [...GLOBAL_FEED_FAMILIES])
}

/**
 * Bump global feed families plus per-author RSS caches for the given handles.
 * Convenience wrapper for admin endpoints that delete/modify posts across
 * many authors at once (e.g. spam cleanup, orphan cleanup).
 */
export async function bumpGlobalFeedsAndAuthors(
  db: D1Database,
  handles: string[]
): Promise<void> {
  const families = new Set<string>(GLOBAL_FEED_FAMILIES)
  for (const handle of handles) {
    if (handle) families.add(`rss:author:${handle}`)
  }
  await bumpGenerations(db, [...families])
}

/**
 * Bump global feed families plus a list of per-entity families.
 * Skips empty/undefined entries. Dedupes the combined list.
 */
export async function bumpFeedsForPostChange(
  db: D1Database,
  opts: { handle?: string | null; tags?: string[]; rkey?: string | null }
): Promise<void> {
  const families = new Set<string>(GLOBAL_FEED_FAMILIES)
  if (opts.handle) {
    families.add(`rss:author:${opts.handle}`)
    if (opts.rkey) families.add(`og:${opts.handle}:${opts.rkey}`)
  }
  if (opts.tags) {
    for (const tag of opts.tags) {
      families.add(`tag_posts:${tag}`)
    }
  }
  await bumpGenerations(db, [...families])
}

/**
 * Bump families affected by a publication change (author profile / avatar / theme).
 * Bumps global feeds (avatar is denormalized into cached feed rows), the
 * author's RSS feed, the author's profile OG image, and every post OG image for
 * the author (since theme affects post OG images too).
 *
 * `rkeys` is the list of the author's post rkeys (caller fetches these so it
 * can batch with other reads if desired).
 */
export async function bumpForPublicationChange(
  db: D1Database,
  handle: string,
  rkeys: string[]
): Promise<void> {
  const families = new Set<string>(GLOBAL_FEED_FAMILIES)
  families.add(`rss:author:${handle}`)
  families.add(`og:profile:${handle}`)
  for (const rkey of rkeys) {
    families.add(`og:${handle}:${rkey}`)
  }
  await bumpGenerations(db, [...families])
}