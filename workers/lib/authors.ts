/**
 * Helpers for keeping the `authors` table consistent when a handle transfers
 * between DIDs.
 *
 * Handles are intentionally not unique in `authors` (see `workers/schema.sql`):
 * AT Protocol allows a handle to move to a new DID, e.g. when an account is
 * recovered on a fresh DID after losing the old account's keys. If an older
 * row keeps claiming the handle, `SELECT ... FROM authors WHERE handle = ?`
 * becomes ambiguous and profile/feed requests can resolve to the previous
 * owner (stale avatar, old posts, missing new posts).
 *
 * Writer paths release the handle from any other author in the same atomic
 * batch as the author upsert, so a handle is only claimed by the DID that
 * currently owns it.
 */

/**
 * Build a statement that releases `handle` from any author other than `did`.
 *
 * Include this in the same D1 batch as the author upsert so the release and the
 * claim happen atomically. Handles are lowercased by AT Protocol, so the exact
 * match can use the `idx_authors_handle` index.
 */
export function releaseHandleFromOtherAuthors(
  db: D1Database,
  handle: string,
  did: string
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE authors
       SET handle = NULL, updated_at = datetime('now')
       WHERE handle = ? AND did != ?`
    )
    .bind(handle, did)
}
