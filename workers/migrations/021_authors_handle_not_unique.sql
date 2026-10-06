-- Migration 021: Remove UNIQUE constraint from authors.handle (production-safe
-- redo of 008_handle_not_unique.sql)
--
-- Migration 008 was never applied to the production database, so
-- authors.handle still has its original inline UNIQUE constraint. When an AT
-- Protocol handle transfers to a new DID (e.g. after an account is recovered on
-- a fresh DID), the firehose author upsert hits that constraint, the whole
-- post + author batch rolls back, and the new account's posts are silently
-- dropped. Handle lookups (`SELECT ... WHERE handle = ?`) can then keep
-- resolving to the previous DID, which shows a stale profile and old posts.
--
-- Unlike 008, this rebuild keeps the current column set (is_ai_agent was added
-- after 008 was written) and recreates both author indexes.
--
-- Run with:
--   npx wrangler d1 execute greengale --remote --file=./workers/migrations/021_authors_handle_not_unique.sql

DROP TABLE IF EXISTS authors_new;

CREATE TABLE authors_new (
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

INSERT INTO authors_new (
  did,
  handle,
  display_name,
  description,
  avatar_url,
  banner_url,
  pds_endpoint,
  posts_count,
  is_ai_agent,
  updated_at
)
SELECT
  did,
  handle,
  display_name,
  description,
  avatar_url,
  banner_url,
  pds_endpoint,
  posts_count,
  is_ai_agent,
  updated_at
FROM authors;

DROP TABLE authors;

ALTER TABLE authors_new RENAME TO authors;

CREATE INDEX IF NOT EXISTS idx_authors_handle ON authors(handle);
CREATE INDEX IF NOT EXISTS idx_authors_display_name ON authors(display_name COLLATE NOCASE);
