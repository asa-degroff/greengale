-- Migration: Add site.standard tracking columns
-- Supports dual-publishing to site.standard.publication and site.standard.document

-- Add column to publications table to track if site.standard publishing is enabled
ALTER TABLE publications ADD COLUMN enable_site_standard INTEGER DEFAULT 0;

-- Add column to posts table to track if post has site.standard version
ALTER TABLE posts ADD COLUMN has_site_standard INTEGER DEFAULT 0;
