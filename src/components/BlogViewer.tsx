import { MarkdownRenderer } from './MarkdownRenderer'
import { AuthorCard } from './AuthorCard'
import { getCustomColorStyles, type Theme } from '@/lib/themes'
import { useThemePreference } from '@/lib/useThemePreference'
import type { AuthorProfile } from '@/lib/atproto'

interface BlogViewerProps {
  content: string
  title?: string
  subtitle?: string
  createdAt?: string
  theme?: Theme
  latex?: boolean
  author?: AuthorProfile
  source?: 'whitewind' | 'greengale'
}

export function BlogViewer({
  content,
  title,
  subtitle,
  createdAt,
  theme,
  latex = false,
  author,
  source,
}: BlogViewerProps) {
  const { forceDefaultTheme } = useThemePreference()

  // Custom color overrides (inline styles) - theme preset is now applied globally via data-active-theme
  // Don't apply custom styles if user has "Use Default Style" enabled
  const customStyles = forceDefaultTheme ? {} : getCustomColorStyles(theme?.custom)

  const formattedDate = createdAt
    ? new Date(createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

  return (
    <article
      style={customStyles}
      className="min-h-screen text-[var(--theme-text)]"
    >
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <header className="mb-8">
          {title && (
            <h1 className="text-3xl md:text-4xl font-bold mb-2 text-[var(--theme-text)]">
              {title}
            </h1>
          )}
          {subtitle && (
            <p className="text-xl text-[var(--theme-text-secondary)] mb-4">
              {subtitle}
            </p>
          )}
          <div className="flex items-center gap-4 text-sm text-[var(--theme-text-secondary)]">
            {formattedDate && <time dateTime={createdAt}>{formattedDate}</time>}
            {source && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-[var(--theme-code-bg)]">
                {source === 'whitewind' ? 'WhiteWind' : 'GreenGale'}
              </span>
            )}
          </div>
        </header>

        {/* Author */}
        {author && (
          <div className="mb-8">
            <AuthorCard author={author} />
          </div>
        )}

        {/* Content */}
        <div className="prose max-w-none">
          <MarkdownRenderer content={content} enableLatex={latex} />
        </div>
      </div>
    </article>
  )
}
