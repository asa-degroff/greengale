import { useState, useEffect, useRef } from 'react'

/**
 * Custom hook that tracks which heading is currently in the viewport
 * Uses Intersection Observer for performance
 */
export function useScrollSpy(headingIds: string[]): { activeId: string | null } {
  const [activeId, setActiveId] = useState<string | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const visibleHeadingsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (headingIds.length === 0) {
      setActiveId(null)
      return
    }

    // Track which headings are currently in the intersection zone
    const visibleHeadings = visibleHeadingsRef.current
    visibleHeadings.clear()

    /**
     * Find the active heading based on current scroll position
     * Uses fresh bounding rects instead of stale entry values
     */
    function updateActiveHeading() {
      const elements = headingIds
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLElement => el !== null)

      if (elements.length === 0) return

      // Find the heading closest to the top of the viewport
      // Prefer headings in the visible zone, fall back to last heading above viewport
      let activeElement: HTMLElement | null = null
      let closestTop: number | null = null

      for (const el of elements) {
        const rect = el.getBoundingClientRect()
        const top = rect.top

        // Heading is in the "active zone" (top 30% of viewport, below header)
        if (top >= 0 && top < window.innerHeight * 0.3) {
          if (closestTop === null || top < closestTop) {
            activeElement = el
            closestTop = top
          }
        }
        // Heading is above viewport - track as potential fallback
        else if (top < 0) {
          activeElement = el
        }
      }

      if (activeElement) {
        setActiveId(activeElement.id)
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        // Update visible headings set
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            visibleHeadings.add(entry.target.id)
          } else {
            visibleHeadings.delete(entry.target.id)
          }
        })

        // Recalculate active heading with fresh positions
        updateActiveHeading()
      },
      {
        // Trigger when heading enters top 30% of viewport
        rootMargin: '-80px 0px -70% 0px',
        threshold: 0,
      }
    )

    observerRef.current = observer

    /**
     * Set up observation of heading elements
     * Retries if elements don't exist yet (async rendering)
     */
    let retryCount = 0
    const maxRetries = 10
    let retryTimeout: ReturnType<typeof setTimeout> | null = null

    function setupObservation() {
      let observedCount = 0

      headingIds.forEach((id) => {
        const element = document.getElementById(id)
        if (element) {
          observer.observe(element)
          observedCount++
        }
      })

      // If not all elements found and retries remaining, try again
      if (observedCount < headingIds.length && retryCount < maxRetries) {
        retryCount++
        retryTimeout = setTimeout(setupObservation, 50)
      } else if (observedCount > 0) {
        // Set initial active heading once elements are found
        updateActiveHeading()
      }
    }

    setupObservation()

    return () => {
      if (retryTimeout) clearTimeout(retryTimeout)
      observer.disconnect()
      observerRef.current = null
    }
  }, [headingIds])

  return { activeId }
}
