-- Migration: Add first_image_cid column to posts table for OG image thumbnails
ALTER TABLE posts ADD COLUMN first_image_cid TEXT;

-- Index for potential queries filtering by posts with images
CREATE INDEX IF NOT EXISTS idx_posts_has_image ON posts(first_image_cid) WHERE first_image_cid IS NOT NULL;
