-- Migration: Add beta whitelist table
CREATE TABLE IF NOT EXISTS whitelist (
  did TEXT PRIMARY KEY,
  handle TEXT,
  added_at TEXT DEFAULT (datetime('now')),
  added_by TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_whitelist_handle ON whitelist(handle);
