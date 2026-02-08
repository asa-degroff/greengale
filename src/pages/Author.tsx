import { useEffect, useState, useCallback, useMemo, useRef, lazy, Suspense } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { BlogCard } from '@/components/BlogCard'
import { MasonryGrid } from '@/components/MasonryGrid'
// Lazy load the publication editor modal (only ~5% of users interact with it)
const PublicationEditorModal = lazy(() =>
  import('@/components/PublicationEditorModal').then((m) => ({ default: m.PublicationEditorModal }))
)
import { AuthorPageLoading } from '@/components/PageLoading'
import { useAuth } from '@/lib/auth'
import {
  getPublication,
  savePublication,
  getAuthorExternalLinks,
  togglePinnedPost,
  type BlogEntry,
  type Publication,
} from '@/lib/atproto'
import { getAuthorPosts, getAuthorProfile, getPost, type AppViewAuthor, type AppViewPost } from '@/lib/appview'
import { useRecentAuthors } from '@/lib/useRecentAuthors'
import { useThemePreference } from '@/lib/useThemePreference'
import { getEffectiveTheme, correctCustomColorsContrast } from '@/lib/themes'
import {
  useDocumentMeta,
  buildAuthorCanonical,
  buildAuthorOgImage,
  buildAuthorRSSFeed,
} from '@/lib/useDocumentMeta'
import { linkifyText } from '@/lib/bluesky'

