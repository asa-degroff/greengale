/**
 * GreenGale is a discovery index, not a full archive mirror. Keep a generous
 * recent window per external publication while preventing a single repository
 * from dominating D1 storage and query plans.
 */
export const SITE_STANDARD_POST_LIMIT_PER_AUTHOR = 1000

export interface RetainedPostBoundary {
  uri: string
  createdAt: string | null
}

/**
 * Decide whether a new site.standard.document belongs inside the retained
 * newest-N window. Existing records bypass this check so updates still apply.
 */
export function shouldRetainSiteStandardPost(
  incoming: RetainedPostBoundary,
  boundary?: RetainedPostBoundary | null
): boolean {
  const incomingTime = incoming.createdAt ? Date.parse(incoming.createdAt) : Number.NaN
  if (!Number.isFinite(incomingTime)) return false
  if (!boundary) return true

  const boundaryTime = boundary.createdAt ? Date.parse(boundary.createdAt) : Number.NaN
  if (!Number.isFinite(boundaryTime)) return true
  if (incomingTime !== boundaryTime) return incomingTime > boundaryTime

  // Stable tie-breaker for records that share the same published timestamp.
  return incoming.uri > boundary.uri
}

export function publicPostCountDelta(
  previousVisibility: unknown,
  nextVisibility: unknown,
  evictedVisibility?: unknown
): number {
  const previous = previousVisibility === 'public' ? 1 : 0
  const next = nextVisibility === 'public' ? 1 : 0
  const evicted = evictedVisibility === 'public' ? 1 : 0
  return next - previous - evicted
}
