import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { THEME_PRESETS, THEME_LABELS, type ThemePreset } from '@/lib/themes'
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
  const [visibility, setVisibility] = useState<'public' | 'url' | 'author'>('public')
  const [enableLatex, setEnableLatex] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [loadingPost, setLoadingPost] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [originalCreatedAt, setOriginalCreatedAt] = useState<string | null>(null)
  const { setActivePostTheme } = useThemePreference()

  const isWhiteWind = lexicon === 'whitewind'

  const isEditing = !!rkey

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
    } else {
      setActivePostTheme(theme)
    }
    return () => {
      setActivePostTheme(null)
    }
  }, [theme, isWhiteWind, setActivePostTheme])

  // Reset GreenGale-specific options when switching to WhiteWind
  useEffect(() => {
    if (isWhiteWind) {
      setTheme('default')
      setEnableLatex(false)
    }
  }, [isWhiteWind])

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
      if (entry.source === 'greengale') {
        setTheme(entry.theme?.preset || 'default')
        setEnableLatex(entry.latex || false)
      }
    } catch (err) {
      console.error('Failed to load post:', err)
      setError(err instanceof Error ? err.message : 'Failed to load post')
    } finally {
      setLoadingPost(false)
    }
  }

  async function handlePublish() {
    if (!session) {
      setError('Not authenticated')
      return
    }

    if (!content.trim()) {
      setError('Content is required')
      return
    }

    setPublishing(true)
    setError(null)

    try {
      // Build the record based on selected lexicon
      const collection = isWhiteWind ? 'com.whtwnd.blog.entry' : 'app.greengale.blog.entry'

      // Use original createdAt when editing, new timestamp when creating
      const createdAt = isEditing && originalCreatedAt ? originalCreatedAt : new Date().toISOString()

      const record = isWhiteWind
        ? {
            // WhiteWind format - simpler schema
            $type: 'com.whtwnd.blog.entry',
            content: content,
            title: title || undefined,
            subtitle: subtitle || undefined,
            createdAt,
            visibility: visibility,
          }
        : {
            // GreenGale format - extended features
            $type: 'app.greengale.blog.entry',
            content: content,
            title: title || undefined,
            subtitle: subtitle || undefined,
            createdAt,
            theme: theme !== 'default' ? { preset: theme } : undefined,
            visibility: visibility,
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

      // Navigate to the post
      navigate(`/${handle}/${resultRkey}`, { replace: true })
    } catch (err) {
      console.error('Publish error:', err)
      setError(err instanceof Error ? err.message : 'Failed to save post')
    } finally {
      setPublishing(false)
    }
  }

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
              disabled={publishing || !content.trim()}
              className="px-4 py-2 text-sm bg-[var(--site-accent)] text-white rounded-lg hover:bg-[var(--site-accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
            <div className="p-8 text-[var(--theme-text)]">
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
              <div className="grid md:grid-cols-2 gap-6">
                {/* Theme */}
                <div>
                  <label className="block text-sm font-medium text-[var(--site-text-secondary)] mb-2">
                    Theme
                  </label>
                  <select
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as ThemePreset)}
                    className="w-full px-4 py-3 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] text-[var(--site-text)] focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]"
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
                  <label className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[var(--site-border)] bg-[var(--site-bg)] cursor-pointer hover:bg-[var(--site-bg-secondary)] transition-colors">
                    <input
                      type="checkbox"
                      checked={enableLatex}
                      onChange={(e) => setEnableLatex(e.target.checked)}
                      className="w-4 h-4 rounded border-[var(--site-border)] text-[var(--site-accent)] focus:ring-[var(--site-accent)]"
                    />
                    <span className="text-[var(--site-text)]">Enable KaTeX</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
