import { useState, useCallback } from 'react'

const STORAGE_KEY = 'markdown-toolbar-collapsed'

// Hook for managing toolbar collapsed state (used by Editor)
export function useToolbarCollapsed() {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed(prev => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, String(next))
      } catch {
        // localStorage not available
      }
      return next
    })
  }, [])

  return { isCollapsed, toggleCollapsed }
}

interface MarkdownToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  content: string
  onContentChange: (content: string) => void
}

type FormatType = 'wrap' | 'prefix' | 'block' | 'insert' | 'link'

interface FormatAction {
  type: FormatType
  syntax: string
  syntaxEnd?: string
  placeholder?: string
}

const FORMATS: Record<string, FormatAction> = {
  h1: { type: 'prefix', syntax: '# ', placeholder: 'Heading 1' },
  h2: { type: 'prefix', syntax: '## ', placeholder: 'Heading 2' },
  h3: { type: 'prefix', syntax: '### ', placeholder: 'Heading 3' },
  bold: { type: 'wrap', syntax: '**', placeholder: 'bold text' },
  italic: { type: 'wrap', syntax: '_', placeholder: 'italic text' },
  strikethrough: { type: 'wrap', syntax: '~~', placeholder: 'strikethrough' },
  code: { type: 'wrap', syntax: '`', placeholder: 'code' },
  codeblock: { type: 'block', syntax: '```', placeholder: '' },
  ul: { type: 'prefix', syntax: '- ', placeholder: 'List item' },
  ol: { type: 'prefix', syntax: '1. ', placeholder: 'List item' },
  quote: { type: 'prefix', syntax: '> ', placeholder: 'Quote' },
  hr: { type: 'insert', syntax: '\n---\n' },
  link: { type: 'link', syntax: '', placeholder: '' },
}

// Icons
function BoldIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
      <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
    </svg>
  )
}

function ItalicIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="4" x2="10" y2="4" />
      <line x1="14" y1="20" x2="5" y2="20" />
      <line x1="15" y1="4" x2="9" y2="20" />
    </svg>
  )
}

function StrikethroughIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 4H9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8H7" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  )
}

function CodeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  )
}

function CodeBlockIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <polyline points="9 9 6 12 9 15" />
      <polyline points="15 9 18 12 15 15" />
    </svg>
  )
}

function ListIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function OrderedListIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="10" y1="6" x2="21" y2="6" />
      <line x1="10" y1="12" x2="21" y2="12" />
      <line x1="10" y1="18" x2="21" y2="18" />
      <text x="3" y="8" fontSize="7" fill="currentColor" stroke="none" fontWeight="bold" fontFamily="sans-serif">1</text>
      <text x="3" y="14" fontSize="7" fill="currentColor" stroke="none" fontWeight="bold" fontFamily="sans-serif">2</text>
      <text x="3" y="20" fontSize="7" fill="currentColor" stroke="none" fontWeight="bold" fontFamily="sans-serif">3</text>
    </svg>
  )
}

function QuoteIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 11h-4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.667-1.333 4.333-4 5" />
      <path d="M19 11h-4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.667-1.333 4.333-4 5" />
    </svg>
  )
}

function HorizontalRuleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  )
}

function LinkIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

