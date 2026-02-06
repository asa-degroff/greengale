/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDraftAutoSave, type DraftState } from '../useDraftAutoSave'

// Create a valid draft state for testing
function createTestDraft(overrides: Partial<DraftState> = {}): DraftState {
  return {
    title: 'Test Title',
    subtitle: 'Test Subtitle',
    content: 'Test content here',
    tags: ['test', 'draft'],
    tagInput: '',
    lexicon: 'greengale',
    theme: 'default',
    customColors: {
      background: '#ffffff',
      text: '#24292f',
      accent: '#0969da',
      codeBackground: '',
    },
    visibility: 'public',
    publishToSiteStandard: true,
    uploadedBlobsMetadata: [],
    viewMode: 'edit',
    savedAt: new Date().toISOString(),
    version: 1,
    ...overrides,
  }
}

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    get length() {
      return Object.keys(store).length
    },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
  }
})()

describe('useDraftAutoSave', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Initial State', () => {
    it('returns no draft when did is null', () => {
      const { result } = renderHook(() => useDraftAutoSave(null, undefined))

      expect(result.current.hasDraft).toBe(false)
      expect(result.current.savedDraft).toBeNull()
      expect(result.current.lastSavedAt).toBeNull()
    })

    it('returns no draft when localStorage is empty', () => {
      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))

      expect(result.current.hasDraft).toBe(false)
      expect(result.current.savedDraft).toBeNull()
    })

    it('loads existing draft from localStorage', () => {
      const draft = createTestDraft()
      localStorageMock.setItem('greengale-draft:did:plc:test:new', JSON.stringify(draft))

      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))

      expect(result.current.hasDraft).toBe(true)
      expect(result.current.savedDraft).toEqual(draft)
      expect(result.current.lastSavedAt).toBeInstanceOf(Date)
    })

    it('reports isDraftLoaded as true after loading for current key', () => {
      const draft = createTestDraft()
      localStorageMock.setItem('greengale-draft:did:plc:test:new', JSON.stringify(draft))

      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))

      expect(result.current.isDraftLoaded).toBe(true)
    })

    it('reports isDraftLoaded as false when did is null', () => {
      const { result } = renderHook(() => useDraftAutoSave(null, undefined))

      expect(result.current.isDraftLoaded).toBe(false)
    })

    it('updates isDraftLoaded when switching between posts', () => {
      const draft1 = createTestDraft({ title: 'Draft 1' })
      const draft2 = createTestDraft({ title: 'Draft 2' })
      localStorageMock.setItem('greengale-draft:did:plc:test:new', JSON.stringify(draft1))
      localStorageMock.setItem('greengale-draft:did:plc:test:abc', JSON.stringify(draft2))

      const { result, rerender } = renderHook(
        ({ did, rkey }) => useDraftAutoSave(did, rkey),
        { initialProps: { did: 'did:plc:test', rkey: undefined as string | undefined } }
      )

      expect(result.current.isDraftLoaded).toBe(true)
      expect(result.current.savedDraft?.title).toBe('Draft 1')

      // Switch to editing a post
      rerender({ did: 'did:plc:test', rkey: 'abc' })

      expect(result.current.isDraftLoaded).toBe(true)
      expect(result.current.savedDraft?.title).toBe('Draft 2')
    })

    it('uses different key for editing existing post', () => {
      const draft = createTestDraft()
      localStorageMock.setItem('greengale-draft:did:plc:test:abc123', JSON.stringify(draft))

      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', 'abc123'))

      expect(result.current.hasDraft).toBe(true)
      expect(result.current.savedDraft).toEqual(draft)
    })

    it('reports storage availability', () => {
      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))

      expect(result.current.isStorageAvailable).toBe(true)
    })
  })

  describe('Saving Drafts', () => {
    it('saves draft immediately with saveDraftNow', () => {
      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))
      const draftContent = createTestDraft()

      act(() => {
        result.current.saveDraftNow(draftContent)
      })

      expect(localStorageMock.setItem).toHaveBeenCalled()
      expect(result.current.hasDraft).toBe(true)
      expect(result.current.savedDraft?.title).toBe('Test Title')
    })

    it('saves draft with debounce using saveDraft', async () => {
      vi.useFakeTimers()

      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))
      const draftContent = createTestDraft()

      // Clear any calls from initialization (storage availability check)
      localStorageMock.setItem.mockClear()

      act(() => {
        result.current.saveDraft(draftContent)
      })

      // Not saved immediately
      expect(localStorageMock.setItem).not.toHaveBeenCalled()

      // Advance timer past debounce period
      act(() => {
        vi.advanceTimersByTime(2500)
      })

      expect(localStorageMock.setItem).toHaveBeenCalled()
      expect(result.current.hasDraft).toBe(true)

      vi.useRealTimers()
    })

    it('does not save when did is null', () => {
      const { result } = renderHook(() => useDraftAutoSave(null, undefined))
      const draftContent = createTestDraft()

      // Clear any calls from initialization
      localStorageMock.setItem.mockClear()

      act(() => {
        result.current.saveDraftNow(draftContent)
      })

      expect(localStorageMock.setItem).not.toHaveBeenCalled()
    })

    it('saves with correct key for editing post', () => {
      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', 'xyz789'))
      const draftContent = createTestDraft()

      act(() => {
        result.current.saveDraftNow(draftContent)
      })

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'greengale-draft:did:plc:test:xyz789',
        expect.any(String)
      )
    })

    it('adds savedAt and version to saved draft', () => {
      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))
      const draftContent = createTestDraft()

      // Remove savedAt and version to test they get added
      const { savedAt: _, version: __, ...contentWithoutMeta } = draftContent

      act(() => {
        result.current.saveDraftNow(contentWithoutMeta as DraftState)
      })

      // Find the call that saved the actual draft (not the storage test)
      const draftCall = localStorageMock.setItem.mock.calls.find(
        (call: [string, string]) => call[0].startsWith('greengale-draft:')
      )
      expect(draftCall).toBeDefined()
      const savedData = JSON.parse(draftCall![1])
      expect(savedData.savedAt).toBeDefined()
      expect(savedData.version).toBe(1)
    })

    it('preserves blob metadata in saved draft', () => {
      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))
      const draftContent = createTestDraft({
        uploadedBlobsMetadata: [
          {
            cid: 'bafkrei123',
            mimeType: 'image/avif',
            size: 12345,
            name: 'test.avif',
            alt: 'Test image',
          },
        ],
      })

      act(() => {
        result.current.saveDraftNow(draftContent)
      })

      // Find the call that saved the actual draft (not the storage test)
      const draftCall = localStorageMock.setItem.mock.calls.find(
        (call: [string, string]) => call[0].startsWith('greengale-draft:')
      )
      expect(draftCall).toBeDefined()
      const savedData = JSON.parse(draftCall![1])
      expect(savedData.uploadedBlobsMetadata).toHaveLength(1)
      expect(savedData.uploadedBlobsMetadata[0].cid).toBe('bafkrei123')
      expect(savedData.uploadedBlobsMetadata[0].alt).toBe('Test image')
    })
  })

  describe('Clearing Drafts', () => {
    it('clears draft from localStorage', () => {
      const draft = createTestDraft()
      localStorageMock.setItem('greengale-draft:did:plc:test:new', JSON.stringify(draft))

      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))

      act(() => {
        result.current.clearDraft()
      })

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('greengale-draft:did:plc:test:new')
      expect(result.current.hasDraft).toBe(false)
      expect(result.current.savedDraft).toBeNull()
    })

    it('cancels pending debounced save when clearing', () => {
      vi.useFakeTimers()

      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))
      const draftContent = createTestDraft()

      // Start a debounced save
      act(() => {
        result.current.saveDraft(draftContent)
      })

      // Clear before debounce completes
      act(() => {
        result.current.clearDraft()
      })

      // Advance timer past debounce
      act(() => {
        vi.advanceTimersByTime(3000)
      })

      // No draft call should have been made (only storage test calls)
      const draftCall = localStorageMock.setItem.mock.calls.find(
        (call: [string, string]) => call[0].startsWith('greengale-draft:')
      )
      expect(draftCall).toBeUndefined()

      vi.useRealTimers()
    })

    it('does nothing when did is null', () => {
      const { result } = renderHook(() => useDraftAutoSave(null, undefined))

      // Clear any calls from initialization
      localStorageMock.removeItem.mockClear()

      act(() => {
        result.current.clearDraft()
      })

      expect(localStorageMock.removeItem).not.toHaveBeenCalled()
    })
  })

  describe('Banner Dismissal', () => {
    it('starts with banner not dismissed', () => {
      const draft = createTestDraft()
      localStorageMock.setItem('greengale-draft:did:plc:test:new', JSON.stringify(draft))

      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))

      expect(result.current.isBannerDismissed).toBe(false)
    })

    it('dismisses banner when dismissDraftBanner is called', () => {
      const draft = createTestDraft()
      localStorageMock.setItem('greengale-draft:did:plc:test:new', JSON.stringify(draft))

      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))

      act(() => {
        result.current.dismissDraftBanner()
      })

      expect(result.current.isBannerDismissed).toBe(true)
    })

    it('resets dismissal when switching posts', () => {
      const draft = createTestDraft()
      localStorageMock.setItem('greengale-draft:did:plc:test:new', JSON.stringify(draft))
      localStorageMock.setItem('greengale-draft:did:plc:test:abc', JSON.stringify(draft))

      const { result, rerender } = renderHook(
        ({ did, rkey }) => useDraftAutoSave(did, rkey),
        { initialProps: { did: 'did:plc:test', rkey: undefined as string | undefined } }
      )

      act(() => {
        result.current.dismissDraftBanner()
      })
      expect(result.current.isBannerDismissed).toBe(true)

      // Switch to editing a different post
      rerender({ did: 'did:plc:test', rkey: 'abc' })

      expect(result.current.isBannerDismissed).toBe(false)
    })
  })

  describe('Validation and Corruption Handling', () => {
    it('removes corrupted draft from localStorage', () => {
      localStorageMock.setItem('greengale-draft:did:plc:test:new', 'not valid json {{{')

      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))

      expect(result.current.hasDraft).toBe(false)
      expect(result.current.savedDraft).toBeNull()
    })

    it('removes draft with missing required fields', () => {
      const invalidDraft = { title: 'Test' } // Missing most fields
      localStorageMock.setItem('greengale-draft:did:plc:test:new', JSON.stringify(invalidDraft))

      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))

      expect(result.current.hasDraft).toBe(false)
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('greengale-draft:did:plc:test:new')
    })

    it('removes draft with invalid lexicon value', () => {
      const invalidDraft = createTestDraft({ lexicon: 'invalid' as 'greengale' })
      localStorageMock.setItem('greengale-draft:did:plc:test:new', JSON.stringify(invalidDraft))

      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))

      expect(result.current.hasDraft).toBe(false)
    })

    it('removes draft with invalid visibility value', () => {
      const invalidDraft = createTestDraft({ visibility: 'invalid' as 'public' })
      localStorageMock.setItem('greengale-draft:did:plc:test:new', JSON.stringify(invalidDraft))

      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))

      expect(result.current.hasDraft).toBe(false)
    })

    it('removes draft with invalid viewMode value', () => {
      const invalidDraft = createTestDraft({ viewMode: 'invalid' as 'edit' })
      localStorageMock.setItem('greengale-draft:did:plc:test:new', JSON.stringify(invalidDraft))

      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))

      expect(result.current.hasDraft).toBe(false)
    })
  })

  describe('Size Limit', () => {
    it('does not save draft exceeding size limit', () => {
      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))
      const largeDraft = createTestDraft({
        content: 'x'.repeat(2200 * 1024), // ~2.2MB content, exceeds 2MB limit
      })

      // Spy on console.warn
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      act(() => {
        result.current.saveDraftNow(largeDraft)
      })

      // No draft call should have been made (only storage test calls)
      const draftCall = localStorageMock.setItem.mock.calls.find(
        (call: [string, string]) => call[0].startsWith('greengale-draft:')
      )
      expect(draftCall).toBeUndefined()
      expect(warnSpy).toHaveBeenCalledWith('Draft exceeds size limit, not saving')

      warnSpy.mockRestore()
    })
  })

  describe('Storage Unavailable', () => {
    it('handles localStorage being unavailable gracefully', () => {
      // Simulate localStorage not available
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: () => {
            throw new Error('localStorage disabled')
          },
          setItem: () => {
            throw new Error('localStorage disabled')
          },
          removeItem: () => {
            throw new Error('localStorage disabled')
          },
        },
        writable: true,
      })

      // Need to re-import to pick up the unavailable localStorage
      // For this test, we'll just verify the hook doesn't throw
      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))

      expect(result.current.hasDraft).toBe(false)
      expect(result.current.isStorageAvailable).toBe(false)
    })
  })

  describe('DID Changes', () => {
    it('clears draft when user logs out (did becomes null)', () => {
      const draft = createTestDraft()
      localStorageMock.setItem('greengale-draft:did:plc:test:new', JSON.stringify(draft))

      const { result, rerender } = renderHook(
        ({ did }) => useDraftAutoSave(did, undefined),
        { initialProps: { did: 'did:plc:test' as string | null } }
      )

      expect(result.current.hasDraft).toBe(true)

      // Simulate logout
      rerender({ did: null })

      expect(result.current.hasDraft).toBe(false)
      expect(result.current.savedDraft).toBeNull()
    })

    it('loads different draft when switching users', () => {
      const draft1 = createTestDraft({ title: 'User 1 Draft' })
      const draft2 = createTestDraft({ title: 'User 2 Draft' })
      localStorageMock.setItem('greengale-draft:did:plc:user1:new', JSON.stringify(draft1))
      localStorageMock.setItem('greengale-draft:did:plc:user2:new', JSON.stringify(draft2))

      const { result, rerender } = renderHook(
        ({ did }) => useDraftAutoSave(did, undefined),
        { initialProps: { did: 'did:plc:user1' } }
      )

      expect(result.current.savedDraft?.title).toBe('User 1 Draft')

      rerender({ did: 'did:plc:user2' })

      expect(result.current.savedDraft?.title).toBe('User 2 Draft')
    })
  })

  describe('Debounce Behavior', () => {
    it('cancels previous debounce when saveDraft is called again', () => {
      vi.useFakeTimers()

      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))

      // Clear any calls from initialization
      localStorageMock.setItem.mockClear()

      // Call saveDraft multiple times rapidly
      act(() => {
        result.current.saveDraft(createTestDraft({ title: 'First' }))
      })
      act(() => {
        vi.advanceTimersByTime(1000) // Advance 1 second (before debounce)
        result.current.saveDraft(createTestDraft({ title: 'Second' }))
      })
      act(() => {
        vi.advanceTimersByTime(1000) // Advance another 1 second
        result.current.saveDraft(createTestDraft({ title: 'Third' }))
      })

      // No saves yet
      const draftCallsBefore = localStorageMock.setItem.mock.calls.filter(
        (call: [string, string]) => call[0].startsWith('greengale-draft:')
      )
      expect(draftCallsBefore).toHaveLength(0)

      // Advance past debounce period
      act(() => {
        vi.advanceTimersByTime(2500)
      })

      // Only one save should have occurred (the last one)
      const draftCalls = localStorageMock.setItem.mock.calls.filter(
        (call: [string, string]) => call[0].startsWith('greengale-draft:')
      )
      expect(draftCalls).toHaveLength(1)

      // And it should be the last draft
      const savedData = JSON.parse(draftCalls[0][1])
      expect(savedData.title).toBe('Third')

      vi.useRealTimers()
    })

    it('cleans up debounce timer on unmount', () => {
      vi.useFakeTimers()

      const { result, unmount } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))

      // Clear any calls from initialization
      localStorageMock.setItem.mockClear()

      // Start a debounced save
      act(() => {
        result.current.saveDraft(createTestDraft())
      })

      // Unmount before debounce completes
      unmount()

      // Advance past debounce period
      act(() => {
        vi.advanceTimersByTime(3000)
      })

      // No draft should have been saved (timer was cleaned up)
      const draftCalls = localStorageMock.setItem.mock.calls.filter(
        (call: [string, string]) => call[0].startsWith('greengale-draft:')
      )
      expect(draftCalls).toHaveLength(0)

      vi.useRealTimers()
    })
  })

  describe('lastSavedAt', () => {
    it('returns null when no draft exists', () => {
      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))

      expect(result.current.lastSavedAt).toBeNull()
    })

    it('returns correct date from saved draft', () => {
      const savedAt = '2024-01-15T10:30:00.000Z'
      const draft = createTestDraft({ savedAt })
      localStorageMock.setItem('greengale-draft:did:plc:test:new', JSON.stringify(draft))

      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))

      expect(result.current.lastSavedAt).toEqual(new Date(savedAt))
    })

    it('updates lastSavedAt after saving', () => {
      const { result } = renderHook(() => useDraftAutoSave('did:plc:test', undefined))

      expect(result.current.lastSavedAt).toBeNull()

      act(() => {
        result.current.saveDraftNow(createTestDraft())
      })

      expect(result.current.lastSavedAt).toBeInstanceOf(Date)
      // Should be recent
      const diff = Date.now() - result.current.lastSavedAt!.getTime()
      expect(diff).toBeLessThan(1000)
    })
  })
})
