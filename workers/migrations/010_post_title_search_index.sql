-- Add index for searching post titles
CREATE INDEX IF NOT EXISTS idx_posts_title ON posts(title COLLATE NOCASE);