export function MarkdownToolbar({
  textareaRef,
  content,
  onContentChange,
}: MarkdownToolbarProps) {
  const applyFormat = useCallback((formatKey: string) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const format = FORMATS[formatKey]
    if (!format) return

    // Save scroll position before modifying content
    const scrollTop = textarea.scrollTop

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = content.slice(start, end)
    const hasSelection = start !== end

    let newContent: string
    let newCursorStart: number
    let newCursorEnd: number

    switch (format.type) {
      case 'wrap': {
        const syntaxEnd = format.syntaxEnd || format.syntax
        if (hasSelection) {
          const wrapped = `${format.syntax}${selectedText}${syntaxEnd}`
          newContent = content.slice(0, start) + wrapped + content.slice(end)
          newCursorStart = start + format.syntax.length
          newCursorEnd = start + format.syntax.length + selectedText.length
        } else {
          const placeholder = format.placeholder || 'text'
          const inserted = `${format.syntax}${placeholder}${syntaxEnd}`
          newContent = content.slice(0, start) + inserted + content.slice(end)
          newCursorStart = start + format.syntax.length
          newCursorEnd = start + format.syntax.length + placeholder.length
        }
        break
      }

      case 'prefix': {
        const lineStart = content.lastIndexOf('\n', start - 1) + 1
        if (hasSelection) {
          // Prefix each line in selection
          const beforeSelection = content.slice(0, lineStart)
          const selectionWithLineStart = content.slice(lineStart, end)
          const afterSelection = content.slice(end)
          const lines = selectionWithLineStart.split('\n')
          const prefixed = lines.map(line => format.syntax + line).join('\n')
          newContent = beforeSelection + prefixed + afterSelection
          newCursorStart = lineStart + format.syntax.length
          newCursorEnd = lineStart + prefixed.length
        } else {
          const placeholder = format.placeholder || 'text'
          const lineEnd = content.indexOf('\n', start)
          const actualLineEnd = lineEnd === -1 ? content.length : lineEnd
          const currentLine = content.slice(lineStart, actualLineEnd)

          if (currentLine.trim() === '') {
            // Empty line: insert prefix + placeholder
            newContent = content.slice(0, lineStart) + format.syntax + placeholder + content.slice(actualLineEnd)
            newCursorStart = lineStart + format.syntax.length
            newCursorEnd = lineStart + format.syntax.length + placeholder.length
          } else {
            // Non-empty line: just add prefix
            newContent = content.slice(0, lineStart) + format.syntax + content.slice(lineStart)
            newCursorStart = start + format.syntax.length
            newCursorEnd = start + format.syntax.length
          }
        }
        break
      }

      case 'block': {
        const blockContent = hasSelection ? selectedText : (format.placeholder || '')
        const needsNewlineBefore = start > 0 && content[start - 1] !== '\n'
        const needsNewlineAfter = end < content.length && content[end] !== '\n'
        const block = `${needsNewlineBefore ? '\n' : ''}\`\`\`\n${blockContent}\n\`\`\`${needsNewlineAfter ? '\n' : ''}`
        newContent = content.slice(0, start) + block + content.slice(end)
        const contentStart = start + (needsNewlineBefore ? 1 : 0) + 4 // After ```\n
        newCursorStart = contentStart
        newCursorEnd = contentStart + blockContent.length
        break
      }

      case 'insert': {
        newContent = content.slice(0, start) + format.syntax + content.slice(end)
        newCursorStart = start + format.syntax.length
        newCursorEnd = newCursorStart
        break
      }

      case 'link': {
        if (hasSelection) {
          const linkSyntax = `[${selectedText}](url)`
          newContent = content.slice(0, start) + linkSyntax + content.slice(end)
          // Position cursor on "url"
          newCursorStart = start + selectedText.length + 3
          newCursorEnd = start + selectedText.length + 6
        } else {
          const linkSyntax = '[link text](url)'
          newContent = content.slice(0, start) + linkSyntax + content.slice(end)
          // Select "link text"
          newCursorStart = start + 1
          newCursorEnd = start + 10
        }
        break
      }

      default:
        return
    }

    onContentChange(newContent)

    // Restore focus, cursor/selection, and scroll position
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(newCursorStart, newCursorEnd)
      textarea.scrollTop = scrollTop
    })
  }, [textareaRef, content, onContentChange])

  // Prevent focus loss when clicking toolbar buttons
  const handleMouseDown = useCallback((e: React.MouseEvent, formatKey: string) => {
    e.preventDefault() // Prevents textarea from losing focus
    applyFormat(formatKey)
  }, [applyFormat])

  return (
    <div className="markdown-toolbar">
      {/* Headings */}
      <div className="markdown-toolbar-group">
        <button
          type="button"
          onMouseDown={(e) => handleMouseDown(e, 'h1')}
          className="markdown-toolbar-btn markdown-toolbar-btn-heading"
          title="Heading 1"
        >
          H1
        </button>
        <button
          type="button"
          onMouseDown={(e) => handleMouseDown(e, 'h2')}
          className="markdown-toolbar-btn markdown-toolbar-btn-heading"
          title="Heading 2"
        >
          H2
        </button>
        <button
          type="button"
          onMouseDown={(e) => handleMouseDown(e, 'h3')}
          className="markdown-toolbar-btn markdown-toolbar-btn-heading"
          title="Heading 3"
        >
          H3
        </button>
      </div>

      <div className="markdown-toolbar-separator" />

      {/* Text formatting */}
      <div className="markdown-toolbar-group">
        <button
          type="button"
          onMouseDown={(e) => handleMouseDown(e, 'bold')}
          className="markdown-toolbar-btn"
          title="Bold"
        >
          <BoldIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => handleMouseDown(e, 'italic')}
          className="markdown-toolbar-btn"
          title="Italic"
        >
          <ItalicIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => handleMouseDown(e, 'strikethrough')}
          className="markdown-toolbar-btn"
          title="Strikethrough"
        >
          <StrikethroughIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="markdown-toolbar-separator" />

      {/* Code */}
      <div className="markdown-toolbar-group">
        <button
          type="button"
          onMouseDown={(e) => handleMouseDown(e, 'code')}
          className="markdown-toolbar-btn"
          title="Inline code"
        >
          <CodeIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => handleMouseDown(e, 'codeblock')}
          className="markdown-toolbar-btn"
          title="Code block"
        >
          <CodeBlockIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="markdown-toolbar-separator" />

      {/* Structure */}
      <div className="markdown-toolbar-group">
        <button
          type="button"
          onMouseDown={(e) => handleMouseDown(e, 'ul')}
          className="markdown-toolbar-btn"
          title="Bullet list"
        >
          <ListIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => handleMouseDown(e, 'ol')}
          className="markdown-toolbar-btn"
          title="Numbered list"
        >
          <OrderedListIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => handleMouseDown(e, 'quote')}
          className="markdown-toolbar-btn"
          title="Blockquote"
        >
          <QuoteIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => handleMouseDown(e, 'hr')}
          className="markdown-toolbar-btn"
          title="Horizontal rule"
        >
          <HorizontalRuleIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="markdown-toolbar-separator" />

      {/* Link */}
      <div className="markdown-toolbar-group">
        <button
          type="button"
          onMouseDown={(e) => handleMouseDown(e, 'link')}
          className="markdown-toolbar-btn"
          title="Link"
        >
          <LinkIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
