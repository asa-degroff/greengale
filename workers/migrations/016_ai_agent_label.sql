-- Add is_ai_agent column to authors table
-- Tracks whether an author is labeled as an AI agent by the labeler
ALTER TABLE authors ADD COLUMN is_ai_agent INTEGER DEFAULT 0;
