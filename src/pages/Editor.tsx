import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams, useBlocker } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
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

type LexiconType = 'greengale' | 'whitewind'

const LEXICON_OPTIONS = [
  { value: 'greengale', label: 'GreenGale', description: 'Extended features: themes, LaTeX' },
  { value: 'whitewind', label: 'WhiteWind', description: 'Compatible with whtwnd.com' },
] as const

export function EditorPage() {
  const { rkey } = useParams<{ rkey?: string }>()
  const navigate = useNavigate()
  const { isAuthenticated, isWhitelisted, isLoading, session, handle } = useAuth()

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
  const { setActivePostTheme, setActiveCustomColors } = useThemePreference()

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

  // Redirect if not authenticated or not whitelisted
  useEffect(() => {
    if (!isLoading && (!isAuthenticated || !isWhitelisted)) {
      navigate('/', { replace: true })
    }
  }, [isLoading, isAuthenticated, isWhitelisted, navigate])

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
  }, [session, content, visibility, isWhiteWind, isEditing, originalCreatedAt, title, subtitle, theme, customColors, enableLatex, rkey])

  async function handlePublish() {
    setPublishing(true)
    setError(null)
    // Set justSaved before the async operation to prevent blocker from triggering
    setJustSaved(true)

    const resultRkey = await savePost()

    if (resultRkey) {
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

  if (isLoading || loadingPost) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-[var(--site-accent)] border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!isAuthenticated || !isWhitelisted) {
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
              {showPreview ? 'Edit' : 'Preview'}
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
                <MarkdownRenderer content={content} enableLatex={enableLatex} />
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
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your post in markdown..."
                rows={20}
                className="w-full px-4 py-3 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] placeholder:text-[var(--site-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)] font-mono text-sm resize-y"
              />
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

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 overflow-hidden">
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
