import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import { BlogViewer } from '@/components/BlogViewer'
import { LoadingCube } from '@/components/LoadingCube'
import { useAuth } from '@/lib/auth'
import {
  getBlogEntry,
  getPublication,
  type BlogEntry,
  type AuthorProfile,
  type Publication,
} from '@/lib/atproto'
import { getAuthorProfile } from '@/lib/appview'
import { cachePost, getCachedPost } from '@/lib/offline-store'
import { useThemePreference } from '@/lib/useThemePreference'
import { getEffectiveTheme, correctCustomColorsContrast, type Theme } from '@/lib/themes'
import { useRecentAuthors } from '@/lib/useRecentAuthors'
import {
  useDocumentMeta,
  buildPostCanonical,
  buildPostOgImage,
} from '@/lib/useDocumentMeta'

// Module-level cache for site.standard.publication URI lookups
const publicationUriCache = new Map<string, string>()

/**
 * Get the effective theme with publication fallback
 * Priority: Post theme > Publication theme > Default
 */
function getThemeWithInheritance(
  postTheme?: Theme,
  publicationTheme?: Theme
): Theme | undefined {
  // 1. Post-specific theme takes priority
  if (postTheme?.preset || postTheme?.custom) {
    return postTheme
  }
  // 2. Fall back to publication theme
  if (publicationTheme?.preset || publicationTheme?.custom) {
    return publicationTheme
  }
  // 3. Use site default (undefined = default)
  return undefined
}

