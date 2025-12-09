import { useEffect, useState, type ReactNode } from 'react'
import { renderMarkdown } from '@/lib/markdown'

interface MarkdownRendererProps {
  content: string
  enableLatex?: boolean
  enableSvg?: boolean
  className?: string
}

export function MarkdownRenderer({
  content,
  enableLatex = false,
  enableSvg = true,
  className = '',
}: MarkdownRendererProps) {
  const [rendered, setRendered] = useState<ReactNode>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function render() {
      try {
        const result = await renderMarkdown(content, { enableLatex, enableSvg })
        if (!cancelled) {
          setRendered(result)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render markdown')
        }
      }
    }

    render()

    return () => {
      cancelled = true
    }
  }, [content, enableLatex, enableSvg])

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
        <p className="font-medium">Error rendering content</p>
        <p className="text-sm">{error}</p>
      </div>
    )
  }

  if (!rendered) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
        <div className="h-4 bg-gray-200 rounded w-full mb-4"></div>
        <div className="h-4 bg-gray-200 rounded w-5/6 mb-4"></div>
      </div>
    )
  }

  return <div className={`markdown-body ${className}`}>{rendered}</div>
}
