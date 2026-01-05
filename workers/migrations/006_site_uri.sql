-- Add site_uri column for site.standard.document posts
-- This stores the AT-URI reference to the site.standard.publication record
-- Used to join with publications table to get the external URL

ALTER TABLE posts ADD COLUMN site_uri TEXT;

-- Index for querying network posts
CREATE INDEX IF NOT EXISTS idx_posts_site_uri ON posts(site_uri);
