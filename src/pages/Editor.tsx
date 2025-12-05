import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { THEME_PRESETS, type ThemePreset } from '@/lib/themes'

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public', description: 'Anyone can see this post' },
  { value: 'url', label: 'Unlisted', description: 'Only people with the link can see' },
  { value: 'author', label: 'Private', description: 'Only you can see this post' },
] as const

export function EditorPage() {
  const { rkey } = useParams<{ rkey?: string }>()
  const navigate = useNavigate()
  const { isAuthenticated, isWhitelisted, isLoading, session, handle } = useAuth()

  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [content, setContent] = useState('')
  const [theme, setTheme] = useState<ThemePreset>('github-light')
  const [visibility, setVisibility] = useState<'public' | 'url' | 'author'>('public')
  const [enableLatex, setEnableLatex] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  async function loadPost() {
    // TODO: Implement loading existing post for editing
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
      // Use the session's fetchHandler to make authenticated requests
      const response = await session.fetchHandler('/xrpc/com.atproto.repo.createRecord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: session.did,
          collection: 'app.greengale.blog.entry',
          record: {
            $type: 'app.greengale.blog.entry',
            content: content,
            title: title || undefined,
            subtitle: subtitle || undefined,
            createdAt: new Date().toISOString(),
            theme: { preset: theme },
            visibility: visibility,
            latex: enableLatex || undefined,
          },
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Failed to publish post')
      }

      const result = await response.json()
      const newRkey = result.uri.split('/').pop()

      // Navigate to the new post
      navigate(`/${handle}/${newRkey}`, { replace: true })
    } catch (err) {
      console.error('Publish error:', err)
      setError(err instanceof Error ? err.message : 'Failed to publish post')
    } finally {
      setPublishing(false)
    }
  }

  if (isLoading) {
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
          <div className="flex items-center gap-4">
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
              {publishing ? 'Publishing...' : isEditing ? 'Update' : 'Publish'}
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
              data-theme={theme}
              className="p-8 bg-[var(--theme-bg)] text-[var(--theme-text)]"
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
            <div className="grid md:grid-cols-3 gap-6">
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
                      {preset.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </option>
                  ))}
                </select>
              </div>

              {/* Visibility */}
              <div>
                <label className="block text-sm font-medium text-[var(--site-text-secondary)] mb-2">
                  Visibility
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
                  <span className="text-[var(--site-text)]">Enable LaTeX</span>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
