-- Add external_url column for site.standard.document posts
-- This stores the pre-computed external URL (publication.url + document.path)
-- Used by the "From the Network" feed to link to external sites

ALTER TABLE posts ADD COLUMN external_url TEXT;

-- Index for filtering posts with external URLs
CREATE INDEX IF NOT EXISTS idx_posts_external_url ON posts(external_url);
