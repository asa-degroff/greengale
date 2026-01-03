-- Migration: Create publications table for blog configuration
-- Stores publication metadata indexed from app.greengale.publication records

CREATE TABLE IF NOT EXISTS publications (
  author_did TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  theme_preset TEXT,
  url TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Index for efficient lookups by update time (for cache invalidation)
CREATE INDEX IF NOT EXISTS idx_publications_updated ON publications(updated_at);
