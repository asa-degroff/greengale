-- Add show_in_discover column to publications table
-- Controls whether posts from a publication appear in homepage and discovery feeds
-- Defaults to 1 (true) - publications are discoverable by default
ALTER TABLE publications ADD COLUMN show_in_discover INTEGER DEFAULT 1;