export function PostPage() {
  const { handle, rkey } = useParams<{ handle: string; rkey: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { session } = useAuth()

  // Extract refetch signal from navigation state (set by Editor after saving)
  const refetchSignal = (location.state as { refetch?: number } | null)?.refetch
  const [entry, setEntry] = useState<BlogEntry | null>(null)
  const [author, setAuthor] = useState<AuthorProfile | null>(null)
  const [publication, setPublication] = useState<Publication | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const { setActivePostTheme, setActiveCustomColors } = useThemePreference()
  const { addRecentAuthor } = useRecentAuthors()

  // Apply post/publication theme to the global theme context
  const applyTheme = useCallback((postTheme?: Theme, publicationTheme?: Theme) => {
    const effectiveTheme = getThemeWithInheritance(postTheme, publicationTheme)
    if (effectiveTheme?.custom) {
      setActivePostTheme('custom')
      setActiveCustomColors(correctCustomColorsContrast(effectiveTheme.custom))
    } else {
      const themePreset = getEffectiveTheme(effectiveTheme)
      setActivePostTheme(themePreset)
      setActiveCustomColors(null)
    }
  }, [setActivePostTheme, setActiveCustomColors])

  // Use the canonical handle from author data, or fall back to URL param
  const canonicalHandle = author?.handle || handle || ''

  // Set document metadata (title, canonical URL, OG tags)
  useDocumentMeta({
    title: entry?.title,
    canonical: canonicalHandle && rkey ? buildPostCanonical(canonicalHandle, rkey) : undefined,
    description: entry?.subtitle,
    ogImage: canonicalHandle && rkey ? buildPostOgImage(canonicalHandle, rkey) : undefined,
    ogType: 'article',
  })

  // Track whether initial load has completed to avoid flashing on background refetches
  // (e.g., when session?.did changes from undefined to actual value after auth loads)
  const hasLoadedRef = useRef(false)

  // Reset the loaded flag when navigating to a different post
  useEffect(() => {
    hasLoadedRef.current = false
  }, [handle, rkey])

  // Track the last refetchSignal we processed to avoid re-processing on re-renders
  const processedRefetchSignalRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!handle || !rkey) return

    let cancelled = false

    // Check if this is a fresh-after-edit request (coming from editor)
    const isRefetchFromEditor = !!(refetchSignal && refetchSignal !== processedRefetchSignalRef.current)
    if (isRefetchFromEditor) {
      processedRefetchSignalRef.current = refetchSignal
      // Clear old data immediately so user doesn't see stale content
      setEntry(null)
      hasLoadedRef.current = false
    }

    async function load() {
      // Only show loading state on initial load or after edit, not on background refetches
      // This prevents the UI from flashing blank when session?.did changes
      if (!hasLoadedRef.current) {
        setLoading(true)
      }
      setError(null)
      setFromCache(false)

      try {
        const [entryResult, authorResult, publicationResult] = await Promise.all([
          getBlogEntry(handle!, rkey!, session?.did, { skipCache: isRefetchFromEditor }),
          getAuthorProfile(handle!),
          getPublication(handle!).catch(() => null),
        ])

        if (cancelled) return

        if (!entryResult) {
          setError('Blog post not found')
          return
        }

        // Convert AppViewAuthor to AuthorProfile format
        const author: AuthorProfile | null = authorResult ? {
          did: authorResult.did,
          handle: authorResult.handle,
          displayName: authorResult.displayName || undefined,
          avatar: authorResult.avatar || undefined,
          description: authorResult.description || undefined,
        } : null

        // Check if handle has changed - redirect to canonical URL
        if (author && author.handle.toLowerCase() !== handle!.toLowerCase()) {
          navigate(`/${author.handle}/${rkey}`, { replace: true })
          return
        }

        setEntry(entryResult)
        setAuthor(author)
        setPublication(publicationResult)
        hasLoadedRef.current = true

        applyTheme(entryResult.theme, publicationResult?.theme)

        // Cache for offline reading
        cachePost(
          handle!,
          rkey!,
          entryResult,
          author || { did: entryResult.authorDid, handle: handle! },
          publicationResult,
          !!(session?.did && entryResult.authorDid === session.did)
        )

        // Track this author as recently viewed
        if (author) {
          addRecentAuthor({
            handle: author.handle,
            displayName: author.displayName,
            avatarUrl: author.avatar,
          })
        }

      } catch (err) {
        if (cancelled) return

        // Try loading from offline cache
        if (!navigator.onLine) {
          const cached = await getCachedPost(handle!, rkey!)
          if (cached && !cancelled) {
            setEntry(cached.entry)
            setAuthor(cached.author)
            setPublication(cached.publication)
            setFromCache(true)
            hasLoadedRef.current = true

            applyTheme(cached.entry.theme, cached.publication?.theme)
            return
          }
        }

        setError(err instanceof Error ? err.message : 'Failed to load post')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [handle, rkey, session?.did, applyTheme, addRecentAuthor, navigate, refetchSignal])

  // Reset theme when leaving the post page (unmount only)
  useEffect(() => {
    return () => {
      setActivePostTheme(null)
      setActiveCustomColors(null)
    }
  }, [setActivePostTheme, setActiveCustomColors])

  // Add app.greengale document verification link tag
  useEffect(() => {
    if (!entry?.uri) return

    const link = document.createElement('link')
    link.rel = 'app.greengale.document'
    link.href = entry.uri
    document.head.appendChild(link)

    return () => {
      link.remove()
    }
  }, [entry?.uri])

  // Add site.standard.document link tag for posts that are dual-published
  const entryAuthorDid = entry?.authorDid
  const entryRkey = entry?.rkey
  const entrySource = entry?.source
  useEffect(() => {
    // Only add if:
    // 1. We have the entry and author data
    // 2. The publication has site.standard enabled
    // 3. The post is from GreenGale (not WhiteWind)
    if (!entryAuthorDid || !entryRkey || !publication?.enableSiteStandard || entrySource !== 'greengale') return

    const siteStandardDocUri = `at://${entryAuthorDid}/site.standard.document/${entryRkey}`

    const link = document.createElement('link')
    link.rel = 'site.standard.document'
    link.href = siteStandardDocUri
    document.head.appendChild(link)

    return () => {
      link.remove()
    }
  }, [entryAuthorDid, entryRkey, entrySource, publication?.enableSiteStandard])

  // Add site.standard.publication link tag
  // This helps validators find the author's publication from the document page
  useEffect(() => {
    if (!author?.handle || !publication?.enableSiteStandard) return

    let cancelled = false
    const link = document.createElement('link')

    async function fetchPublicationUri() {
      try {
        const handle = author!.handle
        const cached = publicationUriCache.get(handle)
        if (cached) {
          if (cancelled) return
          link.rel = 'site.standard.publication'
          link.href = cached
          document.head.appendChild(link)
          return
        }

        const response = await fetch(
          `/.well-known/site.standard.publication?handle=${encodeURIComponent(handle)}`
        )
        if (!response.ok || cancelled) return

        const uri = await response.text()
        if (cancelled || !uri.startsWith('at://')) return

        publicationUriCache.set(handle, uri)
        link.rel = 'site.standard.publication'
        link.href = uri
        document.head.appendChild(link)
      } catch {
        // Silently fail - publication link is not critical
      }
    }

    fetchPublicationUri()

    return () => {
      cancelled = true
      link.remove()
    }
  }, [author?.handle, publication?.enableSiteStandard])

  if (loading) {
    return (
      <div>
        <div className="max-w-3xl mx-auto px-4 py-12">
          {/* Centered cube */}
          <div className="flex flex-col items-center justify-center py-16">
            <LoadingCube size="lg" />
            <p className="mt-6 text-sm text-[var(--site-text-secondary)]">
              Loading post...
            </p>
          </div>
          {/* Skeleton content */}
          <div className="space-y-4 opacity-40">
            <div className="h-10 rounded w-3/4 bg-[var(--site-border)] animate-cube-shimmer"></div>
            <div className="h-6 rounded w-1/2 bg-[var(--site-border)] animate-cube-shimmer" style={{ animationDelay: '0.1s' }}></div>
            <div className="space-y-3 mt-8">
              <div className="h-4 rounded w-full bg-[var(--site-border)] animate-cube-shimmer" style={{ animationDelay: '0.2s' }}></div>
              <div className="h-4 rounded w-full bg-[var(--site-border)] animate-cube-shimmer" style={{ animationDelay: '0.3s' }}></div>
              <div className="h-4 rounded w-5/6 bg-[var(--site-border)] animate-cube-shimmer" style={{ animationDelay: '0.4s' }}></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error || !entry) {
    return (
      <div>
        <div className="max-w-3xl mx-auto px-4 py-12">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4 text-[var(--site-text)]">
              {error || 'Post Not Found'}
            </h1>
            <p className="text-[var(--site-text-secondary)] mb-6">
              The blog post you're looking for doesn't exist or couldn't be loaded.
            </p>
            <div className="flex gap-4 justify-center">
              {handle && (
                <Link
                  to={`/${handle}`}
                  className="text-[var(--site-accent)] hover:underline"
                >
                  View Author's Posts
                </Link>
              )}
              <Link
                to="/"
                className="text-[var(--site-accent)] hover:underline"
              >
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const isAuthor = session?.did && entry.authorDid === session.did

  return (
    <div>
      {fromCache && (
        <div className="max-w-3xl mx-auto px-4 pt-4">
          <div className="text-xs text-[var(--site-text-secondary)] bg-[var(--site-bg-secondary)] border border-[var(--site-border)] rounded px-3 py-1.5 inline-block">
            Offline — viewing cached copy
          </div>
        </div>
      )}
      <nav className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
        <Link
          to={`/${handle}`}
          className="text-sm text-[var(--site-text-secondary)] hover:text-[var(--site-accent)]"
        >
          ← Back to {author?.displayName || handle}'s posts
        </Link>
        {isAuthor && (
          <Link
            to={`/edit/${rkey}`}
            className="px-4 py-2 text-sm rounded-lg border border-[var(--site-border)] text-[var(--site-text-secondary)] hover:bg-[var(--site-bg-secondary)] transition-colors"
          >
            Edit Post
          </Link>
        )}
      </nav>
      <BlogViewer
        content={entry.content}
        title={entry.title}
        subtitle={entry.subtitle}
        createdAt={entry.createdAt}
        theme={entry.theme}
        latex={entry.latex || entry.source === 'greengale'}
        author={author || undefined}
        source={entry.source}
        blobs={entry.blobs}
        postUrl={`${window.location.origin}/${handle}/${rkey},https://whtwnd.com/${handle}/${rkey},${window.location.origin}/${entry.authorDid}/${rkey},https://whtwnd.com/${entry.authorDid}/${rkey}`}
        tags={entry.tags}
        publicationVoiceTheme={publication?.voiceTheme}
      />
    </div>
  )
}
