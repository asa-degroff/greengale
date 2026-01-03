-- Migration: Add document-specific fields for site.standard compatibility
-- These fields support the app.greengale.document collection

-- Add url column for base publication URL
ALTER TABLE posts ADD COLUMN url TEXT;

-- Add path column for document path relative to publication URL
ALTER TABLE posts ADD COLUMN path TEXT;

-- Index for querying by publication URL
CREATE INDEX IF NOT EXISTS idx_posts_url ON posts(url);
