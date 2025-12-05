import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { BlogViewer } from '@/components/BlogViewer'
import {
  getBlogEntry,
  getAuthorProfile,
  type BlogEntry,
  type AuthorProfile,
} from '@/lib/atproto'
import { useThemePreference } from '@/lib/useThemePreference'
import { getEffectiveTheme } from '@/lib/themes'

export function PostPage() {
  const { handle, rkey } = useParams<{ handle: string; rkey: string }>()
  const [entry, setEntry] = useState<BlogEntry | null>(null)
  const [author, setAuthor] = useState<AuthorProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { setActivePostTheme } = useThemePreference()

  useEffect(() => {
    if (!handle || !rkey) return

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const [entryResult, authorResult] = await Promise.all([
          getBlogEntry(handle!, rkey!),
          getAuthorProfile(handle!),
        ])

        if (!entryResult) {
          setError('Blog post not found')
          return
        }

        setEntry(entryResult)
        setAuthor(authorResult)

        // Set active theme from post
        const postTheme = getEffectiveTheme(entryResult.theme)
        setActivePostTheme(postTheme)

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
    }
  }, [handle, rkey, setActivePostTheme])

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

  return (
    <div className="min-h-screen">
      <nav className="max-w-3xl mx-auto px-4 py-4">
        <Link
          to={`/${handle}`}
          className="text-sm text-[var(--site-text-secondary)] hover:text-[var(--site-accent)]"
        >
          ← Back to {author?.displayName || handle}'s posts
        </Link>
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
      />
    </div>
  )
}
