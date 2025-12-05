import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { BlogCard } from '@/components/BlogCard'
import {
  getAuthorProfile,
  listBlogEntries,
  type BlogEntry,
  type AuthorProfile,
} from '@/lib/atproto'

export function AuthorPage() {
  const { handle } = useParams<{ handle: string }>()
  const [author, setAuthor] = useState<AuthorProfile | null>(null)
  const [entries, setEntries] = useState<BlogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!handle) return

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const [profileResult, entriesResult] = await Promise.all([
          getAuthorProfile(handle!),
          listBlogEntries(handle!),
        ])

        setAuthor(profileResult)
        setEntries(entriesResult.entries)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load author')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [handle])

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="animate-pulse">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-16 h-16 rounded-full bg-[var(--site-border)]"></div>
              <div>
                <div className="h-6 bg-[var(--site-border)] rounded w-48 mb-2"></div>
                <div className="h-4 bg-[var(--site-border)] rounded w-32"></div>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-48 bg-[var(--site-border)] rounded-lg"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen">
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
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Author Header */}
        {author && (
          <div className="mb-12">
            <div className="flex items-center gap-4 mb-4">
              {author.avatar ? (
                <img
                  src={author.avatar}
                  alt={author.displayName || author.handle}
                  className="w-16 h-16 rounded-full object-cover"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-[var(--site-accent)] flex items-center justify-center text-white text-2xl font-bold">
                  {(author.displayName || author.handle).charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <h1 className="text-2xl font-bold text-[var(--site-text)]">
                  {author.displayName || author.handle}
                </h1>
                <p className="text-[var(--site-text-secondary)]">
                  @{author.handle}
                </p>
              </div>
            </div>
            {author.description && (
              <p className="text-[var(--site-text-secondary)] max-w-2xl">
                {author.description}
              </p>
            )}
            <div className="mt-4">
              <a
                href={`https://bsky.app/profile/${author.handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--site-accent)] hover:underline"
              >
                View on Bluesky →
              </a>
            </div>
          </div>
        )}

        {/* Blog Entries */}
        {entries.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[var(--site-text-secondary)]">
              No blog posts found for this author.
            </p>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-bold mb-6 text-[var(--site-text)]">
              Blog Posts ({entries.length})
            </h2>
            <div className="grid md:grid-cols-2 gap-6">
              {entries.map((entry) => (
                <BlogCard key={entry.uri} entry={entry} author={author || undefined} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
