import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate, useParams, useBlocker } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import {
  processAndUploadImage,
  generateMarkdownImage,
  getBlobUrl,
  type UploadedBlob,
  type UploadProgress,
  type ContentLabelValue,
} from '@/lib/image-upload'
import { ImageMetadataEditor } from '@/components/ImageMetadataEditor'
import { MarkdownToolbar, useToolbarCollapsed } from '@/components/MarkdownToolbar'
import { extractCidFromBlobref } from '@/lib/image-labels'
import { getPdsEndpoint, getPublication, savePublication, saveSiteStandardDocument, getSiteStandardPublication, saveSiteStandardPublication, toBasicTheme, extractPlaintext } from '@/lib/atproto'
import {
  THEME_PRESETS,
  THEME_LABELS,
  type ThemePreset,
  type CustomColors,
  getPresetColors,
  deriveThemeColors,
  getCustomColorStyles,
  validateCustomColors,
} from '@/lib/themes'
import { useThemePreference } from '@/lib/useThemePreference'
import { getBlogEntry } from '@/lib/atproto'
import { useDraftAutoSave, type DraftBlobMetadata } from '@/lib/useDraftAutoSave'
import { DraftRestorationBanner } from '@/components/DraftRestorationBanner'

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public', description: 'Anyone can see this post' },
  { value: 'url', label: 'Unlisted', description: 'Only people with the link can see' },
  { value: 'author', label: 'Private', description: 'Only you can see this post' },
] as const

const RECENT_PALETTES_KEY = 'recent-custom-palettes'
const MAX_RECENT_PALETTES = 10

interface SavedPalette {
  background: string
  text: string
  accent: string
  codeBackground?: string
}

