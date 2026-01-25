import { memo } from 'react'
import { LoadingCube } from './LoadingCube'

interface PageLoadingProps {
  /** Number of skeleton cards to show */
  cards?: number
  /** Show the centered cube loader */
  showCube?: boolean
  /** Layout: 'grid' for card grids, 'list' for single column */
  layout?: 'grid' | 'list'
  /** Optional message below the cube */
  message?: string
}

/**
 * Full page loading state with animated cube and skeleton cards
 */
export const PageLoading = memo(function PageLoading({
  cards = 4,
  showCube = true,
  layout = 'grid',
  message,
}: PageLoadingProps) {
  return (
    <div className="min-h-[50vh]">
      {showCube && (
        <div className="flex flex-col items-center justify-center py-12">
          <LoadingCube size="lg" />
          {message && (
            <p className="mt-6 text-sm text-[var(--site-text-secondary)] animate-pulse">
              {message}
            </p>
          )}
        </div>
      )}

      {cards > 0 && (
        <div
          className={
            layout === 'grid'
              ? 'grid md:grid-cols-2 gap-6'
              : 'flex flex-col gap-6'
          }
        >
          {[...Array(cards)].map((_, i) => (
            <SkeletonCard key={i} index={i} />
          ))}
        </div>
      )}
    </div>
  )
})

/**
 * Individual skeleton card with staggered shimmer animation
 */
const SkeletonCard = memo(function SkeletonCard({ index }: { index: number }) {
  return (
    <div
      className="border border-[var(--site-border)]/50 rounded-lg overflow-hidden bg-[var(--site-bg)]"
      style={{ animationDelay: `${index * 0.1}s` }}
    >
      {/* Thumbnail skeleton */}
      <div className="aspect-video bg-[var(--site-border)] animate-cube-shimmer" />

      {/* Content skeleton */}
      <div className="p-4 space-y-3">
        {/* Title */}
        <div
          className="h-5 rounded bg-[var(--site-border)] animate-cube-shimmer"
          style={{
            width: `${70 + (index % 3) * 10}%`,
            animationDelay: `${index * 0.1 + 0.1}s`,
          }}
        />

        {/* Subtitle */}
        <div
          className="h-4 rounded bg-[var(--site-border)] animate-cube-shimmer"
          style={{
            width: `${50 + (index % 2) * 15}%`,
            animationDelay: `${index * 0.1 + 0.2}s`,
          }}
        />

        {/* Preview text lines */}
        <div className="space-y-2">
          <div
            className="h-3 rounded bg-[var(--site-border)] animate-cube-shimmer"
            style={{ animationDelay: `${index * 0.1 + 0.3}s` }}
          />
          <div
            className="h-3 rounded bg-[var(--site-border)] animate-cube-shimmer"
            style={{
              width: '85%',
              animationDelay: `${index * 0.1 + 0.4}s`,
            }}
          />
          <div
            className="h-3 rounded bg-[var(--site-border)] animate-cube-shimmer"
            style={{
              width: '60%',
              animationDelay: `${index * 0.1 + 0.5}s`,
            }}
          />
        </div>

        {/* Author row */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            {/* Avatar */}
            <div
              className="w-5 h-5 rounded-full bg-[var(--site-border)] animate-cube-shimmer"
              style={{ animationDelay: `${index * 0.1 + 0.6}s` }}
            />
            {/* Handle */}
            <div
              className="h-3 w-20 rounded bg-[var(--site-border)] animate-cube-shimmer"
              style={{ animationDelay: `${index * 0.1 + 0.7}s` }}
            />
          </div>
          {/* Date */}
          <div
            className="h-3 w-16 rounded bg-[var(--site-border)] animate-cube-shimmer"
            style={{ animationDelay: `${index * 0.1 + 0.8}s` }}
          />
        </div>
      </div>
    </div>
  )
})

/**
 * Inline loading indicator for buttons and small areas
 */
export const InlineLoading = memo(function InlineLoading({
  className = '',
}: {
  className?: string
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {[...Array(3)].map((_, i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-sm bg-current animate-cube-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  )
})

/**
 * Author page specific loading skeleton
 */
export const AuthorPageLoading = memo(function AuthorPageLoading() {
  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Author header skeleton */}
        <div className="flex items-center gap-4 mb-8 opacity-50">
          <div className="w-16 h-16 rounded-full bg-[var(--site-border)] animate-cube-shimmer" />
          <div className="flex-1">
            <div className="h-6 w-48 rounded bg-[var(--site-border)] animate-cube-shimmer mb-2" />
            <div
              className="h-4 w-32 rounded bg-[var(--site-border)] animate-cube-shimmer"
              style={{ animationDelay: '0.1s' }}
            />
          </div>
        </div>

        {/* Centered cube */}
        <div className="flex justify-center py-8">
          <LoadingCube size="md" />
        </div>

        {/* Post grid skeleton */}
        <div className="grid md:grid-cols-2 gap-6 opacity-40">
          {[...Array(4)].map((_, i) => (
            <SkeletonCard key={i} index={i} />
          ))}
        </div>
      </div>
    </div>
  )
})
