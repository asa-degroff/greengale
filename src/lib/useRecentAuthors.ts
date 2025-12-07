import { useState, useEffect, useCallback } from 'react'

export interface RecentAuthor {
  handle: string
  displayName?: string
  avatarUrl?: string
  visitedAt: number
}

const STORAGE_KEY = 'recent-authors'
const MAX_RECENT = 5

function loadRecentAuthors(): RecentAuthor[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

function saveRecentAuthors(authors: RecentAuthor[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(authors))
  } catch {
    // localStorage not available
  }
}

export function useRecentAuthors() {
  const [recentAuthors, setRecentAuthors] = useState<RecentAuthor[]>(loadRecentAuthors)

  // Listen for storage changes from other tabs
  useEffect(() => {
    function handleStorageChange(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        setRecentAuthors(loadRecentAuthors())
      }
    }
    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  const addRecentAuthor = useCallback((author: Omit<RecentAuthor, 'visitedAt'>) => {
    setRecentAuthors(prev => {
      // Remove existing entry for this handle (case-insensitive)
      const filtered = prev.filter(
        a => a.handle.toLowerCase() !== author.handle.toLowerCase()
      )

      // Add new entry at the beginning
      const updated: RecentAuthor[] = [
        {
          handle: author.handle,
          displayName: author.displayName,
          avatarUrl: author.avatarUrl,
          visitedAt: Date.now(),
        },
        ...filtered,
      ].slice(0, MAX_RECENT)

      saveRecentAuthors(updated)
      return updated
    })
  }, [])

  const clearRecentAuthors = useCallback(() => {
    setRecentAuthors([])
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // localStorage not available
    }
  }, [])

  return {
    recentAuthors,
    addRecentAuthor,
    clearRecentAuthors,
  }
}