export function AuthorPage() {
  const { handle } = useParams<{ handle: string }>()
  const navigate = useNavigate()
  const { session } = useAuth()
  const [author, setAuthor] = useState<AppViewAuthor | null>(null)
  const [posts, setPosts] = useState<AppViewPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Pagination state
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadingMoreRef = useRef(false)
  const { addRecentAuthor } = useRecentAuthors()

  // Publication state
  const [publication, setPublication] = useState<Publication | null>(null)
  const [showPublicationModal, setShowPublicationModal] = useState(false)
  const [blentoUrl, setBlentoUrl] = useState<string | null>(null)
  const { setActivePostTheme, setActiveCustomColors } = useThemePreference()

  // Check if current user is the author
  const isOwnProfile = session?.did && author?.did && session.did === author.did

  // Use the canonical handle from author data, or fall back to URL param
  const canonicalHandle = author?.handle || handle || ''

  // Set document metadata (title, canonical URL, OG tags, RSS feed)
  useDocumentMeta({
    title: publication?.name || author?.displayName || canonicalHandle
      ? `${publication?.name || author?.displayName || canonicalHandle}'s Blog`
      : undefined,
    canonical: canonicalHandle ? buildAuthorCanonical(canonicalHandle) : undefined,
    description: publication?.description || author?.description || undefined,
    ogImage: canonicalHandle ? buildAuthorOgImage(canonicalHandle) : undefined,
    rssFeed: canonicalHandle ? {
      title: `${publication?.name || author?.displayName || canonicalHandle}'s Blog RSS`,
      href: buildAuthorRSSFeed(canonicalHandle),
    } : undefined,
  })

  useEffect(() => {
    if (!handle) return

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const INITIAL_LIMIT = 24
        const [profileResult, postsResult, publicationResult, externalLinks] = await Promise.all([
          getAuthorProfile(handle!),
          getAuthorPosts(handle!, INITIAL_LIMIT, undefined, session?.did),
          getPublication(handle!).catch(() => null),
          getAuthorExternalLinks(handle!).catch(() => ({})),
        ])

        // Handle author not found
        if (!profileResult) {
          setError('Author not found')
          return
        }

        // Check if handle has changed - redirect to canonical URL
        if (profileResult.handle.toLowerCase() !== handle!.toLowerCase()) {
          navigate(`/${profileResult.handle}`, { replace: true })
          return
        }

        setAuthor(profileResult)

        // Fetch any pinned posts that aren't in the first page of results
        let allPosts = postsResult.posts
        const pinnedRkeys = publicationResult?.pinnedPosts
        if (pinnedRkeys?.length) {
          const loadedRkeys = new Set(allPosts.map(p => p.rkey))
          const missingRkeys = pinnedRkeys.filter(rkey => !loadedRkeys.has(rkey))
          if (missingRkeys.length > 0) {
            const missing = await Promise.all(
              missingRkeys.map(rkey => getPost(profileResult.did, rkey, session?.did).catch(() => null))
            )
            const found = missing.filter((p): p is AppViewPost => p !== null)
            if (found.length > 0) {
              allPosts = [...allPosts, ...found]
            }
          }
        }

        setPosts(allPosts)
        setCursor(postsResult.cursor)
        setHasMore(!!postsResult.cursor)
        setPublication(publicationResult)
        setBlentoUrl(('blentoUrl' in externalLinks ? externalLinks.blentoUrl : undefined) || null)

        // Apply publication theme if it exists
        if (publicationResult?.theme) {
          if (publicationResult.theme.custom) {
            setActivePostTheme('custom')
            setActiveCustomColors(correctCustomColorsContrast(publicationResult.theme.custom))
          } else {
            const themePreset = getEffectiveTheme(publicationResult.theme)
            setActivePostTheme(themePreset)
            setActiveCustomColors(null)
          }
        }

        // Track this author as recently viewed
        addRecentAuthor({
          handle: profileResult.handle,
          displayName: profileResult.displayName || undefined,
          avatarUrl: profileResult.avatar || undefined,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load author')
      } finally {
        setLoading(false)
      }
    }

    load()

    // Reset theme and pagination when leaving the page
    return () => {
      setActivePostTheme(null)
      setActiveCustomColors(null)
    }
  }, [handle, session?.did, addRecentAuthor, navigate, setActivePostTheme, setActiveCustomColors])

  // Load more posts
  const loadMore = useCallback(async () => {
    if (!handle || !cursor || loadingMoreRef.current) return

    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const BATCH_SIZE = 24
      const result = await getAuthorPosts(handle, BATCH_SIZE, cursor, session?.did)
      setPosts(prev => {
        const existing = new Set(prev.map(p => p.rkey))
        const newPosts = result.posts.filter(p => !existing.has(p.rkey))
        return [...prev, ...newPosts]
      })
      setCursor(result.cursor)
      setHasMore(!!result.cursor)
    } catch (err) {
      console.error('Error loading more posts:', err)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [handle, cursor, session?.did])

  // Filter out posts from hidden external domains
  const filteredPosts = useMemo(() => {
    const hidden = publication?.hiddenExternalDomains
    if (!hidden?.length) return posts
    const hiddenSet = new Set(hidden)
    return posts.filter((post) => {
      if (!post.externalUrl) return true
      try {
        const domain = new URL(post.externalUrl).hostname.replace(/^www\./, '')
        return !hiddenSet.has(domain)
      } catch {
        return true
      }
    })
  }, [posts, publication?.hiddenExternalDomains])

  // Pre-map AppViewPosts to BlogEntry objects so BlogCard gets stable references
  const cardEntries = useMemo(() =>
    filteredPosts.map((post) => ({
      post,
      entry: {
        uri: post.uri,
        cid: '',
        authorDid: post.authorDid,
        rkey: post.rkey,
        title: post.title || 'Untitled',
        subtitle: post.subtitle || undefined,
        content: '',
        createdAt: post.createdAt || undefined,
        source: post.source === 'network' ? 'greengale' : post.source,
        visibility: post.visibility as 'public' | 'url' | 'author',
        externalUrl: post.externalUrl || undefined,
        tags: post.tags,
      } satisfies BlogEntry,
    })),
    [filteredPosts]
  )

  // Pinned posts logic
  const pinnedRkeys = useMemo(() => new Set(publication?.pinnedPosts || []), [publication?.pinnedPosts])

  // Merge pinned posts at the top, followed by unpinned in original order
  const sortedEntries = useMemo(() => {
    if (pinnedRkeys.size === 0) return cardEntries
    const pinned = cardEntries.filter(({ post }) => pinnedRkeys.has(post.rkey))
    const unpinned = cardEntries.filter(({ post }) => !pinnedRkeys.has(post.rkey))
    // Sort pinned to match publication array order
    const order = publication?.pinnedPosts || []
    pinned.sort((a, b) => order.indexOf(a.post.rkey) - order.indexOf(b.post.rkey))
    return [...pinned, ...unpinned]
  }, [cardEntries, pinnedRkeys, publication?.pinnedPosts])

  const handleTogglePin = useCallback(async (rkey: string) => {
    if (!session) return
    const prev = publication
    const currentPins = publication?.pinnedPosts
    const newPins = togglePinnedPost(currentPins, rkey)
    // Optimistic update
    const basePub = publication || { name: author?.displayName || handle || '', url: `https://greengale.app/${handle}` }
    const updated = { ...basePub, pinnedPosts: newPins.length ? newPins : undefined }
    setPublication(updated)
    try {
      await savePublication(
        { did: session.did, fetchHandler: (url: string, options: RequestInit) => session.fetchHandler(url, options) },
        updated,
      )
    } catch (err) {
      console.error('Failed to save pinned posts:', err)
      setPublication(prev)
    }
  }, [session, publication, author?.displayName, handle])

  // Open publication editor
  const openPublicationEditor = useCallback(() => {
    setShowPublicationModal(true)
  }, [])

  if (loading) {
    return <AuthorPageLoading />
  }

  if (error) {
    return (
      <div>
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4 text-[var(--site-text)]">
              Error Loading Author
            </h1>
            <p className="text-[var(--site-text-secondary)] mb-6">{error}</p>
            <Link
              to="/"
              className="text-[var(--site-accent)] hover:underline"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Author Header */}
        {author && (
          <div className="mb-12">
            <div className="flex items-start gap-4 mb-4">
              {(publication?.iconUrl || author.avatar) ? (
                <img
                  src={publication?.iconUrl || author.avatar || undefined}
                  alt={author.displayName || author.handle}
                  className="w-16 h-16 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-[var(--site-accent)] flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
                  {(author.displayName || author.handle).charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-bold text-[var(--site-text)]">
                      {publication?.name || author.displayName || author.handle}
                    </h1>
                    <p className="text-[var(--site-text-secondary)]">
                      @{author.handle}
                    </p>
                  </div>
                  {isOwnProfile && (
                    <button
                      onClick={openPublicationEditor}
                      className="flex-shrink-0 px-3 py-1.5 text-sm border border-[var(--site-border)] rounded-md hover:bg-[var(--site-bg-secondary)] text-[var(--site-text)] transition-colors"
                    >
                      {publication ? 'Edit Publication' : 'Set Up Publication'}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {publication?.description && (
              <p className="text-[var(--site-text)] max-w-2xl mb-3 whitespace-pre-line">
                {publication.description.replace(/\n{3,}/g, '\n\n')}
              </p>
            )}
            {author.description && !publication?.hideBlueskyBio && (
              <p className="text-[var(--site-text-secondary)] max-w-2xl whitespace-pre-line">
                {linkifyText(author.description.replace(/\n{3,}/g, '\n\n'))}
              </p>
            )}
            <div className="mt-4 flex items-center gap-4">
              <a
                href={`https://bsky.app/profile/${author.handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-[var(--site-accent)] hover:underline"
              >
                <svg
                  viewBox="0 0 568 501"
                  fill="currentColor"
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  <path d="M123.121 33.6637C188.241 82.5526 258.281 181.681 284 234.873C309.719 181.681 379.759 82.5526 444.879 33.6637C491.866 -1.61183 568 -28.9064 568 57.9464C568 75.2916 558.055 203.659 552.222 224.501C531.947 296.954 458.067 315.434 392.347 304.249C507.222 323.8 536.444 388.56 473.333 453.32C353.473 576.312 301.061 422.461 287.631 383.039C285.169 373.096 284.017 368.617 284 368.617C283.983 368.617 282.831 373.096 280.369 383.039C266.939 422.461 214.527 576.312 94.6667 453.32C31.5556 388.56 60.7778 323.8 175.653 304.249C109.933 315.434 36.0533 296.954 15.7778 224.501C9.94525 203.659 0 75.2916 0 57.9464C0 -28.9064 76.1345 -1.61183 123.121 33.6637Z" />
                </svg>
                Bluesky
              </a>
              <a
                href={`/${author.handle}/rss`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-[var(--site-accent)] hover:underline"
                title="RSS Feed"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  <circle cx="6" cy="18" r="2" />
                  <path d="M4 12a8 8 0 0 1 8 8h2A10 10 0 0 0 4 10v2Z" />
                  <path d="M4 6a14 14 0 0 1 14 14h2A16 16 0 0 0 4 4v2Z" />
                </svg>
                RSS
              </a>
              {blentoUrl && !publication?.hiddenExternalDomains?.includes('blento.app') && (
                <a
                  href={blentoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-[var(--site-accent)] hover:underline"
                >
                  <img
                    src="/icons/platforms/blento.png"
                    alt=""
                    className="w-4 h-4 rounded-sm"
                    aria-hidden="true"
                  />
                  Blento
                </a>
              )}
            </div>
          </div>
        )}

        {/* Blog Entries */}
        {cardEntries.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[var(--site-text-secondary)]">
              No blog posts found for this author.
            </p>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-bold mb-6 text-[var(--site-text)]">
              Blog Posts
            </h2>
            <MasonryGrid columns={{ default: 1, md: 2 }} gap={24}>
              {sortedEntries.map(({ post, entry }) => (
                <BlogCard
                  key={post.uri}
                  entry={entry}
                  author={author ? {
                    did: author.did,
                    handle: author.handle,
                    displayName: author.displayName || undefined,
                    avatar: author.avatar || undefined,
                    description: author.description || undefined,
                  } : undefined}
                  externalUrl={post.externalUrl}
                  tags={post.tags}
                  contentPreview={post.contentPreview}
                  firstImageCid={post.firstImageCid}
                  pdsEndpoint={post.author?.pdsEndpoint}
                  isPinned={pinnedRkeys.has(post.rkey)}
                  onTogglePin={isOwnProfile ? handleTogglePin : undefined}
                  pinCount={pinnedRkeys.size}
                />
              ))}
            </MasonryGrid>
            {/* Load More Button */}
            {hasMore && (
              <div className="flex justify-center mt-8">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-6 py-2 text-sm border border-[var(--site-border)] rounded-md hover:bg-[var(--site-bg-secondary)] text-[var(--site-text)] disabled:opacity-50 transition-colors"
                >
                  {loadingMore ? 'Loading...' : 'More'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Publication Editor Modal (lazy-loaded) */}
      {showPublicationModal && session && (
        <Suspense fallback={null}>
          <PublicationEditorModal
            publication={publication}
            handle={handle || ''}
            session={session}
            onClose={() => setShowPublicationModal(false)}
            onSave={setPublication}
            setActivePostTheme={setActivePostTheme}
            setActiveCustomColors={setActiveCustomColors}
          />
        </Suspense>
      )}
    </div>
  )
}
