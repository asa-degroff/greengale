-- Migration: Semantic Search Support
-- Adds columns for embedding tracking and content reconciliation

-- Track embedding status for each post
-- has_embedding: 0 = not embedded, 1 = embedded, -1 = skipped (too short, etc.)
ALTER TABLE posts ADD COLUMN has_embedding INTEGER DEFAULT 0;

-- Content hash for change detection (SHA-256 prefix)
ALTER TABLE posts ADD COLUMN content_hash TEXT;

-- Last time the post was verified to still exist on PDS
ALTER TABLE posts ADD COLUMN last_verified_at TEXT;

-- Soft-delete timestamp (for posts removed from PDS)
ALTER TABLE posts ADD COLUMN deleted_at TEXT;

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_posts_has_embedding ON posts(has_embedding);
CREATE INDEX IF NOT EXISTS idx_posts_deleted ON posts(deleted_at);
CREATE INDEX IF NOT EXISTS idx_posts_verified ON posts(last_verified_at);

-- Combined index for backfill queries (posts needing embeddings)
CREATE INDEX IF NOT EXISTS idx_posts_needs_embedding
  ON posts(visibility, has_embedding, deleted_at)
  WHERE visibility = 'public' AND has_embedding = 0 AND deleted_at IS NULL;
