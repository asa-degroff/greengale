import type { TocHeading } from '@/lib/extractHeadings'

interface TableOfContentsProps {
  headings: TocHeading[]
  activeId: string | null
  className?: string
  onNavigate?: () => void
}

export function TableOfContents({
  headings,
  activeId,
  className = '',
  onNavigate,
}: TableOfContentsProps) {
  if (headings.length === 0) {
    return null
  }

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault()
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' })
      // Update URL hash without adding to history - back button goes to previous page
      history.replaceState(null, '', `#${id}`)
      onNavigate?.()
    }
  }

  return (
    <nav aria-label="Table of contents" className={`toc ${className}`}>
      <h2 className="toc-title">Contents</h2>
      <ul className="toc-list">
        {headings.map((heading) => (
          <li
            key={heading.id}
            className={`toc-item toc-item--level-${heading.level}`}
          >
            <a
              href={`#${heading.id}`}
              onClick={(e) => handleClick(e, heading.id)}
              className={`toc-link ${activeId === heading.id ? 'active' : ''}`}
              aria-current={activeId === heading.id ? 'true' : undefined}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
