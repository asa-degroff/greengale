-- Migration: Native-feed query plans and site.standard retention
--
-- The database is dominated by site.standard.document rows, while native
-- homepage/RSS/sitemap queries explicitly exclude them. The previous partial
-- index did not include visibility or the author ordering used by the window
-- queries, so SQLite chose idx_posts_visibility and scanned the public corpus.

DROP INDEX IF EXISTS idx_posts_discover_feed;

CREATE INDEX IF NOT EXISTS idx_posts_native_author_created
  ON posts(author_did, created_at DESC, uri DESC)
  WHERE visibility = 'public'
    AND collection IS NOT 'site.standard.document';

CREATE INDEX IF NOT EXISTS idx_posts_native_created
  ON posts(created_at DESC, author_did, rkey)
  WHERE visibility = 'public'
    AND collection IS NOT 'site.standard.document';

-- Supports newest-N admission and oldest-record eviction without scanning an
-- author's complete external archive.
CREATE INDEX IF NOT EXISTS idx_posts_site_standard_retention
  ON posts(author_did, created_at DESC, uri DESC)
  WHERE collection = 'site.standard.document';
