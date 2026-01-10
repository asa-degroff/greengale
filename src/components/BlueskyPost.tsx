import { useState } from 'react'
import { type BlueskyPost, getBlueskyWebUrl } from '@/lib/bluesky'

interface BlueskyPostProps {
  post: BlueskyPost
  isReply?: boolean
  showReplies?: boolean
  /** Depth in the reply tree (0 = top-level post) */
  depth?: number
  /** Callback when user clicks on post text (for TTS seek) */
  onTextClick?: (text: string) => void
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffDays > 30) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  if (diffDays > 0) return `${diffDays}d`
  if (diffHours > 0) return `${diffHours}h`
  if (diffMins > 0) return `${diffMins}m`
  return 'now'
}

function formatCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`
  }
  return count.toString()
}

/** Count total nested replies recursively */
function countNestedReplies(post: BlueskyPost): number {
  if (!post.replies || post.replies.length === 0) return 0
  return post.replies.reduce(
    (count, reply) => count + 1 + countNestedReplies(reply),
    0
  )
}

export function BlueskyPostCard({
  post,
  isReply = false,
  showReplies = true,
  depth = 0,
  onTextClick,
}: BlueskyPostProps) {
  // Threads at depth >= 2 start collapsed
  const [isExpanded, setIsExpanded] = useState(depth < 2)

  const blueskyUrl = getBlueskyWebUrl(post.uri)

  // Determine max visible replies based on depth
  // depth 0: 5 replies, depth 1-3: 3 replies, depth 4+: 2 replies
  const maxVisibleReplies = depth === 0 ? 5 : depth <= 3 ? 3 : 2

  const visibleReplies = showReplies && isExpanded
    ? (post.replies || []).slice(0, maxVisibleReplies)
    : []
  const hiddenRepliesCount = (post.replies?.length || 0) - visibleReplies.length
  const hasReplies = (post.replies?.length || 0) > 0

  // Cap visual indentation at depth 5 to prevent excessive narrowing
  const visualDepth = Math.min(depth, 5)

  // For deep threads, use smaller padding increments
  const paddingStyle = isReply
    ? { paddingLeft: `${Math.min(visualDepth + 1, 5) * 0.75}rem` }
    : undefined

  // Collapsed preview: show author name and reply count
  if (isReply && !isExpanded && hasReplies) {
    const totalReplies = countNestedReplies(post)
    return (
      <div
        className="border-l-2 border-[var(--theme-border)]"
        style={paddingStyle}
      >
        <button
          onClick={() => setIsExpanded(true)}
          className="py-2 flex items-center gap-2 text-sm text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)] transition-colors group"
        >
          {/* Expand icon */}
          <svg
            className="w-4 h-4 text-[var(--theme-text-secondary)] group-hover:text-[var(--theme-accent)] transition-colors"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span className="font-medium text-[var(--theme-text)]">
            {post.author.displayName || post.author.handle}
          </span>
          <span>replied</span>
          {totalReplies > 0 && (
            <span className="text-[var(--theme-accent)]">
              +{totalReplies} {totalReplies === 1 ? 'reply' : 'replies'}
            </span>
          )}
        </button>
      </div>
    )
  }

  return (
    <div
      className={isReply ? 'border-l-2 border-[var(--theme-border)]' : ''}
      style={paddingStyle}
    >
      <div className={isReply ? 'py-2' : 'p-4 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)]'}>
        {/* Author header */}
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <a
            href={`https://bsky.app/profile/${post.author.handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0"
          >
            {post.author.avatar ? (
              <img
                src={post.author.avatar}
                alt={post.author.displayName || post.author.handle}
                className="w-10 h-10 rounded-full object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-[var(--theme-accent)] flex items-center justify-center text-white font-medium">
                {(post.author.displayName || post.author.handle).charAt(0).toUpperCase()}
              </div>
            )}
          </a>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Author info with optional collapse button */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Collapse button for expanded deep replies */}
              {isReply && depth >= 2 && isExpanded && (
                <button
                  onClick={() => setIsExpanded(false)}
                  className="p-0.5 -ml-1 text-[var(--theme-text-secondary)] hover:text-[var(--theme-accent)] transition-colors"
                  title="Collapse thread"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
                  </svg>
                </button>
              )}
              <a
                href={`https://bsky.app/profile/${post.author.handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[var(--theme-text)] hover:underline truncate"
              >
                {post.author.displayName || post.author.handle}
              </a>
              <span className="text-[var(--theme-text-secondary)] text-sm truncate">
                @{post.author.handle}
              </span>
              <span className="text-[var(--theme-text-secondary)] text-sm">
                · {formatRelativeTime(post.createdAt)}
              </span>
            </div>

            {/* Post text */}
            <p
              className={`bluesky-post-text mt-1 text-[var(--theme-text)] whitespace-pre-wrap break-words ${onTextClick ? 'cursor-pointer' : ''}`}
              onClick={onTextClick ? () => onTextClick(post.text) : undefined}
            >
              {post.text}
            </p>

            {/* Engagement stats (only for top-level posts) */}
            {!isReply && (
              <div className="mt-3 flex items-center gap-4 text-sm text-[var(--theme-text-secondary)]">
                {/* Replies */}
                <span className="flex items-center gap-1" title="Replies">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z" />
                  </svg>
                  {formatCount(post.replyCount)}
                </span>

                {/* Reposts */}
                <span className="flex items-center gap-1" title="Reposts">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 0 0-3.7-3.7 48.678 48.678 0 0 0-7.324 0 4.006 4.006 0 0 0-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 0 0 3.7 3.7 48.656 48.656 0 0 0 7.324 0 4.006 4.006 0 0 0 3.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3-3 3" />
                  </svg>
                  {formatCount(post.repostCount)}
                </span>

                {/* Likes */}
                <span className="flex items-center gap-1" title="Likes">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
                  </svg>
                  {formatCount(post.likeCount)}
                </span>

                {/* View on Bluesky link */}
                <a
                  href={blueskyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto flex items-center gap-1 text-[var(--theme-accent)] hover:underline"
                >
                  <span>View</span>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Nested replies */}
      {visibleReplies.length > 0 && (
        <div className="mt-2 space-y-2">
          {visibleReplies.map((reply) => (
            <BlueskyPostCard
              key={reply.uri}
              post={reply}
              isReply={true}
              showReplies={true}
              depth={depth + 1}
              onTextClick={onTextClick}
            />
          ))}
          {hiddenRepliesCount > 0 && (
            <a
              href={blueskyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm text-[var(--theme-accent)] hover:underline"
              style={{ paddingLeft: `${Math.min(depth + 2, 6) * 0.75}rem` }}
            >
              View {hiddenRepliesCount} more {hiddenRepliesCount === 1 ? 'reply' : 'replies'} on Bluesky
            </a>
          )}
        </div>
      )}
    </div>
  )
}
