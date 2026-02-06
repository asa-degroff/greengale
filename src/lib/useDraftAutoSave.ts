/**
 * Hook for auto-saving draft posts to localStorage.
 *
 * Persists draft content as users write, allowing recovery if they
 * accidentally close or refresh the browser.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import type { ThemePreset, CustomColors } from './themes'
import type { SelfLabels } from './image-upload'

const DRAFT_VERSION = 1
const DEBOUNCE_MS = 2000
const MAX_DRAFT_SIZE = 2 * 1024 * 1024 // 2MB limit (content can be up to 1MB)

/**
 * Metadata for uploaded blobs (CIDs preserved - blobs still exist in PDS)
 */
export interface DraftBlobMetadata {
  cid: string
  mimeType: string
  size: number
  name: string
  alt?: string
  labels?: SelfLabels
}

/**
 * Complete draft state that gets persisted
 */
export interface DraftState {
  // Core content
  title: string
  subtitle: string
  content: string
  tags: string[]
  tagInput: string

  // Formatting
  lexicon: 'greengale' | 'whitewind'
  theme: ThemePreset
  customColors: CustomColors
  visibility: 'public' | 'url' | 'author'
  publishToSiteStandard: boolean

  // Image metadata (CIDs preserved - blobs still exist in PDS)
  uploadedBlobsMetadata: DraftBlobMetadata[]

  // UI state
  viewMode: 'edit' | 'preview' | 'split'

  // Metadata
  savedAt: string // ISO timestamp
  version: number // For future migrations
}

/**
 * Generate storage key for a draft
 */
function getDraftKey(did: string, rkey: string | undefined): string {
  return rkey ? `greengale-draft:${did}:${rkey}` : `greengale-draft:${did}:new`
}

/**
 * Check if localStorage is available
 */
function isStorageAvailable(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const test = '__storage_test__'
    localStorage.setItem(test, test)
    localStorage.removeItem(test)
    return true
  } catch {
    return false
  }
}

/**
 * Validate draft data structure
 */
function isValidDraft(data: unknown): data is DraftState {
  if (!data || typeof data !== 'object') return false

  const draft = data as Record<string, unknown>

  // Check required fields
  if (typeof draft.title !== 'string') return false
  if (typeof draft.subtitle !== 'string') return false
  if (typeof draft.content !== 'string') return false
  if (!Array.isArray(draft.tags)) return false
  if (typeof draft.tagInput !== 'string') return false
  if (draft.lexicon !== 'greengale' && draft.lexicon !== 'whitewind') return false
  if (typeof draft.theme !== 'string') return false
  if (!draft.customColors || typeof draft.customColors !== 'object') return false
  if (draft.visibility !== 'public' && draft.visibility !== 'url' && draft.visibility !== 'author') return false
  if (typeof draft.publishToSiteStandard !== 'boolean') return false
  if (!Array.isArray(draft.uploadedBlobsMetadata)) return false
  if (draft.viewMode !== 'edit' && draft.viewMode !== 'preview' && draft.viewMode !== 'split') return false
  if (typeof draft.savedAt !== 'string') return false
  if (typeof draft.version !== 'number') return false

  return true
}

/**
 * Load draft from localStorage
 */
function loadDraft(did: string, rkey: string | undefined): DraftState | null {
  if (!isStorageAvailable()) return null

  try {
    const key = getDraftKey(did, rkey)
    const stored = localStorage.getItem(key)
    if (!stored) return null

    const parsed = JSON.parse(stored)
    if (!isValidDraft(parsed)) {
      // Remove corrupted draft
      localStorage.removeItem(key)
      return null
    }

    return parsed
  } catch {
    return null
  }
}

/**
 * Save draft to localStorage
 */
function saveDraftToStorage(did: string, rkey: string | undefined, state: DraftState): boolean {
  if (!isStorageAvailable()) return false

  try {
    const key = getDraftKey(did, rkey)
    const json = JSON.stringify(state)

    // Check size limit
    if (json.length > MAX_DRAFT_SIZE) {
      console.warn('Draft exceeds size limit, not saving')
      return false
    }

    localStorage.setItem(key, json)
    return true
  } catch (err) {
    console.warn('Failed to save draft:', err)
    return false
  }
}

