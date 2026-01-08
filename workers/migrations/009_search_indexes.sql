-- Migration: Add indexes for publication and author search
-- Supports searching by publication name, URL, author handle, and display name

-- Index for publication name search (case-insensitive)
CREATE INDEX IF NOT EXISTS idx_publications_name ON publications(name COLLATE NOCASE);

-- Index for publication URL search
CREATE INDEX IF NOT EXISTS idx_publications_url ON publications(url);

-- Index for author display_name search (case-insensitive)
CREATE INDEX IF NOT EXISTS idx_authors_display_name ON authors(display_name COLLATE NOCASE);
