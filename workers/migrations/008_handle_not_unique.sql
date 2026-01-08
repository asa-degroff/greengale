-- Migration: Remove UNIQUE constraint from authors.handle
-- Handles can transfer between DIDs, so uniqueness should not be enforced.
-- The did column remains the primary key and true identity.

-- Step 1: Create new table without UNIQUE constraint on handle
CREATE TABLE authors_new (
  did TEXT PRIMARY KEY,
  handle TEXT,
  display_name TEXT,
  description TEXT,
  avatar_url TEXT,
  banner_url TEXT,
  pds_endpoint TEXT,
  posts_count INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Step 2: Copy existing data
INSERT INTO authors_new SELECT * FROM authors;

-- Step 3: Drop old table
DROP TABLE authors;

-- Step 4: Rename new table
ALTER TABLE authors_new RENAME TO authors;

-- Step 5: Recreate handle index (non-unique, for lookups)
CREATE INDEX idx_authors_handle ON authors(handle);
