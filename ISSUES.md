# GreenGale Code Review Issues

Review conducted: 2026-01-06

## Critical Issues

### 1. Non-Atomic Multi-Step Operations (Race Condition)
**Location:** `workers/firehose/index.ts`
**Status:** FIXED (2026-01-06)

The `indexPost()` function now uses `db.batch()` for atomic database operations:
- Upsert post, upsert author, and update posts_count all in one atomic batch
- If any operation fails, all operations roll back
- Network calls (fetchAuthorData) happen before the batch

---

### 2. Silent Error Swallowing in deletePost()
**Location:** `workers/firehose/index.ts`
**Status:** FIXED (2026-01-06)

Added `throw error` to deletePost() and deletePublication() to match indexPost() behavior:
- Errors now propagate to handleMessage()
- Cursor does NOT advance on failure
- Events can be reprocessed on reconnect

---

### 3. Cache Invalidation Race Condition
**Location:** `workers/firehose/index.ts`
**Status:** FIXED (2026-01-06)

Cache is now invalidated BEFORE the database write:
- Prevents stale data from being served after DB update
- Applied to indexPost(), deletePost(), indexPublication(), deletePublication()

---

## High Severity Issues

### 4. Handle Uniqueness Constraint Violation Risk
**Location:** `workers/firehose/index.ts:620-639`, `workers/schema.sql:36`
**Status:** Open

The `authors` table has `handle TEXT UNIQUE`. If two users with different DIDs try to claim the same handle simultaneously (handle transfers), one fails with a constraint violation, causing post indexing to fail.

**Fix:** Use ON CONFLICT for handle updates, or remove UNIQUE constraint and handle duplicates in queries.

---

### 5. External URL Resolution Blocks Firehose Processing
**Location:** `workers/firehose/index.ts:324-328`
**Status:** Open

Makes two sequential network calls (plc.directory + PDS) during firehose processing with no timeouts. If plc.directory is slow, all indexing stops.

**Fix:** Add timeouts, move to async background task, or queue for later resolution.

---

### 6. Stale 30-Minute Cache Without Validation
**Location:** `workers/api/index.ts:337`
**Status:** Open

Posts cached for 30 minutes. If firehose is down, deleted/edited posts show old content with no fallback.

**Fix:** Reduce TTL and/or add validation when serving from cache.

---

### 7. Network Feed Query Performance
**Location:** `workers/api/index.ts:747-753`
**Status:** Open

The `NOT EXISTS` subquery scans posts table for each result. Could be slow with thousands of posts.

**Fix:** Add composite index on (author_did, rkey, uri) or denormalize.

---

## Medium Severity Issues

### 8. Author Post Count Drift
**Location:** `workers/firehose/index.ts:386-391`
**Status:** Open

Post count calculated via COUNT(*) at update time, not atomic with insert/delete.

---

### 9. Missing Duplicate Detection
**Location:** `workers/firehose/index.ts:243-284`
**Status:** Open

Jetstream may deliver same event twice. No idempotency tracking.

---

### 10. Error Count Not Persisted
**Location:** `workers/firehose/index.ts:76`
**Status:** Open

Error counter is in-memory only, resets on hibernation.

---

### 11. Inconsistent Cache Key Invalidation
**Location:** `workers/firehose/index.ts`, `workers/api/index.ts`
**Status:** FIXED (2026-01-06)

The homepage uses `limit=24`, but the firehose was only invalidating keys for 12, 50, 100.
Added `recent_posts:24:` to cache invalidation in `indexPost()` and `deletePost()`.

---

### 12. Schema Mismatch
**Location:** `workers/schema.sql` vs `workers/firehose/index.ts:360`
**Status:** Open

Base schema.sql missing site_uri and external_url columns (added via migrations).

---

## Low Severity Issues

### 13. No Foreign Key Constraints
**Location:** `workers/schema.sql`
**Status:** Open

No foreign keys between posts.author_did and authors.did.

---

### 14. Content Preview Truncation
**Location:** `workers/firehose/index.ts:349-352`
**Status:** Open

Previews hard-truncated at 300 chars without ellipsis.

---

### 15. Missing CID in AppView Response
**Location:** `src/pages/Home.tsx:13`
**Status:** Open

AppView doesn't return CID, set to empty string in toBlogEntry().
