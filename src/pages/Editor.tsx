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
import { extractCidFromBlobref } from '@/lib/image-labels'
import { getPdsEndpoint } from '@/lib/atproto'
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

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public', description: 'Anyone can see this post' },
  { value: 'url', label: 'Unlisted', description: 'Only people with the link can see' },
  { value: 'author', label: 'Private', description: 'Only you can see this post' },
] as const

const RECENT_PALETTES_KEY = 'recent-custom-palettes'
const MAX_RECENT_PALETTES = 5

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

const LEXICON_OPTIONS = [
  { value: 'greengale', label: 'GreenGale', description: 'Extended features: themes, LaTeX' },
  { value: 'whitewind', label: 'WhiteWind', description: 'Compatible with whtwnd.com' },
] as const

export function EditorPage() {
  const { rkey } = useParams<{ rkey?: string }>()
  const navigate = useNavigate()
  const { isAuthenticated, isLoading, session, handle } = useAuth()

  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
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
  const [enableLatex, setEnableLatex] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [loadingPost, setLoadingPost] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [originalCreatedAt, setOriginalCreatedAt] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [recentPalettes, setRecentPalettes] = useState<SavedPalette[]>([])
  const { setActivePostTheme, setActiveCustomColors } = useThemePreference()

  // Image upload state
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadedBlobs, setUploadedBlobs] = useState<UploadedBlob[]>([])
  const [pdsEndpoint, setPdsEndpoint] = useState<string | null>(null)
  // Map PDS blob URLs to local object URLs for preview (avoids CORS issues)
  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(new Map())
  // CID of image currently being edited for metadata
  const [editingImageCid, setEditingImageCid] = useState<string | null>(null)

  // Load recent palettes on mount
  useEffect(() => {
    setRecentPalettes(getRecentPalettes())
  }, [])

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
    let result = content
    previewUrls.forEach((localUrl, pdsUrl) => {
      result = result.split(pdsUrl).join(localUrl)
    })
    return result
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
    enableLatex: boolean
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
  useEffect(() => {
    if (isEditing && session && handle) {
      loadPost()
    }
  }, [isEditing, session, handle])

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
      setEnableLatex(false)
    }
  }, [isWhiteWind])

  // Set initial values for new posts
  useEffect(() => {
    if (!isEditing && !loadingPost && initialValues.current === null) {
      initialValues.current = {
        title: '',
        subtitle: '',
        content: '',
        lexicon: 'greengale',
        theme: 'default',
        customColors: {
          background: '#ffffff',
          text: '#24292f',
          accent: '#0969da',
          codeBackground: '',
        },
        visibility: 'public',
        enableLatex: false,
      }
    }
  }, [isEditing, loadingPost])

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
      visibility !== initialValues.current.visibility ||
      enableLatex !== initialValues.current.enableLatex

    setHasUnsavedChanges(hasChanges)
  }, [title, subtitle, content, lexicon, theme, customColors, visibility, enableLatex])

  // Block navigation when there are unsaved changes
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsavedChanges &&
      !justSaved &&
      currentLocation.pathname !== nextLocation.pathname
  )

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

      // Populate form with existing data
      setTitle(entry.title || '')
      setSubtitle(entry.subtitle || '')
      setContent(entry.content)
      setLexicon(entry.source)
      setVisibility(entry.visibility || 'public')
      setOriginalCreatedAt(entry.createdAt || null)

      // GreenGale-specific fields
      const defaultCustomColors: CustomColors = {
        background: '#ffffff',
        text: '#24292f',
        accent: '#0969da',
        codeBackground: '',
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
        setEnableLatex(entry.latex || false)

        // Restore uploaded blobs if present
        if (entry.blobs && entry.blobs.length > 0) {
          const restoredBlobs: UploadedBlob[] = []
          for (const b of entry.blobs) {
            // Extract CID using robust extraction (handles _CID class instances)
            const cid = extractCidFromBlobref(b.blobref)
            if (!cid) continue

            const blobref = b.blobref as Record<string, unknown>
            restoredBlobs.push({
              cid,
              mimeType: (blobref.mimeType as string) || 'image/avif',
              size: (blobref.size as number) || 0,
              name: b.name || 'image',
              alt: b.alt,
              labels: b.labels,
              blobRef: b.blobref as UploadedBlob['blobRef'],
            })
          }
          setUploadedBlobs(restoredBlobs)
        }
      }

      // Set initial values for change detection
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
        lexicon: entry.source,
        theme: entry.source === 'greengale'
          ? (entry.theme?.custom ? 'custom' : (entry.theme?.preset || 'default'))
          : 'default',
        customColors: loadedCustomColors,
        visibility: entry.visibility || 'public',
        enableLatex: entry.source === 'greengale' ? (entry.latex || false) : false,
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
    if (!session) {
      setError('Not authenticated')
      return null
    }

    if (!content.trim()) {
      setError('Content is required')
      return null
    }

    const visibilityToUse = overrideVisibility || visibility

    try {
      // Build the record based on selected lexicon
      const collection = isWhiteWind ? 'com.whtwnd.blog.entry' : 'app.greengale.blog.entry'

      // Use original createdAt when editing, new timestamp when creating
      const createdAt = isEditing && originalCreatedAt ? originalCreatedAt : new Date().toISOString()

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
            $type: 'com.whtwnd.blog.entry',
            content: content,
            title: title || undefined,
            subtitle: subtitle || undefined,
            createdAt,
            visibility: visibilityToUse,
          }
        : {
            // GreenGale format - extended features
            $type: 'app.greengale.blog.entry',
            content: content,
            title: title || undefined,
            subtitle: subtitle || undefined,
            createdAt,
            theme: themeObj,
            visibility: visibilityToUse,
            latex: enableLatex || undefined,
            // Include uploaded blobs for reference
            blobs:
              uploadedBlobs.length > 0
                ? uploadedBlobs.map((b) => ({
                    blobref: b.blobRef,
                    name: b.name,
                    alt: b.alt || undefined,
                    labels: b.labels,
                  }))
                : undefined,
          }

      let response: Response
      let resultRkey: string

      if (isEditing && rkey) {
        // Update existing record using putRecord
        response = await session.fetchHandler('/xrpc/com.atproto.repo.putRecord', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo: session.did,
            collection,
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
            collection,
            record,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.message || 'Failed to publish post')
        }

        const result = await response.json()
        resultRkey = result.uri.split('/').pop()
      }

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Failed to save post')
      }

      return resultRkey
    } catch (err) {
      console.error('Save error:', err)
      setError(err instanceof Error ? err.message : 'Failed to save post')
      return null
    }
  }, [session, content, visibility, isWhiteWind, isEditing, originalCreatedAt, title, subtitle, theme, customColors, enableLatex, uploadedBlobs, rkey])

  async function handlePublish() {
    setPublishing(true)
    setError(null)
    // Set justSaved before the async operation to prevent blocker from triggering
    setJustSaved(true)

    const resultRkey = await savePost()

    if (resultRkey) {
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

  async function handleDelete() {
    if (!session || !rkey) return

    const confirmed = window.confirm('Are you sure you want to delete this post? This action cannot be undone.')
    if (!confirmed) return

    setDeleting(true)
    setError(null)

    try {
      const collection = isWhiteWind ? 'com.whtwnd.blog.entry' : 'app.greengale.blog.entry'

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

      // Navigate to author page after deletion
      navigate(`/${handle}`, { replace: true })
    } catch (err) {
      console.error('Delete error:', err)
      setError(err instanceof Error ? err.message : 'Failed to delete post')
    } finally {
      setDeleting(false)
    }
  }

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

      if (!session || !pdsEndpoint) {
        setUploadError('Not authenticated or PDS endpoint not available')
        return
      }

      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
      if (files.length === 0) {
        return
      }

      // Get cursor position from textarea
      const textarea = textareaRef.current
      let cursorPosition = textarea?.selectionStart ?? content.length

      setUploadError(null)

      for (const file of files) {
        try {
          const result = await processAndUploadImage(
            file,
            (url, init) => session.fetchHandler(url, init),
            pdsEndpoint,
            session.did,
            setUploadProgress
          )

          // Track uploaded blob for record save
          setUploadedBlobs((prev) => [...prev, result.uploadedBlob])

          // Create local object URL for preview (avoids CORS issues with PDS)
          const localPreviewUrl = URL.createObjectURL(file)
          setPreviewUrls((prev) => new Map(prev).set(result.markdownUrl, localPreviewUrl))

          // Generate markdown and insert at cursor position
          const markdown = generateMarkdownImage(
            file.name.replace(/\.[^.]+$/, ''), // Use filename without extension as alt
            result.markdownUrl
          )

          // Insert markdown at cursor position
          const before = content.slice(0, cursorPosition)
          const after = content.slice(cursorPosition)
          const insertText = '\n' + markdown + '\n'
          const newContent = before + insertText + after
          setContent(newContent)

          // Update cursor position for next image
          cursorPosition += insertText.length
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : 'Failed to upload image')
        }
      }

      setUploadProgress(null)
    },
    [session, pdsEndpoint, content]
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
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
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
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            )}
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="px-4 py-2 text-sm rounded-lg border border-[var(--site-border)] text-[var(--site-text-secondary)] hover:bg-[var(--site-bg-secondary)] transition-colors"
            >
              {showPreview ? 'Back to Editor' : 'Preview'}
            </button>
            <button
              onClick={handlePublish}
              disabled={publishing || !content.trim() || hasContrastError}
              className="px-4 py-2 text-sm bg-[var(--site-accent)] text-white rounded-lg hover:bg-[var(--site-accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={hasContrastError ? 'Fix contrast issues before publishing' : undefined}
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

        {showPreview ? (
          /* Preview Mode */
          <div className="rounded-lg border border-[var(--site-border)] overflow-hidden">
            <div
              className="p-8 bg-[var(--theme-bg)] text-[var(--theme-text)]"
              style={theme === 'custom' ? getCustomColorStyles(customColors) : undefined}
            >
              {title && (
                <h1 className="text-3xl font-bold mb-2">{title}</h1>
              )}
              {subtitle && (
                <p className="text-xl text-[var(--theme-text-secondary)] mb-6">{subtitle}</p>
              )}
              <div className="prose max-w-none">
                <MarkdownRenderer content={previewContent} enableLatex={enableLatex} />
              </div>
            </div>
          </div>
        ) : (
          /* Edit Mode */
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
                placeholder="Post title (optional)"
                className="w-full px-4 py-3 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] placeholder:text-[var(--site-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]"
              />
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

            {/* Content */}
            <div>
              <label className="block text-sm font-medium text-[var(--site-text-secondary)] mb-2">
                Content (Markdown)
              </label>
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  placeholder="Write your post in markdown... (drag and drop images to upload)"
                  rows={40}
                  className={`w-full px-4 py-3 rounded-lg border bg-[var(--site-bg)] text-[var(--site-text)] placeholder:text-[var(--site-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)] font-mono text-sm resize-y transition-colors ${
                    isDragging
                      ? 'border-[var(--site-accent)] border-2 bg-[var(--site-accent)]/5'
                      : 'border-[var(--site-border)]'
                  }`}
                />

                {/* Drag overlay indicator */}
                {isDragging && (
                  <div className="absolute inset-0 flex items-center justify-center bg-[var(--site-accent)]/10 rounded-lg border-2 border-dashed border-[var(--site-accent)] pointer-events-none">
                    <div className="text-[var(--site-accent)] font-medium text-lg">
                      Drop images to upload
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
                            onSave={(alt, labels) =>
                              handleImageMetadataSave(blob.cid, alt, labels)
                            }
                            onCancel={() => setEditingImageCid(null)}
                          />
                        ) : (
                          <div className="flex items-center gap-3 p-2 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)]">
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
                                {blob.labels?.values.length ? (
                                  <span className="text-xs text-amber-600 dark:text-amber-400">
                                    {blob.labels.values.length} label(s)
                                  </span>
                                ) : null}
                                {!blob.alt && !blob.labels?.values.length && (
                                  <span className="text-xs text-[var(--site-text-secondary)]">
                                    No metadata
                                  </span>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setEditingImageCid(blob.cid)}
                              className="flex-shrink-0 p-2 text-[var(--site-text-secondary)] hover:text-[var(--site-accent)] hover:bg-[var(--site-bg-secondary)] rounded transition-colors"
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
                  className="w-full px-4 py-3 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]"
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
                        <path d="M12 8h.01" />
                      </svg>
                      <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 text-xs font-normal text-[var(--site-text)] bg-[var(--site-bg-secondary)] border border-[var(--site-border)] rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 w-64 text-left z-10">
                        This setting controls visibility on GreenGale only. All data stored on your PDS is publicly accessible.
                      </span>
                    </span>
                  </span>
                </label>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as 'public' | 'url' | 'author')}
                  className="w-full px-4 py-3 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]"
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
                        // Pre-fill custom colors when switching to custom from a preset
                        if (newTheme === 'custom' && theme !== 'custom') {
                          const presetColors = getPresetColors(theme)
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

                  {/* LaTeX */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--site-text-secondary)] mb-2">
                      Options
                    </label>
                    <label className="flex items-center gap-3 h-[50px] px-4 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] cursor-pointer hover:bg-[var(--site-bg-secondary)] transition-colors">
                      <span className="relative flex items-center justify-center w-5 h-5">
                        <input
                          type="checkbox"
                          checked={enableLatex}
                          onChange={(e) => setEnableLatex(e.target.checked)}
                          className="peer appearance-none w-5 h-5 rounded border-2 border-[var(--site-border)] bg-[var(--site-bg)] checked:bg-[var(--site-accent)] checked:border-[var(--site-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)] focus:ring-offset-0 transition-colors cursor-pointer"
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
                      <span className="text-[var(--site-text)]">Enable KaTeX</span>
                    </label>
                  </div>
                </div>

                {/* Custom Theme Settings */}
                {theme === 'custom' && (
                  <div className="p-4 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg-secondary)]">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-medium text-[var(--site-text)]">Custom Theme Colors</h3>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-[var(--site-text-secondary)]">Start from:</label>
                        <select
                          onChange={(e) => {
                            const preset = e.target.value as ThemePreset
                            if (preset && preset !== 'custom' && preset !== 'default') {
                              const presetColors = getPresetColors(preset)
                              setCustomColors({
                                background: presetColors.background,
                                text: presetColors.text,
                                accent: presetColors.accent,
                                codeBackground: '',
                              })
                            }
                          }}
                          className="px-2 py-1 text-sm rounded border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] focus:outline-none focus:ring-1 focus:ring-[var(--site-accent)]"
                          defaultValue=""
                        >
                          <option value="" disabled>Select preset...</option>
                          {THEME_PRESETS.filter(p => p !== 'default' && p !== 'custom').map((preset) => (
                            <option key={preset} value={preset}>
                              {THEME_LABELS[preset]}
                            </option>
                          ))}
                        </select>
                      </div>
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
                              onClick={() => setCustomColors({
                                background: palette.background,
                                text: palette.text,
                                accent: palette.accent,
                                codeBackground: palette.codeBackground || '',
                              })}
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
                            onChange={(e) => setCustomColors({ ...customColors, background: e.target.value })}
                            className="w-10 h-10 shrink-0 rounded border border-[var(--site-border)] cursor-pointer appearance-none bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-none"
                            style={{ backgroundColor: customColors.background || '#ffffff' }}
                          />
                          <input
                            type="text"
                            value={customColors.background || ''}
                            onChange={(e) => setCustomColors({ ...customColors, background: e.target.value })}
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
                            onChange={(e) => setCustomColors({ ...customColors, text: e.target.value })}
                            className="w-10 h-10 shrink-0 rounded border border-[var(--site-border)] cursor-pointer appearance-none bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-none"
                            style={{ backgroundColor: customColors.text || '#24292f' }}
                          />
                          <input
                            type="text"
                            value={customColors.text || ''}
                            onChange={(e) => setCustomColors({ ...customColors, text: e.target.value })}
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
                            onChange={(e) => setCustomColors({ ...customColors, accent: e.target.value })}
                            className="w-10 h-10 shrink-0 rounded border border-[var(--site-border)] cursor-pointer appearance-none bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-none"
                            style={{ backgroundColor: customColors.accent || '#0969da' }}
                          />
                          <input
                            type="text"
                            value={customColors.accent || ''}
                            onChange={(e) => setCustomColors({ ...customColors, accent: e.target.value })}
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
                            onChange={(e) => setCustomColors({ ...customColors, codeBackground: e.target.value })}
                            className="w-10 h-10 shrink-0 rounded border border-[var(--site-border)] cursor-pointer appearance-none bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-none [&::-moz-color-swatch]:rounded [&::-moz-color-swatch]:border-none"
                            style={{ backgroundColor: customColors.codeBackground || (deriveThemeColors(customColors)?.codeBackground || '#f6f8fa') }}
                          />
                          <input
                            type="text"
                            value={customColors.codeBackground || ''}
                            onChange={(e) => setCustomColors({ ...customColors, codeBackground: e.target.value })}
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
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Unsaved Changes Confirmation Dialog */}
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
              Unsaved Changes
            </h2>
            <p className="text-[var(--site-text-secondary)] mb-6">
              You have unsaved changes that will be lost if you leave this page.
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
                Stay Here
              </button>
              <button
                onClick={handleSaveAsPrivateAndProceed}
                disabled={publishing || !content.trim() || hasContrastError}
                className="w-full px-4 py-2.5 text-sm rounded-lg border border-[var(--site-border)] text-[var(--site-text)] hover:bg-[var(--site-bg-secondary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={hasContrastError ? 'Fix contrast issues before saving' : undefined}
              >
                {publishing ? 'Saving...' : 'Save as Private & Exit'}
              </button>
              <button
                onClick={() => blocker.proceed?.()}
                className="w-full px-4 py-2.5 text-sm rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
              >
                Discard & Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
