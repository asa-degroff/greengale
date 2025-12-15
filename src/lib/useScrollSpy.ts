import { useState, useEffect } from 'react'

/**
 * Custom hook that tracks which heading is currently in the viewport
 * Uses Intersection Observer for performance
 */
export function useScrollSpy(headingIds: string[]): { activeId: string | null } {
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    if (headingIds.length === 0) {
      setActiveId(null)
      return
    }

    // Track which headings are currently visible
    const visibleHeadings = new Map<string, IntersectionObserverEntry>()

    const observer = new IntersectionObserver(
      (entries) => {
        // Update visible headings map
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            visibleHeadings.set(entry.target.id, entry)
          } else {
            visibleHeadings.delete(entry.target.id)
          }
        })

        // Find the heading closest to the top of the viewport
        if (visibleHeadings.size > 0) {
          let closestId: string | null = null
          let closestTop: number | null = null

          visibleHeadings.forEach((entry, id) => {
            const top = entry.boundingClientRect.top
            if (closestTop === null || (top >= 0 && top < closestTop) || (closestTop < 0 && top > closestTop)) {
              closestId = id
              closestTop = top
            }
          })

          if (closestId) {
            setActiveId(closestId)
          }
        } else {
          // No headings visible - find the last heading before the viewport
          // This handles the case when scrolled past all headings in a section
          const elements = headingIds
            .map((id) => document.getElementById(id))
            .filter((el): el is HTMLElement => el !== null)

          let lastAbove: HTMLElement | null = null
          for (const el of elements) {
            const rect = el.getBoundingClientRect()
            if (rect.top < 100) {
              lastAbove = el
            } else {
              break
            }
          }

          if (lastAbove) {
            setActiveId(lastAbove.id)
          }
        }
      },
      {
        // Trigger when heading enters top 20% of viewport
        rootMargin: '-80px 0px -80% 0px',
        threshold: 0,
      }
    )

    // Observe all heading elements
    headingIds.forEach((id) => {
      const element = document.getElementById(id)
      if (element) {
        observer.observe(element)
      }
    })

    // Set initial active heading
    const elements = headingIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null)

    for (const el of elements) {
      const rect = el.getBoundingClientRect()
      if (rect.top >= 0 && rect.top < window.innerHeight * 0.3) {
        setActiveId(el.id)
        break
      } else if (rect.top < 0) {
        setActiveId(el.id)
      }
    }

    return () => observer.disconnect()
  }, [headingIds])

  return { activeId }
}
