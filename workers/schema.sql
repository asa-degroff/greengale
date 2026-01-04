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
  path TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_did);
CREATE INDEX IF NOT EXISTS idx_posts_author_rkey ON posts(author_did, rkey);
CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(author_did, slug);
CREATE INDEX IF NOT EXISTS idx_posts_indexed_at ON posts(indexed_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_visibility ON posts(visibility);
CREATE INDEX IF NOT EXISTS idx_posts_source ON posts(source);
CREATE INDEX IF NOT EXISTS idx_posts_url ON posts(url);

-- Authors table: caches author profile information
CREATE TABLE IF NOT EXISTS authors (
  did TEXT PRIMARY KEY,
  handle TEXT UNIQUE,
  display_name TEXT,
  description TEXT,
  avatar_url TEXT,
  banner_url TEXT,
  pds_endpoint TEXT,
  posts_count INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Index for handle lookups
CREATE INDEX IF NOT EXISTS idx_authors_handle ON authors(handle);

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
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Index for efficient lookups by update time
CREATE INDEX IF NOT EXISTS idx_publications_updated ON publications(updated_at);
