/**
 * @vitest-environment jsdom
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

// Mock the child components to isolate MarkdownRenderer testing
vi.mock('../ImageLightbox', () => ({
  ImageLightbox: ({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) => (
    <div data-testid="lightbox" data-src={src} data-alt={alt}>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))

vi.mock('../ContentWarningImage', () => ({
  ContentWarningImage: ({ src, alt, labels, onClick, onReveal }: {
    src: string
    alt: string
    labels: string[]
    onClick: () => void
    onReveal: () => void
  }) => (
    <div data-testid="content-warning-image" data-src={src} data-alt={alt} data-labels={labels.join(',')}>
      <button onClick={onClick}>View</button>
      <button onClick={onReveal}>Reveal</button>
    </div>
  ),
}))

vi.mock('../ImageWithAlt', () => ({
  ImageWithAlt: ({ src, alt, onClick }: { src: string; alt: string; onClick: () => void }) => (
    <img
      data-testid="image-with-alt"
      src={src}
      alt={alt}
      onClick={onClick}
    />
  ),
}))

vi.mock('../BlueskyEmbed', () => ({
  BlueskyEmbed: ({ handle, rkey }: { handle: string; rkey: string }) => (
    <div data-testid="bluesky-embed" data-handle={handle} data-rkey={rkey}>
      Bluesky Embed: @{handle}
    </div>
  ),
}))

// Import component after mocking dependencies
import { MarkdownRenderer } from '../MarkdownRenderer'

// Increase timeout for async rendering
const RENDER_TIMEOUT = 5000

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Basic Rendering', () => {
    it('renders plain text content', async () => {
      render(<MarkdownRenderer content="Hello world" />)

      await waitFor(() => {
        expect(screen.getByText('Hello world')).not.toBeNull()
      }, { timeout: RENDER_TIMEOUT })
    })

    it('renders headings', async () => {
      render(<MarkdownRenderer content={'# Heading 1\n\n## Heading 2'} />)

      await waitFor(() => {
        const headings = screen.getAllByRole('heading')
        expect(headings.length).toBeGreaterThanOrEqual(1)
      }, { timeout: RENDER_TIMEOUT })
    })

    it('renders bold and italic text', async () => {
      render(<MarkdownRenderer content="**bold** and *italic* text" />)

      await waitFor(() => {
        const bold = screen.getByText('bold')
        const italic = screen.getByText('italic')
        expect(bold.tagName).toBe('STRONG')
        expect(italic.tagName).toBe('EM')
      }, { timeout: RENDER_TIMEOUT })
    })

    it('renders links', async () => {
      render(<MarkdownRenderer content="[Link text](https://example.com)" />)

      await waitFor(() => {
        const link = screen.getByRole('link', { name: 'Link text' })
        expect(link.getAttribute('href')).toBe('https://example.com')
      }, { timeout: RENDER_TIMEOUT })
    })

    it('renders inline code', async () => {
      render(<MarkdownRenderer content="Use `const x = 1` to declare" />)

      await waitFor(() => {
        const code = screen.getByText('const x = 1')
        expect(code.tagName).toBe('CODE')
      }, { timeout: RENDER_TIMEOUT })
    })

    it('renders code blocks', async () => {
      const { container } = render(<MarkdownRenderer content={'```javascript\nconst x = 1;\n```'} />)

      await waitFor(() => {
        const pre = container.querySelector('pre')
        expect(pre).not.toBeNull()
      }, { timeout: RENDER_TIMEOUT })
    })

    it('renders blockquotes', async () => {
      const { container } = render(<MarkdownRenderer content="> This is a quote" />)

      await waitFor(() => {
        const blockquote = container.querySelector('blockquote')
        expect(blockquote).not.toBeNull()
      }, { timeout: RENDER_TIMEOUT })
    })
  })

  describe('Loading State', () => {
    it('shows loading skeleton initially', () => {
      const { container } = render(<MarkdownRenderer content="# Test" />)

      // Initially shows loading skeleton
      const skeleton = container.querySelector('.animate-pulse')
      expect(skeleton).not.toBeNull()
    })

    it('hides loading skeleton after render', async () => {
      const { container } = render(<MarkdownRenderer content="# Test" />)

      await waitFor(() => {
        const skeleton = container.querySelector('.animate-pulse')
        expect(skeleton).toBeNull()
      }, { timeout: RENDER_TIMEOUT })
    })
  })

  describe('Image Handling', () => {
    it('renders images using ImageWithAlt component', async () => {
      render(
        <MarkdownRenderer content="![Alt text](https://example.com/image.jpg)" />
      )

      await waitFor(() => {
        const img = screen.getByTestId('image-with-alt')
        expect(img.getAttribute('src')).toBe('https://example.com/image.jpg')
        expect(img.getAttribute('alt')).toBe('Alt text')
      }, { timeout: RENDER_TIMEOUT })
    })

    it('opens lightbox on image click', async () => {
      render(
        <MarkdownRenderer content="![Test](https://example.com/test.jpg)" />
      )

      await waitFor(() => {
        expect(screen.getByTestId('image-with-alt')).not.toBeNull()
      }, { timeout: RENDER_TIMEOUT })

      fireEvent.click(screen.getByTestId('image-with-alt'))

      await waitFor(() => {
        expect(screen.getByTestId('lightbox')).not.toBeNull()
      }, { timeout: RENDER_TIMEOUT })
    })

    it('closes lightbox when close button clicked', async () => {
      render(
        <MarkdownRenderer content="![Test](https://example.com/test.jpg)" />
      )

      await waitFor(() => {
        expect(screen.getByTestId('image-with-alt')).not.toBeNull()
      }, { timeout: RENDER_TIMEOUT })

      fireEvent.click(screen.getByTestId('image-with-alt'))

      await waitFor(() => {
        expect(screen.getByTestId('lightbox')).not.toBeNull()
      }, { timeout: RENDER_TIMEOUT })

      fireEvent.click(screen.getByText('Close'))

      await waitFor(() => {
        expect(screen.queryByTestId('lightbox')).toBeNull()
      }, { timeout: RENDER_TIMEOUT })
    })

    it('does not open lightbox when disableLightbox is true', async () => {
      render(
        <MarkdownRenderer
          content="![Test](https://example.com/test.jpg)"
          disableLightbox
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('image-with-alt')).not.toBeNull()
      }, { timeout: RENDER_TIMEOUT })

      fireEvent.click(screen.getByTestId('image-with-alt'))

      // Lightbox should not appear
      expect(screen.queryByTestId('lightbox')).toBeNull()
    })
  })

  describe('TTS Integration', () => {
    it('applies tts-seekable class when onSentenceClick is provided', async () => {
      const onSentenceClick = vi.fn()

      const { container } = render(
        <MarkdownRenderer
          content="Test content"
          onSentenceClick={onSentenceClick}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Test content')).not.toBeNull()
      }, { timeout: RENDER_TIMEOUT })

      const markdownBody = container.querySelector('.markdown-body')
      expect(markdownBody?.classList.contains('tts-seekable')).toBe(true)
    })

    it('calls onSentenceClick when text is clicked', async () => {
      const onSentenceClick = vi.fn()

      render(
        <MarkdownRenderer
          content="Click this paragraph."
          onSentenceClick={onSentenceClick}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Click this paragraph.')).not.toBeNull()
      }, { timeout: RENDER_TIMEOUT })

      fireEvent.click(screen.getByText('Click this paragraph.'))

      expect(onSentenceClick).toHaveBeenCalledWith('Click this paragraph.')
    })
  })

  describe('LaTeX Support', () => {
    it('renders LaTeX when enabled', async () => {
      const { container } = render(
        <MarkdownRenderer
          content="Equation: $E = mc^2$"
          enableLatex
        />
      )

      await waitFor(() => {
        // KaTeX renders content with special classes
        const katex = container.querySelector('.katex')
        expect(katex).not.toBeNull()
      }, { timeout: RENDER_TIMEOUT })
    })

    it('does not render LaTeX when disabled', async () => {
      const { container } = render(
        <MarkdownRenderer
          content="Equation: $E = mc^2$"
          enableLatex={false}
        />
      )

      await waitFor(() => {
        // Should render as plain text, check for dollar sign
        const text = container.textContent
        expect(text).toContain('$E = mc^2$')
      }, { timeout: RENDER_TIMEOUT })

      const katex = container.querySelector('.katex')
      expect(katex).toBeNull()
    })
  })

  describe('SVG Support', () => {
    it('renders SVG code blocks when enabled', async () => {
      const svgContent = '```svg\n<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>\n```'

      const { container } = render(
        <MarkdownRenderer
          content={svgContent}
          enableSvg
        />
      )

      await waitFor(() => {
        const svg = container.querySelector('svg')
        expect(svg).not.toBeNull()
      }, { timeout: RENDER_TIMEOUT })
    })

    it('does not render SVG as graphic when disabled', async () => {
      const svgContent = '```svg\n<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>\n```'

      const { container } = render(
        <MarkdownRenderer
          content={svgContent}
          enableSvg={false}
        />
      )

      await waitFor(() => {
        // Should be in a code block, not rendered as SVG
        const pre = container.querySelector('pre')
        expect(pre).not.toBeNull()
      }, { timeout: RENDER_TIMEOUT })

      // SVG should not be rendered as a graphic element in the main content
      const svgInWrapper = container.querySelector('.svg-wrapper svg')
      expect(svgInWrapper).toBeNull()
    })
  })

  describe('Custom className', () => {
    it('applies custom className', async () => {
      const { container } = render(
        <MarkdownRenderer content="Test" className="custom-class" />
      )

      await waitFor(() => {
        expect(screen.getByText('Test')).not.toBeNull()
      }, { timeout: RENDER_TIMEOUT })

      const markdownBody = container.querySelector('.markdown-body')
      expect(markdownBody?.classList.contains('custom-class')).toBe(true)
    })
  })

  describe('Heading IDs', () => {
    it('generates IDs for headings', async () => {
      const { container } = render(<MarkdownRenderer content="# My Heading" />)

      await waitFor(() => {
        const heading = container.querySelector('h1')
        expect(heading).not.toBeNull()
        expect(heading?.getAttribute('id')).toBe('my-heading')
      }, { timeout: RENDER_TIMEOUT })
    })
  })
})
