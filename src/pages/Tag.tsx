import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { BlogCard } from '@/components/BlogCard'
import { getPostsByTag, type AppViewPost } from '@/lib/appview'
import type { BlogEntry, AuthorProfile } from '@/lib/atproto'
import { useDocumentMeta, buildHomeCanonical } from '@/lib/useDocumentMeta'

// Convert AppView post to BlogEntry format for BlogCard
function toBlogEntry(post: AppViewPost): BlogEntry {
  return {
    uri: post.uri,
    cid: '', // AppView doesn't return CID
    authorDid: post.authorDid,
    rkey: post.rkey,
    title: post.title || undefined,
    subtitle: post.subtitle || undefined,
    content: '', // AppView doesn't return full content
    createdAt: post.createdAt || undefined,
    source: post.source,
  }
}

function toAuthorProfile(post: AppViewPost): AuthorProfile | undefined {
  if (!post.author) return undefined
  return {
    did: post.author.did,
    handle: post.author.handle,
    displayName: post.author.displayName || undefined,
    avatar: post.author.avatar || undefined,
  }
}

export function TagPage() {
  const { tag } = useParams<{ tag: string }>()
  const decodedTag = tag ? decodeURIComponent(tag) : ''

  const [posts, setPosts] = useState<AppViewPost[]>([])
  const [loading, setLoading] = useState(true)
  const [cursor, setCursor] = useState<string | undefined>()
  const [loadCount, setLoadCount] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Set document metadata
  useDocumentMeta({
    title: `#${decodedTag} - GreenGale`,
    canonical: buildHomeCanonical(),
    description: `Posts tagged with #${decodedTag}`,
  })

  useEffect(() => {
    async function loadPosts() {
      if (!decodedTag) return

      setLoading(true)
      setError(null)

      try {
        const { posts: fetchedPosts, cursor: nextCursor } = await getPostsByTag(decodedTag, 24)
        setPosts(fetchedPosts)
        setCursor(nextCursor)
      } catch (err) {
        console.error('Failed to load posts by tag:', err)
        setError('Failed to load posts')
      } finally {
        setLoading(false)
      }
    }

    loadPosts()
  }, [decodedTag])

  async function handleLoadMore() {
    if (!cursor || loadingMore || loadCount >= 12) return
    setLoadingMore(true)
    try {
      const { posts: morePosts, cursor: nextCursor } = await getPostsByTag(decodedTag, 24, cursor)
      setPosts((prev) => [...prev, ...morePosts])
      setCursor(nextCursor)
      setLoadCount((prev) => prev + 1)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-[var(--site-text-secondary)] hover:text-[var(--site-text)] transition-colors mb-4"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Home
          </Link>
          <h1 className="text-3xl font-bold text-[var(--site-text)]">
            <span className="text-[var(--site-accent)]">#</span>
            {decodedTag}
          </h1>
        </div>

        {/* Posts */}
        {loading ? (
          <div className="grid md:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-48 bg-[var(--site-border)] rounded-lg animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-red-500 mb-4">{error}</p>
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-[var(--site-accent)] hover:underline"
            >
              Return to Home
            </Link>
          </div>
        ) : posts.length > 0 ? (
          <>
            <div className="grid md:grid-cols-2 gap-6">
              {posts.map((post) => (
                <BlogCard
                  key={post.uri}
                  entry={toBlogEntry(post)}
                  author={toAuthorProfile(post)}
                  tags={post.tags}
                />
              ))}
            </div>
            {cursor && loadCount < 12 && (
              <div className="mt-8 text-center">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="px-6 py-2 bg-[var(--site-bg-secondary)] text-[var(--site-text)] rounded-lg border border-[var(--site-border)] hover:border-[var(--site-text-secondary)] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loadingMore ? 'Loading...' : 'More'}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12">
            <p className="text-[var(--site-text-secondary)] mb-4">No posts found with this tag.</p>
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-[var(--site-accent)] hover:underline"
            >
              Return to Home
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
