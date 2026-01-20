-- Create junction table for post tags
-- Using a junction table instead of JSON array for efficient tag queries in SQLite

CREATE TABLE IF NOT EXISTS post_tags (
  post_uri TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (post_uri, tag),
  FOREIGN KEY (post_uri) REFERENCES posts(uri) ON DELETE CASCADE
);

-- Index for efficient tag lookups (e.g., "find all posts with tag X")
CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag);
