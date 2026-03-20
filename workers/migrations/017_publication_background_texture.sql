-- Add background_texture column to publications table
-- Stores the user's preferred background texture: 'grid', 'floral', or 'clouds'
ALTER TABLE publications ADD COLUMN background_texture TEXT DEFAULT 'grid';
