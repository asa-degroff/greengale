import { useState, useEffect, useCallback, useRef } from 'react'
import { BlueskyPostCard } from './BlueskyPost'
import { LoadingCube } from './LoadingCube'
import {
  getBlueskyInteractions,
  getBlueskyShareUrl,
  type BlueskyPost,
} from '@/lib/bluesky'

interface BlueskyInteractionsProps {
  postUrl: string
  postTitle?: string
  /** Current sentence being spoken by TTS (for highlighting) */
  currentSentence?: string | null
  /** Callback when user clicks on a post (for TTS seek) */
  onSentenceClick?: (text: string) => void
}

// Normalize text for comparison (collapse whitespace, lowercase)
function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

// Strip "Post by {author}:" or "Reply by {author}:" prefix from TTS sentence
// to match against DOM content which only has the post text
function stripAuthorPrefix(text: string): string {
  return text.replace(/^(post|reply) by [^:]+:\s*/i, '')
}

type LoadingState = 'idle' | 'loading' | 'loaded' | 'error'

export function BlueskyInteractions({
  postUrl,
  postTitle,
  currentSentence,
  onSentenceClick,
}: BlueskyInteractionsProps) {
  const [posts, setPosts] = useState<BlueskyPost[]>([])
  const [totalHits, setTotalHits] = useState<number | undefined>()
  const [loadingState, setLoadingState] = useState<LoadingState>('idle')
  const containerRef = useRef<HTMLElement>(null)
  const lastHighlightIndexRef = useRef<number>(-1)

  // Handle TTS highlighting
  useEffect(() => {
    const container = containerRef.current
    if (!container || !currentSentence) {
      // Clear any existing highlights when no sentence
      if (container) {
        container.querySelectorAll('.tts-highlight').forEach((el) => {
          el.classList.remove('tts-highlight')
        })
      }
      // Reset proximity tracking when TTS stops
      lastHighlightIndexRef.current = -1
      return
    }

    const normalizedSentence = normalizeText(currentSentence)
    if (!normalizedSentence) return

    // For post content, strip the "Post by {author}:" prefix since DOM only has the text
    const sentenceWithoutPrefix = normalizeText(stripAuthorPrefix(currentSentence))

    // Query h2 (section header) and post text elements
    const elements = Array.from(
      container.querySelectorAll('h2, .bluesky-post-text')
    )

    let bestMatch: Element | null = null
    let bestMatchIndex = -1
    let bestScore = 0

    const lastIndex = lastHighlightIndexRef.current

    for (let i = 0; i < elements.length; i++) {
      const element = elements[i]
      const textContent = element.textContent || ''
      const normalizedContent = normalizeText(textContent)

      // Check various matching strategies
      const matches =
        normalizedContent.includes(normalizedSentence) || // full sentence match
        normalizedSentence.includes(normalizedContent) || // content within sentence
        normalizedContent.includes(sentenceWithoutPrefix) || // match without author prefix
        sentenceWithoutPrefix.includes(normalizedContent) // content within stripped sentence

      if (matches) {
        // Base score: prefer shorter matches (more specific)
        const baseScore = 1 / textContent.length

        // Proximity bonus: prefer elements near the last highlight
        let proximityBonus = 0
        if (lastIndex >= 0) {
          if (i === lastIndex + 1) {
            // Immediately after last highlight - strong bonus
            proximityBonus = 0.5
          } else if (i > lastIndex && i <= lastIndex + 3) {
            // Within 3 elements after - moderate bonus
            proximityBonus = 0.3
          } else if (i === lastIndex) {
            // Same element - small bonus
            proximityBonus = 0.1
          }
        } else {
          // No previous highlight - prefer earlier elements
          if (i < 3) {
            proximityBonus = 0.5 * (1 - i / 3)
          }
        }

        const score = baseScore + proximityBonus

        if (score > bestScore) {
          bestScore = score
          bestMatch = element
          bestMatchIndex = i
        }
      }
    }

    // Clear previous highlights
    container.querySelectorAll('.tts-highlight').forEach((el) => {
      el.classList.remove('tts-highlight')
    })

    // Apply new highlight (no auto-scroll - discussions section is short enough to be visible)
    if (bestMatch) {
      bestMatch.classList.add('tts-highlight')
      lastHighlightIndexRef.current = bestMatchIndex
    }
  }, [currentSentence])

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

  // Use only the first URL (GreenGale) for sharing - postUrl may contain comma-separated URLs
  const primaryUrl = postUrl.split(',')[0]
  const shareUrl = getBlueskyShareUrl(primaryUrl, postTitle)

  // Outline button style (consistent with other buttons)
  const outlineButtonClass = "flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)] hover:border-[var(--theme-text-secondary)] transition-colors"

  return (
    <section
      ref={containerRef}
      className={`mt-12 pt-8 border-t border-[var(--theme-border)] ${onSentenceClick ? 'tts-seekable' : ''}`}
    >
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
        <div className="flex flex-col items-center justify-center py-12">
          <LoadingCube size="sm" />
          <p className="mt-4 text-sm text-[var(--theme-text-secondary)]">
            Loading discussions...
          </p>
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
            <BlueskyPostCard
              key={post.uri}
              post={post}
              onTextClick={onSentenceClick}
            />
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

