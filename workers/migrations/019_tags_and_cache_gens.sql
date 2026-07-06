-- Migration: Denormalize post tags + cache generation tracking
--
-- Adds a `tags` column to `posts` (comma-separated, lowercased) so feed queries
-- can read tags inline instead of running a correlated `(SELECT GROUP_CONCAT ...)
-- FROM post_tags` subquery per row. The `post_tags` junction table is kept as
-- the source of truth for tag-filtering queries; `posts.tags` is a denormalized
-- read-optimization maintained by the indexer (firehose + indexPostsFromPds).
--
-- Also adds the `cache_generations` table used by the new generation-key cache
-- invalidation scheme (see workers/lib/cache.ts). Instead of N blind
-- `CACHE.delete()` calls per firehose event, writers bump a single integer
-- generation in D1 and readers compare it against the generation stashed in KV.

ALTER TABLE posts ADD COLUMN tags TEXT;

-- Backfill tags from the junction table (lowercased, comma-separated, deduped).
UPDATE posts
SET tags = (
  SELECT GROUP_CONCAT(tag, ',')
  FROM (
    SELECT DISTINCT LOWER(tag) AS tag
    FROM post_tags
    WHERE post_uri = posts.uri
    ORDER BY tag
  )
)
WHERE EXISTS (SELECT 1 FROM post_tags WHERE post_uri = posts.uri);

-- Cache generation tracking. One row per cache family.
-- `family` examples: 'recent_posts', 'network_posts', 'popular_tags', 'rss:recent',
-- 'rss:author:<handle>', 'tag_posts:<tag>', 'og:profile:<handle>'.
-- Readers embed `gen` in their KV key; writers `UPDATE cache_generations SET
-- gen = gen + 1` which makes all in-flight KV entries with the old gen stale
-- (they simply won't be found under the new key).
CREATE TABLE IF NOT EXISTS cache_generations (
  family TEXT PRIMARY KEY,
  gen INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Seed rows for the families we currently invalidate. INSERT OR IGNORE so
-- existing rows (if this migration is re-run) are untouched.
INSERT OR IGNORE INTO cache_generations (family) VALUES
  ('recent_posts'),
  ('network_posts'),
  ('popular_tags'),
  ('rss:recent'),
  ('subscriptions');