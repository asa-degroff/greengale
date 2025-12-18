import { useState, useEffect, useCallback } from 'react'
import { BlueskyPostCard } from './BlueskyPost'
import {
  getBlueskyInteractions,
  getBlueskyShareUrl,
  type BlueskyPost,
} from '@/lib/bluesky'

interface BlueskyInteractionsProps {
  postUrl: string
  postTitle?: string
}

type LoadingState = 'idle' | 'loading' | 'loaded' | 'error'

export function BlueskyInteractions({ postUrl, postTitle }: BlueskyInteractionsProps) {
  const [posts, setPosts] = useState<BlueskyPost[]>([])
  const [totalHits, setTotalHits] = useState<number | undefined>()
  const [loadingState, setLoadingState] = useState<LoadingState>('idle')

  const loadInteractions = useCallback(async () => {
    if (loadingState === 'loading') return

    setLoadingState('loading')

    try {
      const result = await getBlueskyInteractions(postUrl, {
        limit: 10,
        includeReplies: true,
      })

      setPosts(result.posts)
      setTotalHits(result.totalHits)
      setLoadingState('loaded')
    } catch (error) {
      console.error('Failed to load Bluesky interactions:', error)
      setLoadingState('error')
    }
  }, [postUrl, loadingState])

  // Auto-load discussions when postUrl changes
  useEffect(() => {
    setPosts([])
    setTotalHits(undefined)
    setLoadingState('idle')

    // Load interactions automatically
    const load = async () => {
      setLoadingState('loading')
      try {
        const result = await getBlueskyInteractions(postUrl, {
          limit: 10,
          includeReplies: true,
        })
        setPosts(result.posts)
        setTotalHits(result.totalHits)
        setLoadingState('loaded')
      } catch (error) {
        console.error('Failed to load Bluesky interactions:', error)
        setLoadingState('error')
      }
    }

    load()
  }, [postUrl])

  const shareUrl = getBlueskyShareUrl(postUrl, postTitle)

  // Outline button style (consistent with other buttons)
  const outlineButtonClass = "flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)] hover:border-[var(--theme-text-secondary)] transition-colors"

  return (
    <section className="mt-12 pt-8 border-t border-[var(--theme-border)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        {loadingState === 'loaded' && posts.length !== 0 && (
        <h2 className="text-xl font-semibold text-[var(--theme-text)] flex items-center gap-2">
          <span>Discussions from the Network</span>
          {loadingState === 'loaded' && totalHits !== undefined && totalHits > 0 && (
            <span className="text-sm font-normal text-[var(--theme-text-secondary)]">
              ({totalHits} {totalHits === 1 ? 'post' : 'posts'})
            </span>
          )}
        </h2>
        )}
        
        {!(loadingState === 'loaded' && posts.length !== 0) && (
          <div className="flex-1"></div>
        )}

        <a
          href={shareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--theme-accent)] text-[var(--theme-accent)] hover:opacity-80 transition-opacity text-sm"
        >
          <BlueskyIcon className="w-4 h-4" />
          <span>Share on Bluesky</span>

        </a>
      </div>

      {/* Loading state */}
      {loadingState === 'loading' && (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner className="w-8 h-8" />
        </div>
      )}

      {/* Error state */}
      {loadingState === 'error' && (
        <div className="text-center py-8">
          <p className="text-[var(--theme-text-secondary)] mb-4">
            Failed to load discussions. Please try again.
          </p>
          <button
            onClick={loadInteractions}
            className={outlineButtonClass}
          >
            Retry
          </button>
        </div>
      )}

      {/* Posts list */}
      {loadingState === 'loaded' && posts.length > 0 && (
        <div className="space-y-4">
          {posts.map((post) => (
            <BlueskyPostCard key={post.uri} post={post} />
          ))}
        </div>
      )}
    </section>
  )
}

function BlueskyIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 600 530" fill="currentColor">
      <path d="m135.72 44.03c66.496 49.921 138.02 151.14 164.28 205.46 26.262-54.316 97.782-155.54 164.28-205.46 47.98-36.021 125.72-63.892 125.72 24.795 0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.3797-3.6904-10.832-3.7077-7.8964-0.0174-2.9357-1.1937 0.51669-3.7077 7.8964-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.4491-163.25-81.433-5.9562-21.282-16.111-152.36-16.111-170.07 0-88.687 77.742-60.816 125.72-24.795z" />
    </svg>
  )
}

function LoadingSpinner({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}
