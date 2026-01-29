-- Add composite index for efficient author posts pagination by creation date
-- This supports the ORDER BY created_at DESC query pattern used in getAuthorPosts
CREATE INDEX IF NOT EXISTS idx_posts_author_created ON posts(author_did, created_at DESC);
