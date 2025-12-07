import { useEffect, useState } from 'react'
import { BlogCard } from '@/components/BlogCard'
import { getRecentPosts, type AppViewPost } from '@/lib/appview'
import type { BlogEntry, AuthorProfile } from '@/lib/atproto'

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

export function HomePage() {
  const [recentPosts, setRecentPosts] = useState<AppViewPost[]>([])
  const [loading, setLoading] = useState(true)
  const [appViewAvailable, setAppViewAvailable] = useState(false)

  useEffect(() => {
    async function loadRecentPosts() {
      try {
        const { posts } = await getRecentPosts(12)
        setRecentPosts(posts)
        setAppViewAvailable(true)
      } catch {
        // AppView not available, that's fine
        setAppViewAvailable(false)
      } finally {
        setLoading(false)
      }
    }

    loadRecentPosts()
  }, [])

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 text-[var(--site-text)]">
            GreenGale
          </h1>
          <h2><i>Closed Beta</i></h2>
          <p className="text-xl text-[var(--site-text-secondary)] max-w-2xl mx-auto">
            A markdown blog platform built on AT Protocol. Compatible with WhiteWind
            and powered by your <a href="https://internethandle.org/">Internet handle.</a>
          </p>
        </div>

        <div className="bg-[var(--site-bg-secondary)] rounded-lg p-8 mb-12 border border-[var(--site-border)]">
          <h2 className="text-xl font-bold mb-4 text-[var(--site-text)]">
            View a Blog
          </h2>
          <p className="text-[var(--site-text-secondary)] mb-4">
            Enter an @ handle to view their blog posts:
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const form = e.target as HTMLFormElement
              const input = form.elements.namedItem('handle') as HTMLInputElement
              const handle = input.value.trim().replace('@', '')
              if (handle) {
                window.location.href = `/${handle}`
              }
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              name="handle"
              placeholder="handle.bsky.social"
              className="flex-1 px-4 py-2 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] placeholder:text-[var(--site-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)] focus:border-transparent"
            />
            <button
              type="submit"
              className="px-6 py-2 bg-[var(--site-accent)] text-white rounded-lg hover:bg-[var(--site-accent-hover)] transition-colors font-medium"
            >
              View Blog
            </button>
          </form>
        </div>

        {/* Recent Posts Section */}
        {appViewAvailable && recentPosts.length > 0 && (
          <div className="mb-12">
            <h2 className="text-xl font-bold mb-6 text-[var(--site-text)]">
              Recent Posts
            </h2>
            <div className="grid md:grid-cols-2 gap-6">
              {recentPosts.map((post) => (
                <BlogCard
                  key={post.uri}
                  entry={toBlogEntry(post)}
                  author={toAuthorProfile(post)}
                />
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="mb-12">
            <h2 className="text-xl font-bold mb-6 text-[var(--site-text)]">
              Recent Posts
            </h2>
            <div className="grid md:grid-cols-2 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-48 bg-[var(--site-border)] rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-8">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--site-accent)]/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-[var(--site-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="font-bold mb-2 text-[var(--site-text)]">WhiteWind Compatible</h3>
            <p className="text-sm text-[var(--site-text-secondary)]">
              View and create WhiteWind blog posts without any migration needed.
            </p>
          </div>

          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--site-accent)]/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-[var(--site-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
              </svg>
            </div>
            <h3 className="font-bold mb-2 text-[var(--site-text)]">Theme Selection</h3>
            <p className="text-sm text-[var(--site-text-secondary)]">
              Choose from preset themes to match your style. Themes are applied per post.
            </p>
          </div>

          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--site-accent)]/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-[var(--site-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="font-bold mb-2 text-[var(--site-text)]">KaTeX Support</h3>
            <p className="text-sm text-[var(--site-text-secondary)]">
              Write mathematical equations with full KaTeX rendering support.
            </p>
          </div>
        </div>

        <div className="mt-16 text-center text-sm text-[var(--site-text-secondary)]">
          <p>
            Your data lives on AT Protocol. GreenGale is just a viewer.{' '}
            <a
              href="https://atproto.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--site-accent)] hover:underline"
            >
              Learn more about AT Protocol
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
