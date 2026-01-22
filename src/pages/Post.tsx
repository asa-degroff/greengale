import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { BlogViewer } from '@/components/BlogViewer'
import { LoadingCube } from '@/components/LoadingCube'
import { useAuth } from '@/lib/auth'
import {
  getBlogEntry,
  getAuthorProfile,
  getPublication,
  type BlogEntry,
  type AuthorProfile,
  type Publication,
} from '@/lib/atproto'
import { useThemePreference } from '@/lib/useThemePreference'
import { getEffectiveTheme, correctCustomColorsContrast, type Theme } from '@/lib/themes'
import { useRecentAuthors } from '@/lib/useRecentAuthors'
import {
  useDocumentMeta,
  buildPostCanonical,
  buildPostOgImage,
} from '@/lib/useDocumentMeta'

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
  const { session } = useAuth()
  const [entry, setEntry] = useState<BlogEntry | null>(null)
  const [author, setAuthor] = useState<AuthorProfile | null>(null)
  const [publication, setPublication] = useState<Publication | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { setActivePostTheme, setActiveCustomColors } = useThemePreference()
  const { addRecentAuthor } = useRecentAuthors()

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

  useEffect(() => {
    if (!handle || !rkey) return

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const [entryResult, authorResult, publicationResult] = await Promise.all([
          getBlogEntry(handle!, rkey!, session?.did),
          getAuthorProfile(handle!),
          getPublication(handle!).catch(() => null),
        ])

        if (!entryResult) {
          setError('Blog post not found')
          return
        }

        // Check if handle has changed - redirect to canonical URL
        if (authorResult.handle.toLowerCase() !== handle!.toLowerCase()) {
          navigate(`/${authorResult.handle}/${rkey}`, { replace: true })
          return
        }

        setEntry(entryResult)
        setAuthor(authorResult)
        setPublication(publicationResult)

        // Track this author as recently viewed
        addRecentAuthor({
          handle: authorResult.handle,
          displayName: authorResult.displayName,
          avatarUrl: authorResult.avatar,
        })

        // Set active theme with inheritance (post > publication > default)
        const effectiveTheme = getThemeWithInheritance(
          entryResult.theme,
          publicationResult?.theme
        )

        // Apply contrast correction for externally-created posts with low contrast
        if (effectiveTheme?.custom) {
          setActivePostTheme('custom')
          setActiveCustomColors(correctCustomColorsContrast(effectiveTheme.custom))
        } else {
          const themePreset = getEffectiveTheme(effectiveTheme)
          setActivePostTheme(themePreset)
          setActiveCustomColors(null)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load post')
      } finally {
        setLoading(false)
      }
    }

    load()

    return () => {
      setActivePostTheme(null) // Reset theme when leaving post
      setActiveCustomColors(null)
    }
  }, [handle, rkey, session?.did, setActivePostTheme, setActiveCustomColors, addRecentAuthor, navigate])

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
  useEffect(() => {
    // Only add if:
    // 1. We have the entry and author data
    // 2. The publication has site.standard enabled
    // 3. The post is from GreenGale (not WhiteWind)
    if (!entry || !publication?.enableSiteStandard || entry.source !== 'greengale') return

    const siteStandardDocUri = `at://${entry.authorDid}/site.standard.document/${entry.rkey}`

    const link = document.createElement('link')
    link.rel = 'site.standard.document'
    link.href = siteStandardDocUri
    document.head.appendChild(link)

    return () => {
      link.remove()
    }
  }, [entry, publication?.enableSiteStandard])

  // Add site.standard.publication link tag
  // This helps validators find the author's publication from the document page
  useEffect(() => {
    if (!author?.handle || !publication?.enableSiteStandard) return

    let cancelled = false
    const link = document.createElement('link')

    async function fetchPublicationUri() {
      try {
        // Fetch the publication AT-URI from the well-known endpoint
        const response = await fetch(
          `/.well-known/site.standard.publication?handle=${encodeURIComponent(author!.handle)}`
        )
        if (!response.ok || cancelled) return

        const uri = await response.text()
        if (cancelled || !uri.startsWith('at://')) return

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
      <div className="min-h-screen">
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
            <div className="h-10 rounded w-3/4 animate-cube-shimmer"></div>
            <div className="h-6 rounded w-1/2 animate-cube-shimmer" style={{ animationDelay: '0.1s' }}></div>
            <div className="space-y-3 mt-8">
              <div className="h-4 rounded w-full animate-cube-shimmer" style={{ animationDelay: '0.2s' }}></div>
              <div className="h-4 rounded w-full animate-cube-shimmer" style={{ animationDelay: '0.3s' }}></div>
              <div className="h-4 rounded w-5/6 animate-cube-shimmer" style={{ animationDelay: '0.4s' }}></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error || !entry) {
    return (
      <div className="min-h-screen">
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
    <div className="min-h-screen">
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
        postUrl={`${window.location.origin}/${handle}/${rkey}`}
        tags={entry.tags}
        publicationVoiceTheme={publication?.voiceTheme}
      />
    </div>
  )
}
