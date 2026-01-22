import { useEffect, useState } from 'react'
import { BlogCard } from '@/components/BlogCard'
import { TextLogo } from '@/components/TextLogo'
import { PublicationSearch } from '@/components/PublicationSearch'
import { LoadingCube } from '@/components/LoadingCube'
import { getRecentPosts, getNetworkPosts, type AppViewPost } from '@/lib/appview'
import type { BlogEntry, AuthorProfile } from '@/lib/atproto'
import {
  useDocumentMeta,
  buildHomeCanonical,
  buildHomeOgImage,
} from '@/lib/useDocumentMeta'

type FeedTab = 'greengale' | 'network'

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
    tags: post.tags,
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
  const [activeTab, setActiveTab] = useState<FeedTab>('greengale')

  // GreenGale feed state
  const [recentPosts, setRecentPosts] = useState<AppViewPost[]>([])
  const [loading, setLoading] = useState(true)
  const [appViewAvailable, setAppViewAvailable] = useState(false)
  const [cursor, setCursor] = useState<string | undefined>()
  const [loadCount, setLoadCount] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)

  // Network feed state
  const [networkPosts, setNetworkPosts] = useState<AppViewPost[]>([])
  const [networkLoading, setNetworkLoading] = useState(false)
  const [networkLoaded, setNetworkLoaded] = useState(false)
  const [networkCursor, setNetworkCursor] = useState<string | undefined>()
  const [networkLoadCount, setNetworkLoadCount] = useState(1)
  const [networkLoadingMore, setNetworkLoadingMore] = useState(false)

  // Set document metadata (title, canonical URL, OG tags)
  useDocumentMeta({
    title: 'GreenGale',
    canonical: buildHomeCanonical(),
    description: 'Markdown blog platform powered by your internet handle. WhiteWind support and Standard Site indexing.',
    ogImage: buildHomeOgImage(),
  })

  useEffect(() => {
    async function loadRecentPosts() {
      try {
        const { posts, cursor: nextCursor } = await getRecentPosts(24)
        setRecentPosts(posts)
        setCursor(nextCursor)
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

  async function handleLoadMore() {
    if (!cursor || loadingMore || loadCount >= 12) return
    setLoadingMore(true)
    try {
      const { posts, cursor: nextCursor } = await getRecentPosts(24, cursor)
      setRecentPosts(prev => [...prev, ...posts])
      setCursor(nextCursor)
      setLoadCount(prev => prev + 1)
    } finally {
      setLoadingMore(false)
    }
  }

  // Lazy-load network posts when tab is switched
  useEffect(() => {
    if (activeTab === 'network' && !networkLoaded && !networkLoading) {
      loadNetworkPosts()
    }
  }, [activeTab, networkLoaded, networkLoading])

  async function loadNetworkPosts() {
    setNetworkLoading(true)
    try {
      const { posts, cursor: nextCursor } = await getNetworkPosts(24)
      setNetworkPosts(posts)
      setNetworkCursor(nextCursor)
      setNetworkLoaded(true)
    } catch {
      // Network feed not available
    } finally {
      setNetworkLoading(false)
    }
  }

  async function handleLoadMoreNetwork() {
    if (!networkCursor || networkLoadingMore || networkLoadCount >= 12) return
    setNetworkLoadingMore(true)
    try {
      const { posts, cursor: nextCursor } = await getNetworkPosts(24, networkCursor)
      setNetworkPosts(prev => [...prev, ...posts])
      setNetworkCursor(nextCursor)
      setNetworkLoadCount(prev => prev + 1)
    } finally {
      setNetworkLoadingMore(false)
    }
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <TextLogo className="h-8 md:h-10 mx-auto mb-4 text-[var(--site-text)]" />
          <h2><i>Beta</i></h2>
          <p className="text-xl text-[var(--site-text-secondary)] max-w-2xl mx-auto">
            Markdown blog platform powered by your <a href="https://internethandle.org/">internet handle. WhiteWind support and Standard Site indexing.</a>
          </p>
        </div>

        <div className="bg-[var(--site-bg-secondary)] rounded-lg p-8 mb-12 border border-[var(--site-border)]">
          <h2 className="text-xl font-bold mb-4 text-[var(--site-text)]">
            Find a Blog
          </h2>
          <p className="text-[var(--site-text-secondary)] mb-4">
            Search by handle, display name, publication name, title, or URL:
          </p>
          <PublicationSearch className="w-full" />
        </div>

        {/* Posts Section with Tabs */}
        {appViewAvailable && (
          <div className="mb-12">
            {/* Tab navigation */}
            <div className="flex gap-1 mb-6 border-b border-[var(--site-border)]">
              <button
                onClick={() => setActiveTab('greengale')}
                className={`px-4 py-2 font-medium transition-colors relative ${
                  activeTab === 'greengale'
                    ? 'text-[var(--site-accent)]'
                    : 'text-[var(--site-text-secondary)] hover:text-[var(--site-text)]'
                }`}
              >
                Recents
                {activeTab === 'greengale' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--site-accent)]" />
                )}
              </button>
              <button
                onClick={() => setActiveTab('network')}
                className={`px-4 py-2 font-medium transition-colors relative ${
                  activeTab === 'network'
                    ? 'text-[var(--site-accent)]'
                    : 'text-[var(--site-text-secondary)] hover:text-[var(--site-text)]'
                }`}
              >
                From the Network (Beta)
                {activeTab === 'network' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--site-accent)]" />
                )}
              </button>
            </div>

            {/* GreenGale feed */}
            {activeTab === 'greengale' && (
              <>
                {recentPosts.length > 0 ? (
                  <>
                    <div className="grid md:grid-cols-2 gap-6">
                      {recentPosts.map((post) => (
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
                ) : !loading && (
                  <p className="text-center text-[var(--site-text-secondary)] py-8">
                    No posts yet.
                  </p>
                )}
              </>
            )}

            {/* Network feed */}
            {activeTab === 'network' && (
              <>
                {networkLoading ? (
                  <div className="flex flex-col items-center py-12">
                    <LoadingCube size="md" />
                    <p className="mt-6 text-sm text-[var(--site-text-secondary)]">
                      Loading network posts...
                    </p>
                  </div>
                ) : networkPosts.length > 0 ? (
                  <>
                    <div className="grid md:grid-cols-2 gap-6">
                      {networkPosts.map((post) => (
                        <BlogCard
                          key={post.uri}
                          entry={toBlogEntry(post)}
                          author={toAuthorProfile(post)}
                          externalUrl={post.externalUrl}
                          tags={post.tags}
                        />
                      ))}
                    </div>
                    {networkCursor && networkLoadCount < 12 && (
                      <div className="mt-8 text-center">
                        <button
                          onClick={handleLoadMoreNetwork}
                          disabled={networkLoadingMore}
                          className="px-6 py-2 bg-[var(--site-bg-secondary)] text-[var(--site-text)] rounded-lg border border-[var(--site-border)] hover:border-[var(--site-text-secondary)] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {networkLoadingMore ? 'Loading...' : 'More'}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-center text-[var(--site-text-secondary)] py-8">
                    No network posts available yet.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {loading && (
          <div className="mb-12">
            <div className="flex gap-1 mb-6 border-b border-[var(--site-border)]">
              <div className="px-4 py-2 font-medium text-[var(--site-accent)] relative">
                Recents
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--site-accent)]" />
              </div>
              <div className="px-4 py-2 font-medium text-[var(--site-text-secondary)]">
                From the Network (Beta)
              </div>
            </div>
            <div className="flex flex-col items-center py-12">
              <LoadingCube size="lg" />
              <p className="mt-6 text-sm text-[var(--site-text-secondary)]">
                Loading recent posts...
              </p>
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
            <h3 className="font-bold mb-2 text-[var(--site-text)]">Cross-Platform</h3>
            <p className="text-sm text-[var(--site-text-secondary)]">
              View and create WhiteWind and GreenGale posts. Search all standard.site documents.
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
              Customize themes for each post or across the site.
            </p>
          </div>

          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--site-accent)]/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-[var(--site-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="font-bold mb-2 text-[var(--site-text)]">LaTeX Support</h3>
            <p className="text-sm text-[var(--site-text-secondary)]">
              Write mathematical equations with KaTeX rendering.
            </p>
          </div>
        </div>

        <div className="mt-16 text-center text-sm text-[var(--site-text-secondary)]">
          <p>
            Your data is owned by you and lives on AT Protocol.{' '}
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
