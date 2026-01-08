import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import rehypeParse from 'rehype-parse'
import rehypeStringify from 'rehype-stringify'
import { rehypeHeadingIds } from '../rehype-heading-ids'

describe('rehypeHeadingIds', () => {
  async function processHtml(html: string): Promise<string> {
    const result = await unified()
      .use(rehypeParse, { fragment: true })
      .use(rehypeHeadingIds)
      .use(rehypeStringify)
      .process(html)

    return String(result)
  }

  describe('Basic ID Generation', () => {
    it('adds id to h1 element', async () => {
      const html = '<h1>Hello World</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="hello-world"')
    })

    it('adds id to h2 element', async () => {
      const html = '<h2>Getting Started</h2>'
      const result = await processHtml(html)
      expect(result).toContain('id="getting-started"')
    })

    it('adds id to h3 element', async () => {
      const html = '<h3>Installation Guide</h3>'
      const result = await processHtml(html)
      expect(result).toContain('id="installation-guide"')
    })

    it('adds id to h4 element', async () => {
      const html = '<h4>Advanced Options</h4>'
      const result = await processHtml(html)
      expect(result).toContain('id="advanced-options"')
    })

    it('adds id to h5 element', async () => {
      const html = '<h5>Configuration Details</h5>'
      const result = await processHtml(html)
      expect(result).toContain('id="configuration-details"')
    })

    it('adds id to h6 element', async () => {
      const html = '<h6>Minor Heading</h6>'
      const result = await processHtml(html)
      expect(result).toContain('id="minor-heading"')
    })
  })

  describe('Slug Generation', () => {
    it('converts to lowercase', async () => {
      const html = '<h1>UPPERCASE TITLE</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="uppercase-title"')
    })

    it('replaces spaces with hyphens', async () => {
      const html = '<h1>Multiple Words Here</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="multiple-words-here"')
    })

    it('removes special characters', async () => {
      const html = '<h1>What is TypeScript?</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="what-is-typescript"')
    })

    it('handles numbers', async () => {
      const html = '<h1>Chapter 1: Introduction</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="chapter-1-introduction"')
    })

    it('handles multiple consecutive spaces', async () => {
      const html = '<h1>Word    Another</h1>'
      const result = await processHtml(html)
      // Should collapse to single hyphen
      expect(result).toMatch(/id="word-+another"/)
    })

    it('handles leading/trailing whitespace in text', async () => {
      const html = '<h1>  Trimmed Title  </h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="trimmed-title"')
    })

    it('handles apostrophes', async () => {
      const html = "<h1>What's New</h1>"
      const result = await processHtml(html)
      expect(result).toContain('id="whats-new"')
    })

    it('handles ampersands', async () => {
      const html = '<h1>Tips &amp; Tricks</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="tips-tricks"')
    })

    it('handles parentheses', async () => {
      const html = '<h1>Function (deprecated)</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="function-deprecated"')
    })

    it('handles colons', async () => {
      const html = '<h1>Section: Details</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="section-details"')
    })
  })

  describe('Text Extraction', () => {
    it('extracts text from simple heading', async () => {
      const html = '<h1>Simple Text</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="simple-text"')
    })

    it('extracts text from heading with inline code', async () => {
      const html = '<h1>Using <code>console.log</code></h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="using-consolelog"')
    })

    it('extracts text from heading with strong/bold', async () => {
      const html = '<h1>This is <strong>Important</strong></h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="this-is-important"')
    })

    it('extracts text from heading with em/italic', async () => {
      const html = '<h1>Read <em>carefully</em></h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="read-carefully"')
    })

    it('extracts text from heading with link', async () => {
      const html = '<h1>Visit <a href="#">Our Site</a></h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="visit-our-site"')
    })

    it('extracts text from deeply nested elements', async () => {
      const html = '<h1><span><strong><em>Nested</em></strong></span> Text</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="nested-text"')
    })

    it('extracts text from multiple text nodes', async () => {
      const html = '<h1>Part <span>One</span> and <span>Two</span></h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="part-one-and-two"')
    })
  })

  describe('Existing IDs', () => {
    it('preserves existing id attribute', async () => {
      const html = '<h1 id="custom-id">Custom Heading</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="custom-id"')
      expect(result).not.toContain('id="custom-heading"')
    })

    it('tracks existing ids for duplicate prevention', async () => {
      const html = '<h1 id="intro">First</h1><h2>Intro</h2>'
      const result = await processHtml(html)
      // The h2 should get a different slug since "intro" is taken
      expect(result).toContain('id="intro"')
      // Should have a suffix to avoid collision
      expect(result).toMatch(/id="intro-\d+"/)
    })

    it('does not modify headings with existing ids', async () => {
      const html = '<h1 id="my-id" class="special">Heading</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="my-id"')
      expect(result).toContain('class="special"')
    })
  })

  describe('Duplicate Handling', () => {
    it('adds suffix for duplicate headings', async () => {
      const html = '<h1>Introduction</h1><h2>Introduction</h2>'
      const result = await processHtml(html)
      expect(result).toContain('id="introduction"')
      expect(result).toMatch(/id="introduction-\d+"/)
    })

    it('handles multiple duplicates', async () => {
      const html = '<h1>Section</h1><h2>Section</h2><h3>Section</h3>'
      const result = await processHtml(html)
      // Should have introduction, introduction-1, introduction-2 or similar
      const matches = result.match(/id="section[^"]*"/g)
      expect(matches).toHaveLength(3)
      // All should be unique
      const uniqueMatches = new Set(matches)
      expect(uniqueMatches.size).toBe(3)
    })

    it('handles duplicates with different cases', async () => {
      const html = '<h1>Test</h1><h2>TEST</h2><h3>test</h3>'
      const result = await processHtml(html)
      // All should generate "test" slug, so should have suffixes
      const matches = result.match(/id="test[^"]*"/g)
      expect(matches).toHaveLength(3)
      const uniqueMatches = new Set(matches)
      expect(uniqueMatches.size).toBe(3)
    })
  })

  describe('Non-Heading Elements', () => {
    it('ignores paragraph elements', async () => {
      const html = '<p>Not a heading</p>'
      const result = await processHtml(html)
      expect(result).not.toContain('id=')
    })

    it('ignores div elements', async () => {
      const html = '<div>Container</div>'
      const result = await processHtml(html)
      expect(result).not.toContain('id=')
    })

    it('ignores span elements', async () => {
      const html = '<span>Inline text</span>'
      const result = await processHtml(html)
      expect(result).not.toContain('id=')
    })

    it('processes only headings in mixed content', async () => {
      const html = '<p>Intro</p><h1>Title</h1><p>Body</p><h2>Subtitle</h2>'
      const result = await processHtml(html)
      expect(result).toContain('id="title"')
      expect(result).toContain('id="subtitle"')
      // Only 2 ids for the 2 headings
      const matches = result.match(/id="/g)
      expect(matches).toHaveLength(2)
    })
  })

  describe('Empty Content', () => {
    it('skips heading with empty text', async () => {
      const html = '<h1></h1>'
      const result = await processHtml(html)
      expect(result).not.toContain('id=')
    })

    it('skips heading with only whitespace', async () => {
      const html = '<h1>   </h1>'
      const result = await processHtml(html)
      expect(result).not.toContain('id=')
    })

    it('skips heading with only empty children', async () => {
      const html = '<h1><span></span></h1>'
      const result = await processHtml(html)
      expect(result).not.toContain('id=')
    })
  })

  describe('Complex Documents', () => {
    it('processes a realistic document structure', async () => {
      const html = `
        <article>
          <h1>Blog Post Title</h1>
          <p>Introduction paragraph.</p>
          <h2>First Section</h2>
          <p>Section content.</p>
          <h3>Subsection A</h3>
          <p>More content.</p>
          <h3>Subsection B</h3>
          <p>Even more content.</p>
          <h2>Second Section</h2>
          <h3>Another Subsection</h3>
        </article>
      `
      const result = await processHtml(html)

      expect(result).toContain('id="blog-post-title"')
      expect(result).toContain('id="first-section"')
      expect(result).toContain('id="subsection-a"')
      expect(result).toContain('id="subsection-b"')
      expect(result).toContain('id="second-section"')
      expect(result).toContain('id="another-subsection"')
    })

    it('handles nested structures correctly', async () => {
      const html = `
        <div>
          <section>
            <h1>Main Title</h1>
            <div>
              <h2>Nested Heading</h2>
            </div>
          </section>
        </div>
      `
      const result = await processHtml(html)
      expect(result).toContain('id="main-title"')
      expect(result).toContain('id="nested-heading"')
    })

    it('preserves other attributes on headings', async () => {
      const html = '<h1 class="title" data-level="1">My Heading</h1>'
      const result = await processHtml(html)
      expect(result).toContain('class="title"')
      expect(result).toContain('data-level="1"')
      expect(result).toContain('id="my-heading"')
    })
  })

  describe('Special Characters and Unicode', () => {
    it('handles emoji in headings', async () => {
      const html = '<h1>Hello 👋 World</h1>'
      const result = await processHtml(html)
      // Should generate a valid id (emoji handling depends on generateSlug)
      expect(result).toMatch(/id="[^"]+"/);
    })

    it('handles accented characters', async () => {
      const html = '<h1>Café Culture</h1>'
      const result = await processHtml(html)
      expect(result).toMatch(/id="[^"]+"/);
    })

    it('handles quotes in headings', async () => {
      const html = '<h1>The "Best" Guide</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="the-best-guide"')
    })

    it('handles backticks', async () => {
      const html = '<h1>Using `code` Blocks</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="using-code-blocks"')
    })

    it('handles forward slashes', async () => {
      const html = '<h1>Client/Server Architecture</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="clientserver-architecture"')
    })

    it('handles hyphens in text', async () => {
      const html = '<h1>Real-Time Updates</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="real-time-updates"')
    })

    it('handles underscores', async () => {
      const html = '<h1>snake_case_naming</h1>'
      const result = await processHtml(html)
      // Underscores should be preserved or converted consistently
      expect(result).toMatch(/id="[^"]+"/);
    })
  })

  describe('Plugin Integration', () => {
    it('works as a unified plugin', async () => {
      const processor = unified()
        .use(rehypeParse, { fragment: true })
        .use(rehypeHeadingIds)
        .use(rehypeStringify)

      const result = await processor.process('<h1>Test</h1>')
      expect(String(result)).toContain('id="test"')
    })

    it('can be chained with other plugins', async () => {
      // Just verify it doesn't break the chain
      const processor = unified()
        .use(rehypeParse, { fragment: true })
        .use(rehypeHeadingIds)
        .use(rehypeStringify)

      const input = '<h1>Heading</h1><p>Paragraph</p>'
      const result = await processor.process(input)
      const output = String(result)

      expect(output).toContain('<h1')
      expect(output).toContain('<p>')
      expect(output).toContain('id="heading"')
    })

    it('processes synchronously within the tree', async () => {
      const html = '<h1>First</h1><h1>Second</h1>'
      const result = await processHtml(html)

      expect(result).toContain('id="first"')
      expect(result).toContain('id="second"')
    })
  })

  describe('Edge Cases', () => {
    it('handles heading at start of document', async () => {
      const html = '<h1>Start</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="start"')
    })

    it('handles heading at end of document', async () => {
      const html = '<p>Content</p><h1>End</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="end"')
    })

    it('handles single character heading', async () => {
      const html = '<h1>A</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="a"')
    })

    it('handles very long heading text', async () => {
      const longText = 'This is a very long heading that might cause issues ' +
        'if not handled properly because it contains many words'
      const html = `<h1>${longText}</h1>`
      const result = await processHtml(html)
      expect(result).toMatch(/id="[^"]+"/);
    })

    it('handles heading with only numbers', async () => {
      const html = '<h1>2024</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="2024"')
    })

    it('handles heading with mixed content types', async () => {
      const html = '<h1>Text <code>code</code> more <em>italic</em> end</h1>'
      const result = await processHtml(html)
      expect(result).toContain('id="text-code-more-italic-end"')
    })
  })
})