function getRecentPalettes(): SavedPalette[] {
  try {
    const stored = localStorage.getItem(RECENT_PALETTES_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveRecentPalette(palette: SavedPalette): void {
  try {
    const existing = getRecentPalettes()

    // Check if this palette already exists (same colors)
    const isDuplicate = existing.some(
      (p) =>
        p.background.toLowerCase() === palette.background.toLowerCase() &&
        p.text.toLowerCase() === palette.text.toLowerCase() &&
        p.accent.toLowerCase() === palette.accent.toLowerCase()
    )

    if (isDuplicate) return

    // Add to front and limit to max
    const updated = [palette, ...existing].slice(0, MAX_RECENT_PALETTES)
    localStorage.setItem(RECENT_PALETTES_KEY, JSON.stringify(updated))
  } catch {
    // localStorage not available
  }
}

type LexiconType = 'greengale' | 'whitewind'

// V1 collection (for backward compatibility when editing old posts)
const GREENGALE_V1_COLLECTION = 'app.greengale.blog.entry'
// V2 document collection (site.standard compatible)
const GREENGALE_V2_COLLECTION = 'app.greengale.document'
// WhiteWind collection
const WHITEWIND_COLLECTION = 'com.whtwnd.blog.entry'

const LEXICON_OPTIONS = [
  { value: 'greengale', label: 'GreenGale', description: 'Extended features: themes, images' },
  { value: 'whitewind', label: 'WhiteWind', description: 'Compatible with whtwnd.com' },
] as const

export function EditorPage() {
  const { rkey } = useParams<{ rkey?: string }>()
  const navigate = useNavigate()
  const { isAuthenticated, isLoading, session, handle } = useAuth()

  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [content, setContent] = useState('')
  const [lexicon, setLexicon] = useState<LexiconType>('greengale')
  const [theme, setTheme] = useState<ThemePreset>('default')
  const [customColors, setCustomColors] = useState<CustomColors>({
    background: '#ffffff',
    text: '#24292f',
    accent: '#0969da',
    codeBackground: '',
  })
  const [visibility, setVisibility] = useState<'public' | 'url' | 'author'>('public')
  const [publishToSiteStandard, setPublishToSiteStandard] = useState(true) // Default enabled, can be overridden per-post
  type ViewMode = 'edit' | 'preview' | 'split'
  const [viewMode, setViewMode] = useState<ViewMode>('edit')
  const [publishing, setPublishing] = useState(false)
  const [publishAttempted, setPublishAttempted] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [loadingPost, setLoadingPost] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [originalCreatedAt, setOriginalCreatedAt] = useState<string | null>(null)
  // Track the original collection when editing (for V1→V2 migration)
  const [originalCollection, setOriginalCollection] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [recentPalettes, setRecentPalettes] = useState<SavedPalette[]>([])
  const { setActivePostTheme, setActiveCustomColors } = useThemePreference()
  const { isCollapsed: isToolbarCollapsed, toggleCollapsed: toggleToolbar } = useToolbarCollapsed()

  // Draft auto-save
  const {
    hasDraft,
    savedDraft,
    saveDraft,
    saveDraftNow,
    clearDraft,
    dismissDraftBanner,
    isBannerDismissed,
    isDraftLoaded,
  } = useDraftAutoSave(session?.did ?? null, rkey)

  // Track if a draft was auto-restored (for showing the "restored" banner)
  const [draftWasRestored, setDraftWasRestored] = useState(false)
  // Ref to track draft restoration status for async functions (avoids stale closure)
  const draftWasRestoredRef = useRef(false)
  // Store the timestamp of the restored draft (for display even after clearing)
  const [restoredDraftSavedAt, setRestoredDraftSavedAt] = useState<Date | null>(null)
  // Store default theme from publication for undo (new posts)
  const defaultThemeRef = useRef<{ theme: ThemePreset; customColors: CustomColors } | null>(null)
  // Store loaded post state for undo (editing)
  const loadedPostStateRef = useRef<{
    tags: string[]
    uploadedBlobs: UploadedBlob[]
  } | null>(null)
  // Track rkey to detect navigation between posts
  const prevRkeyRef = useRef<string | undefined>(rkey)

  // Image upload state
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadedBlobs, setUploadedBlobs] = useState<UploadedBlob[]>([])
  const [pdsEndpoint, setPdsEndpoint] = useState<string | null>(null)
  // Map PDS blob URLs to local object URLs for preview (avoids CORS issues)
  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(new Map())
  // CID of image currently being edited for metadata
  const [editingImageCid, setEditingImageCid] = useState<string | null>(null)
  // Whether to auto-focus alt text field when opening metadata editor
  const [autoFocusAlt, setAutoFocusAlt] = useState(false)

  // Load recent palettes on mount
  useEffect(() => {
    setRecentPalettes(getRecentPalettes())
  }, [])

  // Keep draftWasRestoredRef in sync with state (for async functions to check current value)
  useEffect(() => {
    draftWasRestoredRef.current = draftWasRestored
  }, [draftWasRestored])

  // Reset state when navigating between posts (rkey changes)
  useEffect(() => {
    if (prevRkeyRef.current === rkey) return
    prevRkeyRef.current = rkey

    // Reset draft restoration state
    setDraftWasRestored(false)
    draftWasRestoredRef.current = false
    setRestoredDraftSavedAt(null)

    // Clear refs
    loadedPostStateRef.current = null
    initialValues.current = null

    // Reset form to defaults (loadPost will populate if editing)
    setTitle('')
    setSubtitle('')
    setContent('')
    setTags([])
    setTagInput('')
    setLexicon('greengale')
    setVisibility('public')
    setPublishToSiteStandard(true)
    setViewMode('edit')
    setUploadedBlobs([])
    setError(null)
    setPublishAttempted(false)
    setOriginalCreatedAt(null)
    setOriginalCollection(null)

    // Reset theme to defaults (will be overwritten by publication theme or loaded post)
    if (!rkey && defaultThemeRef.current) {
      // New post: use publication theme
      setTheme(defaultThemeRef.current.theme)
      setCustomColors(defaultThemeRef.current.customColors)
    } else {
      // Editing: reset to default, loadPost will set the correct theme
      setTheme('default')
      setCustomColors({
        background: '#ffffff',
        text: '#24292f',
        accent: '#0969da',
        codeBackground: '',
      })
    }

    // Clean up preview URLs
    previewUrls.forEach((url) => URL.revokeObjectURL(url))
    setPreviewUrls(new Map())
  }, [rkey, previewUrls])

  // Cleanup object URLs on unmount
  const previewUrlsRef = useRef<Map<string, string>>(new Map())
  previewUrlsRef.current = previewUrls
  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  // Compute preview content with local URLs substituted for PDS URLs
  const previewContent = useMemo(() => {
    if (previewUrls.size === 0) return content
    // Build a single regex pattern from all PDS URLs for O(n) replacement
    const pdsUrls = Array.from(previewUrls.keys())
    const escapedUrls = pdsUrls.map((url) => url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const pattern = new RegExp(escapedUrls.join('|'), 'g')
    return content.replace(pattern, (match) => previewUrls.get(match) || match)
  }, [content, previewUrls])

  // Track initial values to detect changes
  const initialValues = useRef<{
    title: string
    subtitle: string
    content: string
    lexicon: LexiconType
    theme: ThemePreset
    customColors: CustomColors
    visibility: 'public' | 'url' | 'author'
  } | null>(null)

  const isWhiteWind = lexicon === 'whitewind'

  const isEditing = !!rkey

  // Check if custom colors have valid contrast
  const customColorsValidation = theme === 'custom' ? validateCustomColors(customColors) : null
  const hasContrastError = theme === 'custom' && customColorsValidation !== null && !customColorsValidation.isValid

  // Redirect if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate('/', { replace: true })
    }
  }, [isLoading, isAuthenticated, navigate])

  // Fetch PDS endpoint when session is available
  useEffect(() => {
    async function fetchPdsEndpoint() {
      if (session?.did) {
        try {
          const endpoint = await getPdsEndpoint(session.did)
          setPdsEndpoint(endpoint)
        } catch (err) {
          console.error('Failed to get PDS endpoint:', err)
        }
      }
    }
    fetchPdsEndpoint()
  }, [session?.did])

  // Load existing post if editing
  // Guards prevent re-loading: !loadingPost ensures we don't start a second load while one is in progress,
  // !initialValues.current ensures we don't re-load after already loaded (prevents overwriting restored drafts)
  useEffect(() => {
    if (isEditing && session && handle && !loadingPost && !initialValues.current) {
      loadPost()
    }
  }, [isEditing, session, handle, loadingPost])

  // Apply theme dynamically while composing (only for GreenGale)
  useEffect(() => {
    if (isWhiteWind) {
      setActivePostTheme(null)
      setActiveCustomColors(null)
    } else if (theme === 'custom') {
      setActivePostTheme('custom')
      setActiveCustomColors(customColors)
    } else {
      setActivePostTheme(theme)
      setActiveCustomColors(null)
    }
    return () => {
      setActivePostTheme(null)
      setActiveCustomColors(null)
    }
  }, [theme, customColors, isWhiteWind, setActivePostTheme, setActiveCustomColors])

  // Reset GreenGale-specific options when switching to WhiteWind
  useEffect(() => {
    if (isWhiteWind) {
      setTheme('default')
      // Clear uploaded images since WhiteWind doesn't support blobs
      if (uploadedBlobs.length > 0) {
        setUploadedBlobs([])
        // Clean up preview URLs
        previewUrls.forEach((url) => URL.revokeObjectURL(url))
        setPreviewUrls(new Map())
      }
    }
  }, [isWhiteWind])

  // Track whether publication theme has been loaded for new posts
  const [publicationThemeLoaded, setPublicationThemeLoaded] = useState(isEditing)

  // Load publication theme for new posts
  useEffect(() => {
    if (isEditing) {
      setPublicationThemeLoaded(true)
      return
    }
    if (!session?.did) return

    async function loadPublicationTheme() {
      let loadedTheme: ThemePreset = 'default'
      let loadedCustomColors: CustomColors = {
        background: '#ffffff',
        text: '#24292f',
        accent: '#0969da',
        codeBackground: '',
      }

      try {
        const publication = await getPublication(session!.did)
        if (publication?.theme) {
          if (publication.theme.custom) {
            loadedTheme = 'custom'
            loadedCustomColors = {
              background: publication.theme.custom.background || '#ffffff',
              text: publication.theme.custom.text || '#24292f',
              accent: publication.theme.custom.accent || '#0969da',
              codeBackground: publication.theme.custom.codeBackground || '',
            }
            setTheme('custom')
            setCustomColors(loadedCustomColors)
          } else if (publication.theme.preset) {
            loadedTheme = publication.theme.preset as ThemePreset
            setTheme(loadedTheme)
          }
        }
        // Initialize site.standard publishing from publication setting (default to true)
        setPublishToSiteStandard(publication?.enableSiteStandard !== false)
      } catch (err) {
        // Ignore errors - just use default theme
        console.warn('Failed to load publication theme:', err)
      } finally {
        // Save defaults for undo functionality
        defaultThemeRef.current = { theme: loadedTheme, customColors: loadedCustomColors }
        setPublicationThemeLoaded(true)
      }
    }

    loadPublicationTheme()
  }, [isEditing, session?.did])

  // Set initial values for new posts (after publication theme is loaded)
  useEffect(() => {
    if (!isEditing && !loadingPost && publicationThemeLoaded && initialValues.current === null) {
      initialValues.current = {
        title: '',
        subtitle: '',
        content: '',
        lexicon: 'greengale',
        theme: theme,
        customColors: customColors,
        visibility: 'public',
      }
    }
  }, [isEditing, loadingPost, publicationThemeLoaded, theme, customColors])

  // Detect unsaved changes
  useEffect(() => {
    if (!initialValues.current) return

    const customColorsChanged = theme === 'custom' && (
      customColors.background !== initialValues.current.customColors.background ||
      customColors.text !== initialValues.current.customColors.text ||
      customColors.accent !== initialValues.current.customColors.accent ||
      customColors.codeBackground !== initialValues.current.customColors.codeBackground
    )

    const hasChanges =
      title !== initialValues.current.title ||
      subtitle !== initialValues.current.subtitle ||
      content !== initialValues.current.content ||
      lexicon !== initialValues.current.lexicon ||
      theme !== initialValues.current.theme ||
      customColorsChanged ||
      visibility !== initialValues.current.visibility

    setHasUnsavedChanges(hasChanges)
  }, [title, subtitle, content, lexicon, theme, customColors, visibility])

  // Auto-save draft to localStorage
  useEffect(() => {
    // Skip while loading post data
    if (loadingPost) return
    // Skip for new posts until publication theme is loaded
    if (!isEditing && !publicationThemeLoaded) return
    // Skip if there's nothing to save
    if (!title.trim() && !content.trim()) return
    // Skip during publish/delete operations
    if (publishing || deleting) return
    // Skip if there's a draft pending restoration (don't overwrite it with PDS content)
    if (isDraftLoaded && hasDraft && !draftWasRestored) return

    // Build blob metadata for draft storage (without blobRef to keep it simple)
    const uploadedBlobsMetadata: DraftBlobMetadata[] = uploadedBlobs.map((b) => ({
      cid: b.cid,
      mimeType: b.mimeType,
      size: b.size,
      name: b.name,
      alt: b.alt,
      labels: b.labels,
    }))

    saveDraft({
      title,
      subtitle,
      content,
      tags,
      tagInput,
      lexicon,
      theme,
      customColors,
      visibility,
      publishToSiteStandard,
      uploadedBlobsMetadata,
      viewMode,
    })
  }, [
    title,
    subtitle,
    content,
    tags,
    tagInput,
    lexicon,
    theme,
    customColors,
    visibility,
    publishToSiteStandard,
    uploadedBlobs,
    viewMode,
    loadingPost,
    isEditing,
    publicationThemeLoaded,
    publishing,
    deleting,
    saveDraft,
    isDraftLoaded,
    hasDraft,
    draftWasRestored,
  ])

  // Auto-restore draft after post/theme is loaded
  useEffect(() => {
    // Wait for draft to be loaded for the current key (prevents restoring stale data)
    if (!isDraftLoaded) return

    // For new posts: wait for publication theme to load
    // For editing: wait for post to finish loading
    if (isEditing) {
      if (loadingPost) return
      // Wait for initial values to be set (post loaded from PDS)
      if (!initialValues.current) return
    } else {
      if (!publicationThemeLoaded) return
    }

    // Only if there's a saved draft
    if (!savedDraft) return
    // Only restore once
    if (draftWasRestored) return

    // Restore draft content
    setTitle(savedDraft.title)
    setSubtitle(savedDraft.subtitle)
    setContent(savedDraft.content)
    setTags(savedDraft.tags)
    setTagInput(savedDraft.tagInput)
    setLexicon(savedDraft.lexicon)
    setTheme(savedDraft.theme)
    setCustomColors(savedDraft.customColors)
    setVisibility(savedDraft.visibility)
    setPublishToSiteStandard(savedDraft.publishToSiteStandard)
    setViewMode(savedDraft.viewMode)

    // Restore blob metadata - reconstruct full UploadedBlob objects
    if (savedDraft.uploadedBlobsMetadata.length > 0) {
      const restoredBlobs: UploadedBlob[] = savedDraft.uploadedBlobsMetadata.map((meta) => ({
        cid: meta.cid,
        mimeType: meta.mimeType,
        size: meta.size,
        name: meta.name,
        alt: meta.alt,
        labels: meta.labels,
        blobRef: {
          $type: 'blob' as const,
          ref: { $link: meta.cid },
          mimeType: meta.mimeType,
          size: meta.size,
        },
      }))
      setUploadedBlobs(restoredBlobs)
    }

    // Mark as restored and save the timestamp for the banner
    setDraftWasRestored(true)
    setRestoredDraftSavedAt(new Date(savedDraft.savedAt))
  }, [isEditing, loadingPost, publicationThemeLoaded, savedDraft, draftWasRestored, isDraftLoaded])

  // Undo draft restoration - reset to original state
  const handleUndoDraft = useCallback(() => {
    // Clear the draft from storage
    clearDraft()

    if (isEditing && initialValues.current) {
      // Editing: restore to the PDS version that was loaded
      setTitle(initialValues.current.title)
      setSubtitle(initialValues.current.subtitle)
      setContent(initialValues.current.content)
      setLexicon(initialValues.current.lexicon)
      setTheme(initialValues.current.theme)
      setCustomColors(initialValues.current.customColors)
      setVisibility(initialValues.current.visibility)
      setTagInput('')
      setViewMode('edit')

      // Restore tags and blobs from the loaded post state
      if (loadedPostStateRef.current) {
        setTags(loadedPostStateRef.current.tags)
        setUploadedBlobs(loadedPostStateRef.current.uploadedBlobs)
      } else {
        setTags([])
        setUploadedBlobs([])
      }
    } else {
      // New post: reset to empty with publication theme
      setTitle('')
      setSubtitle('')
      setContent('')
      setTags([])
      setTagInput('')
      setLexicon('greengale')
      setVisibility('public')
      setPublishToSiteStandard(true)
      setViewMode('edit')
      setUploadedBlobs([])

      // Reset theme to publication defaults
      if (defaultThemeRef.current) {
        setTheme(defaultThemeRef.current.theme)
        setCustomColors(defaultThemeRef.current.customColors)
      } else {
        setTheme('default')
        setCustomColors({
          background: '#ffffff',
          text: '#24292f',
          accent: '#0969da',
          codeBackground: '',
        })
      }
    }

    // Hide the banner
    dismissDraftBanner()
  }, [clearDraft, dismissDraftBanner, isEditing])

  // Block navigation when there are unsaved changes
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsavedChanges &&
      !justSaved &&
      currentLocation.pathname !== nextLocation.pathname
  )

  // Immediately save draft when navigation is blocked (bypass debounce)
  useEffect(() => {
    if (blocker.state === 'blocked' && hasUnsavedChanges) {
      // Build blob metadata for draft storage
      const uploadedBlobsMetadata: DraftBlobMetadata[] = uploadedBlobs.map((b) => ({
        cid: b.cid,
        mimeType: b.mimeType,
        size: b.size,
        name: b.name,
        alt: b.alt,
        labels: b.labels,
      }))

      saveDraftNow({
        title,
        subtitle,
        content,
        tags,
        tagInput,
        lexicon,
        theme,
        customColors,
        visibility,
        publishToSiteStandard,
        uploadedBlobsMetadata,
        viewMode,
      })
    }
  }, [blocker.state, hasUnsavedChanges, title, subtitle, content, tags, tagInput, lexicon, theme, customColors, visibility, publishToSiteStandard, uploadedBlobs, viewMode, saveDraftNow])

  // Handle browser beforeunload event
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges && !justSaved) {
        e.preventDefault()
        e.returnValue = ''
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges, justSaved])

  async function loadPost() {
    if (!handle || !rkey || !session) return

    setLoadingPost(true)
    setError(null)

    try {
      const entry = await getBlogEntry(handle, rkey, session.did)

      if (!entry) {
        setError('Post not found')
        return
      }

      // Check if user owns this post
      if (entry.authorDid !== session.did) {
        setError('You can only edit your own posts')
        navigate('/', { replace: true })
        return
      }

      // If draft was already restored while we were fetching, don't overwrite form fields
      // but still set initialValues for change detection (draft content vs PDS content)
      const skipFormUpdate = draftWasRestoredRef.current

      // Default custom colors (needed for both form update and initialValues)
      const defaultCustomColors: CustomColors = {
        background: '#ffffff',
        text: '#24292f',
        accent: '#0969da',
        codeBackground: '',
      }

      // Populate form with existing data (unless draft was restored)
      if (!skipFormUpdate) {
        setTitle(entry.title || '')
        setSubtitle(entry.subtitle || '')
        setContent(entry.content)
        // Network posts aren't editable in GreenGale, default to greengale
        setLexicon(entry.source === 'whitewind' ? 'whitewind' : 'greengale')
        setVisibility(entry.visibility || 'public')
        setTags(entry.tags || [])
        setOriginalCreatedAt(entry.createdAt || null)

        // Determine original collection for V1→V2 migration
        // V2 posts have url and path fields, V1 posts don't
        if (entry.source === 'greengale') {
          const isV2 = !!(entry.url && entry.path)
          setOriginalCollection(isV2 ? GREENGALE_V2_COLLECTION : GREENGALE_V1_COLLECTION)
        } else {
          setOriginalCollection(WHITEWIND_COLLECTION)
        }

        if (entry.source === 'greengale') {
          // Check if post has custom colors
          if (entry.theme?.custom) {
            setTheme('custom')
            setCustomColors({
              background: entry.theme.custom.background || '#ffffff',
              text: entry.theme.custom.text || '#24292f',
              accent: entry.theme.custom.accent || '#0969da',
              codeBackground: entry.theme.custom.codeBackground || '',
            })
          } else {
            setTheme(entry.theme?.preset || 'default')
          }

          // Restore uploaded blobs if present
          if (entry.blobs && entry.blobs.length > 0) {
            const restoredBlobs: UploadedBlob[] = []
            for (const b of entry.blobs) {
              // Extract CID using robust extraction (handles _CID class instances)
              const cid = extractCidFromBlobref(b.blobref)
              if (!cid) continue

              // Extract mimeType and size from the blobref object
              const blobref = b.blobref as Record<string, unknown>
              const mimeType = (blobref.mimeType as string) || 'image/avif'
              const size = (blobref.size as number) || 0

              // Store the extracted primitive values - blobRef will be reconstructed at save time
              // to ensure proper JSON serialization (SDK class instances may not serialize correctly)
              restoredBlobs.push({
                cid,
                mimeType,
                size,
                name: b.name || 'image',
                alt: b.alt,
                labels: b.labels,
                // Construct a fresh blobRef from primitives for any code that needs it
                blobRef: {
                  $type: 'blob',
                  ref: { $link: cid },
                  mimeType,
                  size,
                },
              })
            }
            setUploadedBlobs(restoredBlobs)
          }
        }
      }

      // Set initial values for change detection (always, even if form update was skipped)
      const loadedCustomColors = entry.source === 'greengale' && entry.theme?.custom
        ? {
            background: entry.theme.custom.background || '#ffffff',
            text: entry.theme.custom.text || '#24292f',
            accent: entry.theme.custom.accent || '#0969da',
            codeBackground: entry.theme.custom.codeBackground || '',
          }
        : defaultCustomColors

      initialValues.current = {
        title: entry.title || '',
        subtitle: entry.subtitle || '',
        content: entry.content,
        lexicon: entry.source === 'whitewind' ? 'whitewind' : 'greengale',
        theme: entry.source === 'greengale'
          ? (entry.theme?.custom ? 'custom' : (entry.theme?.preset || 'default'))
          : 'default',
        customColors: loadedCustomColors,
        visibility: entry.visibility || 'public',
      }

      // Store loaded state for undo (tags and blobs not in initialValues)
      // Get the current uploadedBlobs state that was just set
      const loadedBlobs: UploadedBlob[] = []
      if (entry.source === 'greengale' && entry.blobs && entry.blobs.length > 0) {
        for (const b of entry.blobs) {
          const cid = extractCidFromBlobref(b.blobref)
          if (!cid) continue
          const blobref = b.blobref as Record<string, unknown>
          const mimeType = (blobref.mimeType as string) || 'image/avif'
          const size = (blobref.size as number) || 0
          loadedBlobs.push({
            cid,
            mimeType,
            size,
            name: b.name || 'image',
            alt: b.alt,
            labels: b.labels,
            blobRef: {
              $type: 'blob',
              ref: { $link: cid },
              mimeType,
              size,
            },
          })
        }
      }
      loadedPostStateRef.current = {
        tags: entry.tags || [],
        uploadedBlobs: loadedBlobs,
      }
    } catch (err) {
      console.error('Failed to load post:', err)
      setError(err instanceof Error ? err.message : 'Failed to load post')
    } finally {
      setLoadingPost(false)
    }
  }

  // Core save function that can be reused
  const savePost = useCallback(async (overrideVisibility?: 'public' | 'url' | 'author'): Promise<string | null> => {
    if (!session || !handle) {
      setError('Not authenticated')
      return null
    }

    if (!content.trim()) {
      setError('Content is required')
      return null
    }

    // Title is required for GreenGale posts (standard.site spec compliance)
    if (!isWhiteWind && !title.trim()) {
      setError('Title is required for GreenGale posts')
      return null
    }

    const visibilityToUse = overrideVisibility || visibility

    try {
      // Determine the target collection
      // WhiteWind stays as WhiteWind, GreenGale always saves to V2
      const targetCollection = isWhiteWind ? WHITEWIND_COLLECTION : GREENGALE_V2_COLLECTION

      // Use original date when editing, new timestamp when creating
      const publishedAt = isEditing && originalCreatedAt ? originalCreatedAt : new Date().toISOString()

      // Build theme object for GreenGale posts
      let themeObj: { preset?: string; custom?: CustomColors } | undefined = undefined
      if (!isWhiteWind) {
        if (theme === 'custom') {
          // Custom theme - store the colors
          themeObj = {
            custom: {
              background: customColors.background || undefined,
              text: customColors.text || undefined,
              accent: customColors.accent || undefined,
              codeBackground: customColors.codeBackground || undefined,
            },
          }
        } else if (theme !== 'default') {
          // Preset theme
          themeObj = { preset: theme }
        }
      }

      const record = isWhiteWind
        ? {
            // WhiteWind format - simpler schema
            $type: WHITEWIND_COLLECTION,
            content: content,
            title: title || undefined,
            subtitle: subtitle || undefined,
            createdAt: publishedAt,
            visibility: visibilityToUse,
          }
        : {
            // GreenGale V2 document format (site.standard compatible)
            $type: GREENGALE_V2_COLLECTION,
            content: content,
            title: title.trim(), // Required field per standard.site spec
            subtitle: subtitle || undefined,
            publishedAt,
            // V2-specific fields
            url: 'https://greengale.app',
            path: `/${handle}/${rkey || 'new'}`, // Will be updated with actual rkey after creation
            theme: themeObj,
            visibility: visibilityToUse,
            // Include uploaded blobs for reference
            // IMPORTANT: Always construct blobref from primitive values to ensure
            // proper JSON serialization (SDK class instances may not serialize correctly)
            blobs:
              uploadedBlobs.length > 0
                ? uploadedBlobs.map((b) => ({
                    blobref: {
                      $type: 'blob',
                      ref: { $link: b.cid },
                      mimeType: b.mimeType,
                      size: b.size,
                    },
                    name: b.name,
                    alt: b.alt || undefined,
                    labels: b.labels,
                  }))
                : undefined,
            // Tags for categorization (only include if there are tags)
            tags: tags.length > 0 ? tags : undefined,
          }

      let response: Response
      let resultRkey: string

      // Check if we need to migrate from V1 to V2
      const needsV1Migration = isEditing && rkey && !isWhiteWind &&
        originalCollection === GREENGALE_V1_COLLECTION

      if (needsV1Migration) {
        // V1→V2 migration: Create V2 record first, then delete V1 only on success
        // This prevents data loss if the create fails

        // Update path with the actual rkey
        if (!isWhiteWind && 'path' in record) {
          record.path = `/${handle}/${rkey}`
        }

        // Create new V2 record with the same rkey
        response = await session.fetchHandler('/xrpc/com.atproto.repo.createRecord', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo: session.did,
            collection: targetCollection,
            rkey, // Preserve the same rkey
            record,
          }),
        })

        // Only delete the V1 record if the V2 creation ACTUALLY succeeded
        // We must verify the response is OK before deleting the original
        if (!response.ok) {
          // V2 creation failed - DO NOT delete V1, throw error immediately
          const errorData = await response.json().catch(() => ({ message: 'Unknown error' }))
          throw new Error(`Migration failed: ${errorData.message || 'Failed to create V2 record'}`)
        }

        // V2 creation succeeded - now safe to delete V1
        const deleteResponse = await session.fetchHandler('/xrpc/com.atproto.repo.deleteRecord', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo: session.did,
            collection: GREENGALE_V1_COLLECTION,
            rkey,
          }),
        })

        if (!deleteResponse.ok) {
          const errorData = await deleteResponse.json().catch(() => ({ message: 'Unknown error' }))
          console.error('Failed to delete V1 record during migration:', errorData)
          // V2 record was created successfully, so continue even if V1 delete failed
        }

        resultRkey = rkey
      } else if (isEditing && rkey) {
        // Update existing record using putRecord (V2 or WhiteWind)
        // Update path with the actual rkey for V2
        if (!isWhiteWind && 'path' in record) {
          record.path = `/${handle}/${rkey}`
        }

        response = await session.fetchHandler('/xrpc/com.atproto.repo.putRecord', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo: session.did,
            collection: targetCollection,
            rkey,
            record,
          }),
        })
        resultRkey = rkey
      } else {
        // Create new record
        response = await session.fetchHandler('/xrpc/com.atproto.repo.createRecord', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo: session.did,
            collection: targetCollection,
            record,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.message || 'Failed to publish post')
        }

        const result = await response.json()
        resultRkey = result.uri.split('/').pop()

        // For new V2 posts, update the path with the actual rkey
        if (!isWhiteWind && 'path' in record && resultRkey) {
          record.path = `/${handle}/${resultRkey}`

          // Update the record with the correct path
          await session.fetchHandler('/xrpc/com.atproto.repo.putRecord', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repo: session.did,
              collection: targetCollection,
              rkey: resultRkey,
              record,
            }),
          })
        }
      }

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Failed to save post')
      }

      // Auto-create publication record if one doesn't exist (GreenGale posts only)
      if (!isWhiteWind && session.did) {
        try {
          const existingPublication = await getPublication(session.did)
          if (!existingPublication) {
            // Create minimal publication record
            await savePublication(session, {
              name: handle || 'My Blog',
              url: 'https://greengale.app',
            })
          }
        } catch (pubErr) {
          // Don't fail the post save if publication creation fails
          console.warn('Failed to auto-create publication:', pubErr)
        }
      }

      // Dual-publish to site.standard.document if enabled for this post (public posts only)
      if (!isWhiteWind && publishToSiteStandard && resultRkey && visibilityToUse === 'public') {
        try {
          // Get or create site.standard.publication to get the TID-based rkey
          let pubRkey: string | undefined
          const existingStdPub = await getSiteStandardPublication(session.did)

          if (existingStdPub?.rkey) {
            pubRkey = existingStdPub.rkey
          } else {
            // Create site.standard.publication and get its rkey
            const existingPub = await getPublication(session.did)
            pubRkey = await saveSiteStandardPublication(session, {
              url: existingPub?.url || 'https://greengale.app',
              name: existingPub?.name || handle || 'My Blog',
              description: existingPub?.description,
              basicTheme: existingPub?.theme ? toBasicTheme(existingPub.theme) : undefined,
              preferences: {
                greengale: { theme: existingPub?.theme },
              },
            })
          }

          const greengaleUri = `at://${session.did}/app.greengale.document/${resultRkey}`
          const siteStandardPublicationUri = `at://${session.did}/site.standard.publication/${pubRkey}`

          await saveSiteStandardDocument(
            session,
            {
              site: siteStandardPublicationUri,
              path: `/${resultRkey}`,
              title: title.trim(),
              description: subtitle || undefined,
              publishedAt,
              updatedAt: isEditing ? new Date().toISOString() : undefined,
              textContent: extractPlaintext(content),
              content: {
                $type: 'app.greengale.document#contentRef',
                uri: greengaleUri,
              },
              tags: tags.length > 0 ? tags : undefined,
            },
            resultRkey
          )
        } catch (siteStdErr) {
          // Don't fail the main save if site.standard fails
          console.warn('Failed to dual-publish to site.standard.document:', siteStdErr)
        }
      }

      return resultRkey
    } catch (err) {
      console.error('Save error:', err)
      setError(err instanceof Error ? err.message : 'Failed to save post')
      return null
    }
  }, [session, handle, content, visibility, isWhiteWind, isEditing, originalCreatedAt, originalCollection, title, subtitle, tags, theme, customColors, publishToSiteStandard, uploadedBlobs, rkey])

  async function handlePublish() {
    setPublishAttempted(true)
    setPublishing(true)
    setError(null)
    // Set justSaved before the async operation to prevent blocker from triggering
    setJustSaved(true)

    const resultRkey = await savePost()

    if (resultRkey) {
      // Clear the draft since we successfully published
      clearDraft()
      // Save custom palette to recent palettes if using custom theme
      if (theme === 'custom' && customColors.background && customColors.text && customColors.accent) {
        saveRecentPalette({
          background: customColors.background,
          text: customColors.text,
          accent: customColors.accent,
          codeBackground: customColors.codeBackground || undefined,
        })
      }
      // Navigate to the post
      navigate(`/${handle}/${resultRkey}`, { replace: true })
    } else {
      // Reset justSaved if save failed so blocker works again
      setJustSaved(false)
    }

    setPublishing(false)
  }

  // Save as private and proceed with navigation (for blocker dialog)
  const handleSaveAsPrivateAndProceed = useCallback(async () => {
    if (!blocker.location) return

    setPublishAttempted(true)
    setPublishing(true)
    setError(null)

    const resultRkey = await savePost('author')

    if (resultRkey) {
      setJustSaved(true)
      blocker.proceed?.()
    } else {
      // If save failed, reset blocker to show dialog again
      blocker.reset?.()
    }

    setPublishing(false)
  }, [blocker, savePost])

  function handleDeleteClick() {
    if (!session || !rkey) return
    setShowDeleteConfirm(true)
  }

  async function handleConfirmDelete() {
    if (!session || !rkey) return

    setDeleting(true)
    setError(null)

    try {
      // Use the original collection that the post was loaded from
      // This handles both V1 and V2 posts correctly
      const collection = originalCollection ||
        (isWhiteWind ? WHITEWIND_COLLECTION : GREENGALE_V2_COLLECTION)

      const response = await session.fetchHandler('/xrpc/com.atproto.repo.deleteRecord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: session.did,
          collection,
          rkey,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Failed to delete post')
      }

      // Also delete the site.standard.document record if it exists (for GreenGale posts)
      if (!isWhiteWind) {
        try {
          await session.fetchHandler('/xrpc/com.atproto.repo.deleteRecord', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repo: session.did,
              collection: 'site.standard.document',
              rkey,
            }),
          })
        } catch {
          // Ignore errors - the site.standard.document may not exist
        }
      }

      // Prevent the unsaved changes blocker from triggering
      setJustSaved(true)
      setShowDeleteConfirm(false)

      // Navigate to author page after deletion
      navigate(`/${handle}`, { replace: true })
    } catch (err) {
      console.error('Delete error:', err)
      setError(err instanceof Error ? err.message : 'Failed to delete post')
    } finally {
      setDeleting(false)
    }
  }

  // Check if a file is likely an image (handles iOS photo library quirks)
  const isImageFile = useCallback((file: File): boolean => {
    // Check MIME type first
    if (file.type.startsWith('image/')) return true
    // iOS photo library sometimes doesn't set MIME type, check extension
    const ext = file.name.toLowerCase().split('.').pop()
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif', 'bmp', 'svg']
    if (ext && imageExtensions.includes(ext)) return true
    // For iOS "image.jpg" style names without proper type, accept if it looks like a photo
    if (file.type === '' && file.name.match(/\.(jpg|jpeg|png|heic|heif)$/i)) return true
    return false
  }, [])

  // Drag and drop handlers for image upload
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set dragging false if we're leaving the textarea entirely
    if (e.currentTarget.contains(e.relatedTarget as Node)) {
      return
    }
    setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      // WhiteWind format doesn't support image blobs
      if (isWhiteWind) {
        setUploadError('Image uploads are not supported in WhiteWind format. Switch to GreenGale format to attach images.')
        return
      }

      if (!session || !pdsEndpoint) {
        setUploadError('Not authenticated or PDS endpoint not available')
        return
      }

      const files = Array.from(e.dataTransfer.files).filter(isImageFile)
      if (files.length === 0) {
        return
      }

      // Get cursor position from textarea at drop time
      const textarea = textareaRef.current
      let cursorPosition = textarea?.selectionStart ?? content.length

      setUploadError(null)

      // Process files with placeholder approach
      for (const file of files) {
        // Generate unique placeholder ID
        const placeholderId = `uploading-${crypto.randomUUID()}`
        const placeholderMarkdown = `![Uploading ${file.name}...](${placeholderId})`
        const insertText = '\n' + placeholderMarkdown + '\n'

        // Insert placeholder immediately at cursor position
        setContent((currentContent) => {
          const before = currentContent.slice(0, cursorPosition)
          const after = currentContent.slice(cursorPosition)
          return before + insertText + after
        })

        // Update cursor position for next image
        cursorPosition += insertText.length

        // Process upload asynchronously
        processAndUploadImage(
          file,
          (url, init) => session.fetchHandler(url, init),
          pdsEndpoint,
          session.did,
          setUploadProgress
        )
          .then((result) => {
            // Track uploaded blob for record save
            setUploadedBlobs((prev) => [...prev, result.uploadedBlob])

            // Create local object URL for preview (avoids CORS issues with PDS)
            const localPreviewUrl = URL.createObjectURL(file)
            setPreviewUrls((prev) => new Map(prev).set(result.markdownUrl, localPreviewUrl))

            // Replace placeholder with actual markdown
            const finalMarkdown = generateMarkdownImage('', result.markdownUrl)
            setContent((currentContent) => currentContent.replace(placeholderMarkdown, finalMarkdown))
          })
          .catch((err) => {
            // Remove placeholder on failure
            setContent((currentContent) => currentContent.replace('\n' + placeholderMarkdown + '\n', ''))
            setUploadError(err instanceof Error ? err.message : 'Failed to upload image')
          })
          .finally(() => {
            setUploadProgress(null)
          })
      }
    },
    [session, pdsEndpoint, content, isWhiteWind, isImageFile]
  )

  // Handle paste for image upload from clipboard
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      // Check if clipboard contains files (images)
      const items = e.clipboardData?.items
      if (!items) return

      // Extract image files from clipboard
      const imageFiles: File[] = []
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            imageFiles.push(file)
          }
        }
      }

      // If no images, let the default paste behavior happen (text paste)
      if (imageFiles.length === 0) return

      // Prevent default paste behavior for images
      e.preventDefault()

      // WhiteWind format doesn't support image blobs
      if (isWhiteWind) {
        setUploadError('Image uploads are not supported in WhiteWind format. Switch to GreenGale format to attach images.')
        return
      }

      if (!session || !pdsEndpoint) {
        setUploadError('Not authenticated or PDS endpoint not available')
        return
      }

      // Get cursor position from textarea
      const textarea = textareaRef.current
      let cursorPosition = textarea?.selectionStart ?? content.length

      setUploadError(null)

      // Process files with placeholder approach (same as drag-drop)
      for (const file of imageFiles) {
        // Generate unique placeholder ID
        const placeholderId = `uploading-${crypto.randomUUID()}`
        // Use a generic name for pasted images (they often don't have meaningful names)
        const displayName = file.name || 'pasted-image'
        const placeholderMarkdown = `![Uploading ${displayName}...](${placeholderId})`
        const insertText = '\n' + placeholderMarkdown + '\n'

        // Insert placeholder immediately at cursor position
        setContent((currentContent) => {
          const before = currentContent.slice(0, cursorPosition)
          const after = currentContent.slice(cursorPosition)
          return before + insertText + after
        })

        // Update cursor position for next image
        cursorPosition += insertText.length

        // Process upload asynchronously
        processAndUploadImage(
          file,
          (url, init) => session.fetchHandler(url, init),
          pdsEndpoint,
          session.did,
          setUploadProgress
        )
          .then((result) => {
            // Track uploaded blob for record save
            setUploadedBlobs((prev) => [...prev, result.uploadedBlob])

            // Create local object URL for preview (avoids CORS issues with PDS)
            const localPreviewUrl = URL.createObjectURL(file)
            setPreviewUrls((prev) => new Map(prev).set(result.markdownUrl, localPreviewUrl))

            // Replace placeholder with actual markdown
            const finalMarkdown = generateMarkdownImage('', result.markdownUrl)
            setContent((currentContent) => currentContent.replace(placeholderMarkdown, finalMarkdown))
          })
          .catch((err) => {
            // Remove placeholder on failure
            setContent((currentContent) => currentContent.replace('\n' + placeholderMarkdown + '\n', ''))
            setUploadError(err instanceof Error ? err.message : 'Failed to upload image')
          })
          .finally(() => {
            setUploadProgress(null)
          })
      }
    },
    [session, pdsEndpoint, content, isWhiteWind]
  )

  // Handle file input selection (for mobile/button upload)
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return

      // Convert to array BEFORE resetting input (FileList is live and gets cleared)
      const fileArray = Array.from(files)

      // Reset the input so the same file can be selected again
      e.target.value = ''

      if (!session || !pdsEndpoint) {
        setUploadError('Not authenticated or PDS endpoint not available')
        return
      }

      const imageFiles = fileArray.filter(isImageFile)
      if (imageFiles.length === 0) {
        setUploadError('No valid image files selected')
        return
      }

      // Get cursor position from textarea at selection time
      const textarea = textareaRef.current
      let cursorPosition = textarea?.selectionStart ?? content.length

      setUploadError(null)

      // Process files with placeholder approach
      for (const file of imageFiles) {
        // Generate unique placeholder ID
        const placeholderId = `uploading-${crypto.randomUUID()}`
        const placeholderMarkdown = `![Uploading ${file.name}...](${placeholderId})`
        const insertText = '\n' + placeholderMarkdown + '\n'

        // Insert placeholder immediately at cursor position
        setContent((currentContent) => {
          const before = currentContent.slice(0, cursorPosition)
          const after = currentContent.slice(cursorPosition)
          return before + insertText + after
        })

        // Update cursor position for next image
        cursorPosition += insertText.length

        // Process upload asynchronously
        processAndUploadImage(
          file,
          (url, init) => session.fetchHandler(url, init),
          pdsEndpoint,
          session.did,
          setUploadProgress
        )
          .then((result) => {
            // Track uploaded blob for record save
            setUploadedBlobs((prev) => [...prev, result.uploadedBlob])

            // Create local object URL for preview (avoids CORS issues with PDS)
            const localPreviewUrl = URL.createObjectURL(file)
            setPreviewUrls((prev) => new Map(prev).set(result.markdownUrl, localPreviewUrl))

            // Replace placeholder with actual markdown
            const finalMarkdown = generateMarkdownImage('', result.markdownUrl)
            setContent((currentContent) => currentContent.replace(placeholderMarkdown, finalMarkdown))
          })
          .catch((err) => {
            // Remove placeholder on failure
            setContent((currentContent) => currentContent.replace('\n' + placeholderMarkdown + '\n', ''))
            setUploadError(err instanceof Error ? err.message : 'Failed to upload image')
          })
          .finally(() => {
            setUploadProgress(null)
          })
      }
    },
    [session, pdsEndpoint, content, isImageFile]
  )

  // Update metadata (alt text and labels) for an uploaded image
  const handleImageMetadataSave = useCallback(
    (cid: string, alt: string, labels: ContentLabelValue[]) => {
      setUploadedBlobs((prev) =>
        prev.map((blob) =>
          blob.cid === cid
            ? {
                ...blob,
                alt: alt || undefined,
                labels:
                  labels.length > 0
                    ? { values: labels.map((l) => ({ val: l })) }
                    : undefined,
              }
            : blob
        )
      )
      setEditingImageCid(null)
    },
    []
  )

  // Delete an uploaded image from the post
  const handleDeleteImage = useCallback(
    (cid: string, imageName: string) => {
      if (!confirm(`Remove "${imageName}" from this post?\n\nNote: This will remove the image attachment. You may also want to delete its markdown reference from the content.`)) {
        return
      }
      setUploadedBlobs((prev) => prev.filter((blob) => blob.cid !== cid))
      // Also remove from preview URLs
      setPreviewUrls((prev) => {
        const next = new Map(prev)
        // Find and remove the preview URL for this CID
        for (const [url, previewUrl] of next.entries()) {
          if (url.includes(cid)) {
            URL.revokeObjectURL(previewUrl)
            next.delete(url)
          }
        }
        return next
      })
      // Close editor if this image was being edited
      if (editingImageCid === cid) {
        setEditingImageCid(null)
      }
    },
    [editingImageCid]
  )

  // Get image URL for display
  const getImagePreviewUrl = useCallback(
    (cid: string) => {
      if (!pdsEndpoint || !session?.did) return ''
      const pdsUrl = getBlobUrl(pdsEndpoint, session.did, cid)
      // Use local preview URL if available (avoids CORS)
      return previewUrls.get(pdsUrl) || pdsUrl
    },
    [pdsEndpoint, session?.did, previewUrls]
  )

  // Copy image markdown reference to clipboard
  const [copiedCid, setCopiedCid] = useState<string | null>(null)
  const handleCopyImageReference = useCallback(
    async (blob: UploadedBlob) => {
      if (!pdsEndpoint || !session?.did) return
      const markdownUrl = getBlobUrl(pdsEndpoint, session.did, blob.cid)
      const markdown = generateMarkdownImage(blob.alt || '', markdownUrl)
      try {
        await navigator.clipboard.writeText(markdown)
        setCopiedCid(blob.cid)
        setTimeout(() => setCopiedCid(null), 2000)
      } catch (err) {
        console.error('Failed to copy to clipboard:', err)
      }
    },
    [pdsEndpoint, session?.did]
  )

  if (isLoading || loadingPost) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-[var(--site-accent)] border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="min-h-screen">
      {/* Header - consistent width regardless of view mode */}
      <div className="max-w-4xl mx-auto px-4 pt-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-[var(--site-text)]">
            {isEditing ? 'Edit Post' : 'New Post'}
          </h1>
          <div className="flex items-center gap-2 md:gap-4">
            <button
              onClick={() => navigate(-1)}
              className="px-4 py-2 text-sm rounded-lg border border-[var(--site-border)] text-[var(--site-text-secondary)] hover:bg-[var(--site-bg-secondary)] transition-colors"
            >
              Cancel
            </button>
            {isEditing && (
              <button
                onClick={handleDeleteClick}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            )}
            <button
              onClick={() => setViewMode(viewMode === 'preview' ? 'edit' : 'preview')}
              className="px-4 py-2 text-sm rounded-lg border border-[var(--site-border)] text-[var(--site-text-secondary)] hover:bg-[var(--site-bg-secondary)] transition-colors"
            >
              {viewMode === 'preview' ? 'Back to Editor' : 'Preview'}
            </button>
            <button
              onClick={() => setViewMode(viewMode === 'split' ? 'edit' : 'split')}
              className={`hidden lg:flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border transition-colors ${
                viewMode === 'split'
                  ? 'border-[var(--site-accent)] bg-[var(--site-accent)]/10 text-[var(--site-accent)]'
                  : 'border-[var(--site-border)] text-[var(--site-text-secondary)] hover:bg-[var(--site-bg-secondary)]'
              }`}
              title={viewMode === 'split' ? 'Exit split view' : 'Split view'}
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="8" height="18" rx="1" />
                <rect x="13" y="3" width="8" height="18" rx="1" />
              </svg>
              <span>Split</span>
            </button>
            <button
              onClick={handlePublish}
              disabled={publishing || !content.trim() || hasContrastError || (!isWhiteWind && !title.trim())}
              className="px-4 py-2 text-sm bg-[var(--site-accent)] text-white rounded-lg hover:bg-[var(--site-accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={hasContrastError ? 'Fix contrast issues before publishing' : (!isWhiteWind && !title.trim()) ? 'Title is required' : undefined}
            >
              {publishing ? 'Saving...' : isEditing ? 'Update' : 'Publish'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-600">
            {error}
          </div>
        )}

        {/* Draft restored banner - shows after auto-restore */}
        {draftWasRestored && !isBannerDismissed && restoredDraftSavedAt && (
          <DraftRestorationBanner
            savedAt={restoredDraftSavedAt}
            onUndo={handleUndoDraft}
            onDismiss={dismissDraftBanner}
          />
        )}
      </div>

      {/* Content area - width changes based on view mode */}
      <div className={`mx-auto pb-8 ${viewMode === 'split' ? 'max-w-[1800px] px-4 lg:px-6' : 'max-w-4xl px-4'}`}>
        {/* Main content area - grid in split mode */}
        <div className={viewMode === 'split' ? 'grid lg:grid-cols-2 gap-6' : ''}>
          {/* Editor section - shown in edit and split modes */}
          {viewMode !== 'preview' && (
            <div className="space-y-6">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-[var(--site-text-secondary)] mb-2">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={isWhiteWind ? "Post title (optional)" : "Title (required)"}
                className={`w-full px-4 py-3 rounded-lg border bg-[var(--site-bg)] text-[var(--site-text)] placeholder:text-[var(--site-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)] ${
                  publishAttempted && !isWhiteWind && !title.trim() ? 'border-red-500/50' : 'border-[var(--site-border)]'
                }`}
              />
              {publishAttempted && !isWhiteWind && !title.trim() && (
                <p className="mt-1 text-xs text-red-500">Title is required</p>
              )}
            </div>

            {/* Subtitle */}
            <div>
              <label className="block text-sm font-medium text-[var(--site-text-secondary)] mb-2">
                Subtitle
              </label>
              <input
                type="text"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="Post subtitle (optional)"
                className="w-full px-4 py-3 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] placeholder:text-[var(--site-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]"
              />
            </div>

            {/* Tags - GreenGale only */}
            {!isWhiteWind && (
              <div>
                <label className="block text-sm font-medium text-[var(--site-text-secondary)] mb-2">
                  Tags <span className="text-xs font-normal">({tags.length}/100)</span>
                </label>
                <div className="space-y-2">
                  {/* Tag chips */}
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm bg-[var(--site-accent)]/10 text-[var(--site-accent)]"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => setTags(tags.filter((t) => t !== tag))}
                            className="hover:text-red-500 focus:outline-none"
                            aria-label={`Remove tag ${tag}`}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Tag input */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                          e.preventDefault()
                          const newTag = tagInput.trim().toLowerCase().replace(/^#/, '')
                          if (newTag && !tags.includes(newTag) && tags.length < 100 && newTag.length <= 100) {
                            setTags([...tags, newTag])
                          }
                          setTagInput('')
                        }
                      }}
                      placeholder="Add a tag and press Enter"
                      className="flex-1 px-4 py-2 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] placeholder:text-[var(--site-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)] text-sm"
                      disabled={tags.length >= 100}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (tagInput.trim()) {
                          const newTag = tagInput.trim().toLowerCase().replace(/^#/, '')
                          if (newTag && !tags.includes(newTag) && tags.length < 100 && newTag.length <= 100) {
                            setTags([...tags, newTag])
                          }
                          setTagInput('')
                        }
                      }}
                      disabled={!tagInput.trim() || tags.length >= 100}
                      className="px-3 py-2 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] hover:bg-[var(--site-bg-secondary)] disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Content */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-[var(--site-text-secondary)]">
                  Content (Markdown)
                </label>
                {/* Toolbar buttons - only show for GreenGale format */}
                {!isWhiteWind && (
                  <div className="flex items-center gap-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!session || !pdsEndpoint || !!uploadProgress}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md border border-[var(--site-border)] text-[var(--site-text-secondary)] hover:bg-[var(--site-bg-secondary)] hover:text-[var(--site-text)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Upload image"
                    >
                      <svg
                        className="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                      <span className="hidden sm:inline">Add Image</span>
                    </button>
                    <button
                      type="button"
                      onClick={toggleToolbar}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md text-[var(--site-text-secondary)] hover:bg-[var(--site-bg-secondary)] hover:text-[var(--site-text)] transition-colors"
                      title={isToolbarCollapsed ? 'Show formatting toolbar' : 'Hide formatting toolbar'}
                    >
                      <span className="hidden sm:inline">Toolbar</span>
                      <svg
                        className={`w-4 h-4 transition-transform ${isToolbarCollapsed ? '' : 'rotate-180'}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>

              {/* Markdown Formatting Toolbar */}
              {!isToolbarCollapsed && (
                <MarkdownToolbar
                  textareaRef={textareaRef}
                  content={content}
                  onContentChange={setContent}
                />
              )}

              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onPaste={handlePaste}
                  placeholder={isWhiteWind ? "Write your post in markdown..." : "Write your post in markdown... (drag, drop, or paste images to upload)"}
                  rows={40}
                  className={`w-full px-4 py-3 rounded-lg border bg-[var(--site-bg)] text-[var(--site-text)] placeholder:text-[var(--site-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)] font-mono text-sm resize-y transition-colors ${
                    isDragging
                      ? 'border-[var(--site-accent)] border-2 bg-[var(--site-accent)]/5'
                      : 'border-[var(--site-border)]'
                  }`}
                />

                {/* Drag overlay indicator */}
                {isDragging && (
                  <div className={`absolute inset-0 flex items-center justify-center rounded-lg border-2 border-dashed pointer-events-none ${
                    isWhiteWind
                      ? 'bg-red-500/10 border-red-500/50'
                      : 'bg-[var(--site-accent)]/10 border-[var(--site-accent)]'
                  }`}>
                    <div className={`font-medium text-lg ${isWhiteWind ? 'text-red-500' : 'text-[var(--site-accent)]'}`}>
                      {isWhiteWind ? 'Image uploads not supported in WhiteWind format' : 'Drop images to upload'}
                    </div>
                  </div>
                )}

                {/* Upload progress indicator */}
                {uploadProgress && (
                  <div className="absolute bottom-4 left-4 right-4 bg-[var(--site-bg-secondary)] border border-[var(--site-border)] rounded-lg p-4 shadow-lg">
                    <div className="flex items-center gap-3">
                      <div className="animate-spin w-5 h-5 border-2 border-[var(--site-accent)] border-t-transparent rounded-full" />
                      <div className="flex-1">
                        <div className="text-sm text-[var(--site-text)]">
                          {uploadProgress.stage === 'validating' && 'Validating...'}
                          {uploadProgress.stage === 'resizing' && 'Resizing image...'}
                          {uploadProgress.stage === 'encoding' && 'Encoding to AVIF...'}
                          {uploadProgress.stage === 'uploading' && 'Uploading to PDS...'}
                        </div>
                        <div className="text-xs text-[var(--site-text-secondary)] mt-1">
                          {uploadProgress.filename}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 bg-[var(--site-border)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--site-accent)] transition-all duration-200"
                        style={{ width: `${uploadProgress.progress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Upload error display */}
              {uploadError && (
                <div className="mt-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-600 text-sm flex items-center justify-between">
                  <span>{uploadError}</span>
                  <button
                    onClick={() => setUploadError(null)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <svg
                      className="w-4 h-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Uploaded Images Panel */}
              {uploadedBlobs.length > 0 && (
                <div className="mt-4 border border-[var(--site-border)] rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-[var(--site-bg-secondary)] border-b border-[var(--site-border)]">
                    <h3 className="text-sm font-medium text-[var(--site-text)]">
                      Uploaded Images ({uploadedBlobs.length})
                    </h3>
                  </div>
                  <div className="p-3 space-y-3">
                    {uploadedBlobs.map((blob) => (
                      <div key={blob.cid}>
                        {editingImageCid === blob.cid ? (
                          <ImageMetadataEditor
                            imageUrl={getImagePreviewUrl(blob.cid)}
                            imageName={blob.name}
                            initialAlt={blob.alt || ''}
                            initialLabels={
                              blob.labels?.values.map((l) => l.val) || []
                            }
                            onSave={(alt, labels) => {
                              handleImageMetadataSave(blob.cid, alt, labels)
                              setAutoFocusAlt(false)
                            }}
                            onCancel={() => {
                              setEditingImageCid(null)
                              setAutoFocusAlt(false)
                            }}
                            autoFocusAlt={autoFocusAlt}
                          />
                        ) : (
                          <div
                            className="flex items-center gap-3 p-2 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] cursor-pointer hover:bg-[var(--site-bg-secondary)] transition-colors"
                            onClick={() => setEditingImageCid(blob.cid)}
                          >
                            <img
                              src={getImagePreviewUrl(blob.cid)}
                              alt=""
                              className="w-12 h-12 object-cover rounded flex-shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-[var(--site-text)] truncate">
                                {blob.name}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5">
                                {blob.alt && (
                                  <span className="text-xs text-green-600 dark:text-green-400">
                                    Has alt text
                                  </span>
                                )}
                                {!blob.alt && (
                                  <span className="text-xs text-red-600 dark:text-red-400">
                                    No alt text
                                  </span>
                                )}
                                {blob.labels?.values.length ? (
                                  <span className="text-xs text-amber-600 dark:text-amber-400">
                                    {blob.labels.values.length} label(s)
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <div className="flex-shrink-0 flex items-center gap-1">
                              {!blob.alt && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setAutoFocusAlt(true)
                                    setEditingImageCid(blob.cid)
                                  }}
                                  className="px-2 py-1 text-xs text-[var(--site-text-secondary)] hover:text-[var(--site-accent)] hover:bg-[var(--site-bg-secondary)] rounded border border-[var(--site-border)] transition-colors"
                                  title="Add alt text"
                                >
                                  + Alt
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleCopyImageReference(blob)
                                }}
                                className={`p-2 rounded transition-colors ${
                                  copiedCid === blob.cid
                                    ? 'text-green-500 bg-green-500/10'
                                    : 'text-[var(--site-text-secondary)] hover:text-[var(--site-accent)] hover:bg-[var(--site-bg-secondary)]'
                                }`}
                                title={copiedCid === blob.cid ? 'Copied!' : 'Copy markdown reference'}
                              >
                                {copiedCid === blob.cid ? (
                                  <svg
                                    className="w-4 h-4"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                ) : (
                                  <svg
                                    className="w-4 h-4"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                  </svg>
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setAutoFocusAlt(false)
                                  setEditingImageCid(blob.cid)
                                }}
                                className="p-2 text-[var(--site-text-secondary)] hover:text-[var(--site-accent)] hover:bg-[var(--site-bg-secondary)] rounded transition-colors"
                                title="Edit metadata"
                              >
                                <svg
                                  className="w-4 h-4"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteImage(blob.cid, blob.name)
                                }}
                                className="p-2 text-[var(--site-text-secondary)] hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                                title="Remove image"
                              >
                                <svg
                                  className="w-4 h-4"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  <line x1="10" y1="11" x2="10" y2="17" />
                                  <line x1="14" y1="11" x2="14" y2="17" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Options */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Lexicon */}
              <div>
                <label className="block text-sm font-medium text-[var(--site-text-secondary)] mb-2">
                  Post Format
                </label>
                <select
                  value={lexicon}
                  onChange={(e) => setLexicon(e.target.value as LexiconType)}
                  className="w-full pl-4 pr-6 py-3 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]"
                >
                  {LEXICON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-[var(--site-text-secondary)]">
                  {LEXICON_OPTIONS.find(o => o.value === lexicon)?.description}
                </p>
              </div>

              {/* Visibility */}
              <div>
                <label className="block text-sm font-medium text-[var(--site-text-secondary)] mb-2">
                  <span className="inline-flex items-center gap-1.5">
                    Visibility
                    <span className="group relative">
                      <svg
                        className="w-4 h-4 text-[var(--site-text-secondary)] cursor-help"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 16v-4" />
                        <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
                      </svg>
                      <span className="absolute left-0 bottom-full mb-2 px-3 py-2 text-xs font-normal text-[var(--site-text)] bg-[var(--site-bg-secondary)] border border-[var(--site-border)] rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 w-64 max-w-[calc(100vw-2rem)] text-left z-10">
                        This setting controls visibility on GreenGale only. All data stored on your PDS is publicly accessible.
                      </span>
                    </span>
                  </span>
                </label>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as 'public' | 'url' | 'author')}
                  className="w-full pl-4 pr-6 py-3 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]"
                >
                  {VISIBILITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* GreenGale-specific options */}
            {!isWhiteWind && (
              <>
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Theme */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--site-text-secondary)] mb-2">
                      Theme
                    </label>
                    <select
                      value={theme}
                      onChange={(e) => {
                        const newTheme = e.target.value as ThemePreset
                        setTheme(newTheme)
                        // Update color pickers to reflect the selected preset's colors
                        if (newTheme !== 'custom') {
                          const presetColors = getPresetColors(newTheme)
                          setCustomColors({
                            background: presetColors.background,
                            text: presetColors.text,
                            accent: presetColors.accent,
                            codeBackground: '',
                          })
                        }
                      }}
                      className="w-full h-[50px] px-4 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]"
                    >
                      {THEME_PRESETS.map((preset) => (
                        <option key={preset} value={preset}>
                          {THEME_LABELS[preset]}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Options */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--site-text-secondary)] mb-2">
                      Options
                    </label>
                    <div className="space-y-2">
                      <label className={`flex items-center gap-3 h-[50px] px-4 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] cursor-pointer hover:bg-[var(--site-bg-secondary)] transition-colors ${visibility !== 'public' ? 'opacity-50' : ''}`}>
                        <span className="relative flex items-center justify-center w-5 h-5">
                          <input
                            type="checkbox"
                            checked={publishToSiteStandard && visibility === 'public'}
                            onChange={(e) => setPublishToSiteStandard(e.target.checked)}
                            disabled={visibility !== 'public'}
                            className="peer appearance-none w-5 h-5 rounded border-2 border-[var(--site-border)] bg-[var(--site-bg)] checked:bg-[var(--site-accent)] checked:border-[var(--site-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)] focus:ring-offset-0 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          <svg
                            className="absolute w-3 h-3 text-white pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </span>
                        <span className="text-[var(--site-text)]">
                          Publish to standard.site
                          {visibility !== 'public' && <span className="text-xs text-[var(--site-text-secondary)] ml-1">(public only)</span>}
                        </span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Theme Color Customization */}
                <div className="p-4 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg-secondary)]">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-[var(--site-text)]">
                      Customize Colors
                      {theme !== 'custom' && (
                        <span className="ml-2 text-xs font-normal text-[var(--site-text-secondary)]">
                          (editing will switch to custom theme)
                        </span>
                      )}
                    </h3>
                  </div>

                    {/* Recent Palettes */}
                    {recentPalettes.length > 0 && (
                      <div className="mb-4">
                        <p className="text-xs text-[var(--site-text-secondary)] mb-2">Recent palettes:</p>
                        <div className="flex flex-wrap gap-2">
                          {recentPalettes.map((palette, index) => (
                            <button
                              key={index}
                              type="button"
                              onClick={() => {
                                setTheme('custom')
                                setCustomColors({
                                  background: palette.background,
                                  text: palette.text,
                                  accent: palette.accent,
                                  codeBackground: palette.codeBackground || '',
                                })
                              }}
                              className="flex rounded overflow-hidden border border-[var(--site-border)] hover:border-[var(--site-accent)] transition-colors"
                              title={`Background: ${palette.background}, Text: ${palette.text}, Accent: ${palette.accent}`}
                            >
                              <div
                                className="w-6 h-6"
                                style={{ backgroundColor: palette.background }}
                              />
                              <div
                                className="w-6 h-6"
                                style={{ backgroundColor: palette.text }}
                              />
                              <div
                                className="w-6 h-6"
                                style={{ backgroundColor: palette.accent }}
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {/* Background */}
                      <div>
                        <label className="block text-xs text-[var(--site-text-secondary)] mb-1">
                          Background
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={customColors.background || '#ffffff'}
                            onChange={(e) => { setTheme('custom'); setCustomColors({ ...customColors, background: e.target.value }) }}
                            className="w-10 h-10 shrink-0 rounded border border-[var(--site-border)] cursor-pointer appearance-none bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-none"
                            style={{ backgroundColor: customColors.background || '#ffffff' }}
                          />
                          <input
                            type="text"
                            value={customColors.background || ''}
                            onChange={(e) => { setTheme('custom'); setCustomColors({ ...customColors, background: e.target.value }) }}
                            placeholder="#ffffff"
                            className="flex-1 min-w-0 px-2 py-1.5 text-sm rounded border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--site-accent)]"
                          />
                        </div>
                      </div>

                      {/* Text */}
                      <div>
                        <label className="block text-xs text-[var(--site-text-secondary)] mb-1">
                          Text
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={customColors.text || '#24292f'}
                            onChange={(e) => { setTheme('custom'); setCustomColors({ ...customColors, text: e.target.value }) }}
                            className="w-10 h-10 shrink-0 rounded border border-[var(--site-border)] cursor-pointer appearance-none bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-none"
                            style={{ backgroundColor: customColors.text || '#24292f' }}
                          />
                          <input
                            type="text"
                            value={customColors.text || ''}
                            onChange={(e) => { setTheme('custom'); setCustomColors({ ...customColors, text: e.target.value }) }}
                            placeholder="#24292f"
                            className="flex-1 min-w-0 px-2 py-1.5 text-sm rounded border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--site-accent)]"
                          />
                        </div>
                      </div>

                      {/* Accent */}
                      <div>
                        <label className="block text-xs text-[var(--site-text-secondary)] mb-1">
                          Accent
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={customColors.accent || '#0969da'}
                            onChange={(e) => { setTheme('custom'); setCustomColors({ ...customColors, accent: e.target.value }) }}
                            className="w-10 h-10 shrink-0 rounded border border-[var(--site-border)] cursor-pointer appearance-none bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-none"
                            style={{ backgroundColor: customColors.accent || '#0969da' }}
                          />
                          <input
                            type="text"
                            value={customColors.accent || ''}
                            onChange={(e) => { setTheme('custom'); setCustomColors({ ...customColors, accent: e.target.value }) }}
                            placeholder="#0969da"
                            className="flex-1 min-w-0 px-2 py-1.5 text-sm rounded border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--site-accent)]"
                          />
                        </div>
                      </div>

                      {/* Code Background (optional) */}
                      <div>
                        <label className="block text-xs text-[var(--site-text-secondary)] mb-1">
                          Code Block <span className="opacity-60">(optional)</span>
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={customColors.codeBackground || (deriveThemeColors(customColors)?.codeBackground || '#f6f8fa')}
                            onChange={(e) => { setTheme('custom'); setCustomColors({ ...customColors, codeBackground: e.target.value }) }}
                            className="w-10 h-10 shrink-0 rounded border border-[var(--site-border)] cursor-pointer appearance-none bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-none"
                            style={{ backgroundColor: customColors.codeBackground || (deriveThemeColors(customColors)?.codeBackground || '#f6f8fa') }}
                          />
                          <input
                            type="text"
                            value={customColors.codeBackground || ''}
                            onChange={(e) => { setTheme('custom'); setCustomColors({ ...customColors, codeBackground: e.target.value }) }}
                            placeholder="Auto"
                            className="flex-1 min-w-0 px-2 py-1.5 text-sm rounded border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--site-accent)]"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Preview and Contrast Validation */}
                    {customColors.background && customColors.text && customColors.accent && (() => {
                      const validation = validateCustomColors(customColors)
                      return (
                        <div className="mt-4 pt-4 border-t border-[var(--site-border)]">
                          {/* Contrast warnings */}
                          {!validation.isValid && (
                            <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                              <p className="text-yellow-600 dark:text-yellow-400 text-sm font-medium mb-2">
                                Low contrast warning
                              </p>
                              <ul className="text-xs text-yellow-600/80 dark:text-yellow-400/80 space-y-1">
                                {validation.textContrast && !validation.textContrast.passes && (
                                  <li>
                                    Text contrast: {validation.textContrast.ratio.toFixed(1)}:1 (minimum 4.5:1 required)
                                  </li>
                                )}
                                {validation.accentContrast && validation.accentContrast.ratio < 3 && (
                                  <li>
                                    Accent contrast: {validation.accentContrast.ratio.toFixed(1)}:1 (minimum 3:1 required)
                                  </li>
                                )}
                              </ul>
                            </div>
                          )}

                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs text-[var(--site-text-secondary)]">Preview:</p>
                            {validation.isValid && (
                              <span className="text-xs text-green-600 dark:text-green-400">
                                ✓ Contrast OK ({validation.textContrast?.ratio.toFixed(1)}:1)
                              </span>
                            )}
                          </div>
                          <div
                            className="p-4 rounded-lg"
                            style={{ backgroundColor: customColors.background }}
                          >
                            <p style={{ color: customColors.text }} className="text-sm mb-2">
                              This is how your text will look. <a href="#" onClick={(e) => e.preventDefault()} style={{ color: customColors.accent }} className="underline">Links appear like this.</a>
                            </p>
                            <div
                              className="px-3 py-2 rounded text-sm font-mono"
                              style={{
                                backgroundColor: customColors.codeBackground || deriveThemeColors(customColors)?.codeBackground || customColors.background,
                                color: customColors.text,
                              }}
                            >
                              const code = "block"
                            </div>
                          </div>
                        </div>
                      )
                    })()}
                </div>
              </>
            )}
          </div>
          )}

          {/* Preview section - shown in preview and split modes */}
          {(viewMode === 'preview' || viewMode === 'split') && (
            <div className={viewMode === 'split' ? 'lg:sticky lg:top-4 self-start' : ''}>
              <div className="rounded-lg border border-[var(--site-border)] overflow-hidden">
                <div
                  className="p-8 bg-[var(--theme-bg)] text-[var(--theme-text)]"
                  style={theme === 'custom' ? getCustomColorStyles(customColors) : undefined}
                >
                  {title && (
                    <h1 className="text-3xl font-bold font-title mb-2">{title}</h1>
                  )}
                  {subtitle && (
                    <p className="text-xl text-[var(--theme-text-secondary)] mb-6">{subtitle}</p>
                  )}
                  <div className={`prose max-w-none ${viewMode === 'split' ? 'max-h-[calc(100vh-12rem)] overflow-y-auto' : ''}`}>
                    <MarkdownRenderer content={previewContent} enableLatex={!isWhiteWind} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Leave Editor Confirmation Dialog */}
      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => blocker.reset?.()}
          />
          {/* Dialog */}
          <div className="relative bg-[var(--site-bg)] border border-[var(--site-border)] rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h2 className="text-xl font-bold text-[var(--site-text)] mb-2">
              Leave Editor?
            </h2>
            <p className="text-[var(--site-text-secondary)] mb-6">
              Your draft has been saved locally and will be restored when you return. You can also publish it now to save it to your account.
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-600 text-sm">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={() => blocker.reset?.()}
                className="w-full px-4 py-2.5 text-sm bg-[var(--site-accent)] text-white rounded-lg hover:bg-[var(--site-accent-hover)] transition-colors"
              >
                Continue Editing
              </button>
              <button
                onClick={handleSaveAsPrivateAndProceed}
                disabled={publishing || !content.trim() || hasContrastError || (!isWhiteWind && !title.trim())}
                className="w-full px-4 py-2.5 text-sm rounded-lg border border-[var(--site-border)] text-[var(--site-text)] hover:bg-[var(--site-bg-secondary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={hasContrastError ? 'Fix contrast issues before saving' : (!isWhiteWind && !title.trim()) ? 'Title is required' : undefined}
              >
                {publishing ? 'Publishing...' : 'Publish as Private & Exit'}
              </button>
              <button
                onClick={() => blocker.proceed?.()}
                className="w-full px-4 py-2.5 text-sm rounded-lg text-[var(--site-text-secondary)] hover:bg-[var(--site-bg-secondary)] transition-colors"
              >
                Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !deleting && setShowDeleteConfirm(false)}
          />
          {/* Dialog */}
          <div className="relative bg-[var(--site-bg)] border border-red-500/30 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-red-500/10">
                <svg
                  className="w-5 h-5 text-red-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-[var(--site-text)]">
                Delete Post
              </h2>
            </div>
            <p className="text-[var(--site-text-secondary)] mb-2">
              Are you sure you want to delete <span className="font-medium text-[var(--site-text)]">"{title || 'this post'}"</span>?
            </p>
            <p className="text-sm text-[var(--site-text-secondary)] mb-6">
              This action cannot be undone. The post will be permanently removed from your PDS.
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-600 text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 text-sm rounded-lg border border-[var(--site-border)] text-[var(--site-text)] hover:bg-[var(--site-bg-secondary)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting...' : 'Delete Post'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
