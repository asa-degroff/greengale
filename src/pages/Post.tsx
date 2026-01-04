import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { BlogViewer } from '@/components/BlogViewer'
import { useAuth } from '@/lib/auth'
import {
  getBlogEntry,
  getAuthorProfile,
  getPublication,
  type BlogEntry,
  type AuthorProfile,
} from '@/lib/atproto'
import { useThemePreference } from '@/lib/useThemePreference'
import { getEffectiveTheme, correctCustomColorsContrast, type Theme } from '@/lib/themes'
import { useRecentAuthors } from '@/lib/useRecentAuthors'

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { setActivePostTheme, setActiveCustomColors } = useThemePreference()
  const { addRecentAuthor } = useRecentAuthors()

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

        // Update page title
        if (entryResult.title) {
          document.title = `${entryResult.title} - GreenGale`
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load post')
      } finally {
        setLoading(false)
      }
    }

    load()

    return () => {
      document.title = 'GreenGale'
      setActivePostTheme(null) // Reset theme when leaving post
      setActiveCustomColors(null)
    }
  }, [handle, rkey, session?.did, setActivePostTheme, setActiveCustomColors, addRecentAuthor, navigate])

  // Add site.standard document verification link tag
  useEffect(() => {
    if (!entry?.uri) return

    const link = document.createElement('link')
    link.rel = 'site.standard.document'
    link.href = entry.uri
    document.head.appendChild(link)

    return () => {
      link.remove()
    }
  }, [entry?.uri])

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="max-w-3xl mx-auto px-4 py-12">
          <div className="animate-pulse">
            <div className="h-10 bg-[var(--site-border)] rounded w-3/4 mb-4"></div>
            <div className="h-6 bg-[var(--site-border)] rounded w-1/2 mb-8"></div>
            <div className="space-y-4">
              <div className="h-4 bg-[var(--site-border)] rounded w-full"></div>
              <div className="h-4 bg-[var(--site-border)] rounded w-full"></div>
              <div className="h-4 bg-[var(--site-border)] rounded w-5/6"></div>
              <div className="h-4 bg-[var(--site-border)] rounded w-full"></div>
              <div className="h-4 bg-[var(--site-border)] rounded w-4/5"></div>
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
      />
    </div>
  )
}
