-- Migration: Add `collection` column for indexed-collection filtering
--
-- Replaces expensive `uri LIKE '%/site.standard.document/%'` full-table-scan patterns
-- with indexed equality checks on a dedicated column.
--
-- The existing `source` column is 'greengale' for BOTH app.greengale.document AND
-- site.standard.document, so it cannot distinguish them. `collection` stores the
-- actual AT Protocol collection name, allowing feed queries to filter by exact
-- collection without LIKE scans.

ALTER TABLE posts ADD COLUMN collection TEXT;

-- Backfill collection from uri. AT URIs look like: at://<did>/<collection>/<rkey>
-- Strip "at://" (5 chars) -> "<did>/<collection>/<rkey>"
-- then take the substring between the first and second '/'.
UPDATE posts
SET collection = substr(
  substr(substr(uri, 6), instr(substr(uri, 6), '/') + 1),    -- after the did's '/'
  1,
  instr(
    substr(substr(uri, 6), instr(substr(uri, 6), '/') + 1),
    '/'
  ) - 1
)
WHERE collection IS NULL
  AND uri LIKE 'at://%'
  AND instr(substr(uri, 6), '/') > 0
  AND instr(
    substr(substr(uri, 6), instr(substr(uri, 6), '/') + 1),
    '/'
  ) > 0;

-- Indexes for fast collection filtering.
CREATE INDEX IF NOT EXISTS idx_posts_collection ON posts(collection);
CREATE INDEX IF NOT EXISTS idx_posts_author_collection_rkey ON posts(author_did, collection, rkey);
CREATE INDEX IF NOT EXISTS idx_posts_collection_created ON posts(collection, created_at DESC);

-- Partial index for the network feed (site.standard.document with external_url).
CREATE INDEX IF NOT EXISTS idx_posts_network_feed
  ON posts(created_at DESC)
  WHERE collection = 'site.standard.document' AND external_url IS NOT NULL;

-- Partial index for the discover feed (non-site.standard public posts).
-- Equivalent to the old `uri NOT LIKE '%/site.standard.document/%'` filter.
CREATE INDEX IF NOT EXISTS idx_posts_discover_feed
  ON posts(created_at DESC)
  WHERE collection IS NULL OR collection != 'site.standard.document';