/**
 * Clear draft from localStorage
 */
function clearDraftFromStorage(did: string, rkey: string | undefined): void {
  if (!isStorageAvailable()) return

  try {
    const key = getDraftKey(did, rkey)
    localStorage.removeItem(key)
  } catch {
    // Ignore errors
  }
}

export interface UseDraftAutoSaveOptions {
  did: string | null
  rkey: string | undefined
}

export interface UseDraftAutoSaveReturn {
  /** Whether a draft exists for this post */
  hasDraft: boolean
  /** The saved draft state, if any */
  savedDraft: DraftState | null
  /** When the draft was last saved */
  lastSavedAt: Date | null
  /** Whether the draft for the current key has been loaded (prevents stale data issues) */
  isDraftLoaded: boolean
  /** Save draft (debounced) */
  saveDraft: (state: Omit<DraftState, 'savedAt' | 'version'>) => void
  /** Save draft immediately (no debounce) */
  saveDraftNow: (state: Omit<DraftState, 'savedAt' | 'version'>) => void
  /** Clear the saved draft */
  clearDraft: () => void
  /** Dismiss the draft restoration banner for this session */
  dismissDraftBanner: () => void
  /** Whether the banner has been dismissed */
  isBannerDismissed: boolean
  /** Whether localStorage is available */
  isStorageAvailable: boolean
}

/**
 * Hook for auto-saving draft posts to localStorage
 */
export function useDraftAutoSave(
  did: string | null,
  rkey: string | undefined
): UseDraftAutoSaveReturn {
  const [savedDraft, setSavedDraft] = useState<DraftState | null>(null)
  const [isBannerDismissed, setIsBannerDismissed] = useState(false)
  const [storageAvailable] = useState(() => isStorageAvailable())
  // Track which key the current savedDraft was loaded for (prevents stale data issues)
  const [loadedForKey, setLoadedForKey] = useState<string | null>(null)

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Compute the current key for comparison
  const currentKey = did ? getDraftKey(did, rkey) : null

  // Load draft on mount or when did/rkey changes
  useEffect(() => {
    if (!did) {
      setSavedDraft(null)
      setLoadedForKey(null)
      return
    }

    const key = getDraftKey(did, rkey)
    const draft = loadDraft(did, rkey)
    setSavedDraft(draft)
    setLoadedForKey(key)
    // Reset banner dismissed state when switching posts
    setIsBannerDismissed(false)
  }, [did, rkey])

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  const saveDraftNow = useCallback(
    (state: Omit<DraftState, 'savedAt' | 'version'>) => {
      if (!did || !storageAvailable) return

      const fullState: DraftState = {
        ...state,
        savedAt: new Date().toISOString(),
        version: DRAFT_VERSION,
      }

      const success = saveDraftToStorage(did, rkey, fullState)
      if (success) {
        setSavedDraft(fullState)
      }
    },
    [did, rkey, storageAvailable]
  )

  const saveDraft = useCallback(
    (state: Omit<DraftState, 'savedAt' | 'version'>) => {
      // Cancel any pending save
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      // Schedule new save
      debounceTimerRef.current = setTimeout(() => {
        saveDraftNow(state)
      }, DEBOUNCE_MS)
    },
    [saveDraftNow]
  )

  const clearDraft = useCallback(() => {
    if (!did) return

    // Cancel any pending save
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    clearDraftFromStorage(did, rkey)
    setSavedDraft(null)
  }, [did, rkey])

  const dismissDraftBanner = useCallback(() => {
    setIsBannerDismissed(true)
  }, [])

  const lastSavedAt = savedDraft ? new Date(savedDraft.savedAt) : null
  // Draft is loaded when the loadedForKey matches the current key
  const isDraftLoaded = currentKey !== null && loadedForKey === currentKey

  return {
    hasDraft: savedDraft !== null,
    savedDraft,
    lastSavedAt,
    isDraftLoaded,
    saveDraft,
    saveDraftNow,
    clearDraft,
    dismissDraftBanner,
    isBannerDismissed,
    isStorageAvailable: storageAvailable,
  }
}
