-- GreenGale D1 Database Schema

-- Posts table: indexes blog entries from WhiteWind and GreenGale
CREATE TABLE IF NOT EXISTS posts (
  uri TEXT PRIMARY KEY,
  author_did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  title TEXT,
  subtitle TEXT,
  slug TEXT,
  source TEXT NOT NULL CHECK (source IN ('whitewind', 'greengale')),
  visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'url', 'author')),
  created_at TEXT,
  indexed_at TEXT DEFAULT (datetime('now')),
  content_preview TEXT,
  has_latex INTEGER DEFAULT 0,
  theme_preset TEXT,
  first_image_cid TEXT,
  url TEXT,
  path TEXT,
  has_site_standard INTEGER DEFAULT 0,
  site_uri TEXT,
  external_url TEXT,
  -- From migration 014 (semantic search)
  has_embedding INTEGER DEFAULT 0,
  content_hash TEXT,
  last_verified_at TEXT,
  deleted_at TEXT,
  -- From migration 018 (collection filtering)
  collection TEXT,
  -- From migration 019 (denormalized tags)
  tags TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_did);
CREATE INDEX IF NOT EXISTS idx_posts_author_rkey ON posts(author_did, rkey);
CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(author_did, slug);
CREATE INDEX IF NOT EXISTS idx_posts_indexed_at ON posts(indexed_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author_created ON posts(author_did, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_visibility ON posts(visibility);
CREATE INDEX IF NOT EXISTS idx_posts_source ON posts(source);
CREATE INDEX IF NOT EXISTS idx_posts_url ON posts(url);
CREATE INDEX IF NOT EXISTS idx_posts_site_uri ON posts(site_uri);
CREATE INDEX IF NOT EXISTS idx_posts_external_url ON posts(external_url);
-- From migration 010 (title search)
CREATE INDEX IF NOT EXISTS idx_posts_title ON posts(title COLLATE NOCASE);
-- From migration 014 (semantic search)
CREATE INDEX IF NOT EXISTS idx_posts_has_embedding ON posts(has_embedding);
CREATE INDEX IF NOT EXISTS idx_posts_deleted ON posts(deleted_at);
CREATE INDEX IF NOT EXISTS idx_posts_verified ON posts(last_verified_at);
CREATE INDEX IF NOT EXISTS idx_posts_needs_embedding
  ON posts(visibility, has_embedding, deleted_at)
  WHERE visibility = 'public' AND has_embedding = 0 AND deleted_at IS NULL;
-- From migration 018 (collection filtering)
CREATE INDEX IF NOT EXISTS idx_posts_collection ON posts(collection);
CREATE INDEX IF NOT EXISTS idx_posts_author_collection_rkey ON posts(author_did, collection, rkey);
CREATE INDEX IF NOT EXISTS idx_posts_collection_created ON posts(collection, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_network_feed
  ON posts(created_at DESC)
  WHERE collection = 'site.standard.document' AND external_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_native_author_created
  ON posts(author_did, created_at DESC, uri DESC)
  WHERE visibility = 'public'
    AND collection IS NOT 'site.standard.document';
CREATE INDEX IF NOT EXISTS idx_posts_native_created
  ON posts(created_at DESC, author_did, rkey)
  WHERE visibility = 'public'
    AND collection IS NOT 'site.standard.document';
CREATE INDEX IF NOT EXISTS idx_posts_site_standard_retention
  ON posts(author_did, created_at DESC, uri DESC)
  WHERE collection = 'site.standard.document';

-- Authors table: caches author profile information
-- Note: handle is NOT unique because handles can transfer between DIDs
CREATE TABLE IF NOT EXISTS authors (
  did TEXT PRIMARY KEY,
  handle TEXT,
  display_name TEXT,
  description TEXT,
  avatar_url TEXT,
  banner_url TEXT,
  pds_endpoint TEXT,
  posts_count INTEGER DEFAULT 0,
  is_ai_agent INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Index for handle lookups
CREATE INDEX IF NOT EXISTS idx_authors_handle ON authors(handle);
-- From migration 009 (display name search)
CREATE INDEX IF NOT EXISTS idx_authors_display_name ON authors(display_name COLLATE NOCASE);

-- Firehose cursor tracking
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Insert default sync state
INSERT OR IGNORE INTO sync_state (key, value) VALUES ('cursor', '0');
INSERT OR IGNORE INTO sync_state (key, value) VALUES ('last_seq', '0');

-- Beta whitelist: users allowed to create posts
CREATE TABLE IF NOT EXISTS whitelist (
  did TEXT PRIMARY KEY,
  handle TEXT,
  added_at TEXT DEFAULT (datetime('now')),
  added_by TEXT,
  notes TEXT
);

-- Index for handle lookups on whitelist
CREATE INDEX IF NOT EXISTS idx_whitelist_handle ON whitelist(handle);

-- Publications table: stores publication metadata for blogs
CREATE TABLE IF NOT EXISTS publications (
  author_did TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  theme_preset TEXT,
  url TEXT NOT NULL,
  enable_site_standard INTEGER DEFAULT 0,
  show_in_discover INTEGER DEFAULT 1,
  icon_cid TEXT,
  background_texture TEXT DEFAULT 'grid',
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Index for efficient lookups by update time
CREATE INDEX IF NOT EXISTS idx_publications_updated ON publications(updated_at);
-- From migration 009 (publication search)
CREATE INDEX IF NOT EXISTS idx_publications_name ON publications(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_publications_url ON publications(url);

-- Post tags junction table for efficient tag queries
CREATE TABLE IF NOT EXISTS post_tags (
  post_uri TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (post_uri, tag),
  FOREIGN KEY (post_uri) REFERENCES posts(uri) ON DELETE CASCADE
);

-- Index for efficient tag lookups (e.g., "find all posts with tag X")
CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag);

-- Cache generation tracking (from migration 019)
-- One row per cache family. Writers bump `gen`; readers embed it in KV keys
-- so old entries become unreachable (no KV.delete needed). See workers/lib/cache.ts.
CREATE TABLE IF NOT EXISTS cache_generations (
  family TEXT PRIMARY KEY,
  gen INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO cache_generations (family) VALUES
  ('recent_posts'),
  ('network_posts'),
  ('popular_tags'),
  ('rss:recent'),
  ('subscriptions'),
  ('sitemap'),
  ('following:feed');
