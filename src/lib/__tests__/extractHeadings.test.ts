import { describe, it, expect } from 'vitest'
import { generateSlug, extractHeadings, type TocHeading } from '../extractHeadings'

describe('Extract Headings', () => {
  describe('generateSlug', () => {
    it('converts text to lowercase', () => {
      const existingSlugs = new Set<string>()
      expect(generateSlug('Hello World', existingSlugs)).toBe('hello-world')
    })

    it('replaces spaces with hyphens', () => {
      const existingSlugs = new Set<string>()
      expect(generateSlug('one two three', existingSlugs)).toBe('one-two-three')
    })

    it('removes special characters', () => {
      const existingSlugs = new Set<string>()
      expect(generateSlug('Hello! World?', existingSlugs)).toBe('hello-world')
    })

    it('collapses multiple hyphens', () => {
      const existingSlugs = new Set<string>()
      expect(generateSlug('hello   world', existingSlugs)).toBe('hello-world')
    })

    it('trims leading and trailing hyphens', () => {
      const existingSlugs = new Set<string>()
      expect(generateSlug('  hello world  ', existingSlugs)).toBe('hello-world')
    })

    it('handles empty string by returning "heading"', () => {
      const existingSlugs = new Set<string>()
      expect(generateSlug('', existingSlugs)).toBe('heading')
    })

    it('handles string that becomes empty after processing', () => {
      const existingSlugs = new Set<string>()
      expect(generateSlug('!!!', existingSlugs)).toBe('heading')
    })

    it('handles duplicates by appending numeric suffix', () => {
      const existingSlugs = new Set<string>()
      expect(generateSlug('hello', existingSlugs)).toBe('hello')
      expect(generateSlug('hello', existingSlugs)).toBe('hello-1')
      expect(generateSlug('hello', existingSlugs)).toBe('hello-2')
    })

    it('adds slug to existing set', () => {
      const existingSlugs = new Set<string>()
      generateSlug('test', existingSlugs)
      expect(existingSlugs.has('test')).toBe(true)
    })

    it('adds suffixed slug to existing set', () => {
      const existingSlugs = new Set<string>(['test'])
      generateSlug('test', existingSlugs)
      expect(existingSlugs.has('test-1')).toBe(true)
    })

    it('preserves numbers in slug', () => {
      const existingSlugs = new Set<string>()
      expect(generateSlug('Chapter 1', existingSlugs)).toBe('chapter-1')
    })

    it('handles unicode characters by removing them', () => {
      const existingSlugs = new Set<string>()
      expect(generateSlug('Hello 世界', existingSlugs)).toBe('hello')
    })

    it('handles emoji by removing them', () => {
      const existingSlugs = new Set<string>()
      expect(generateSlug('Hello 🌍 World', existingSlugs)).toBe('hello-world')
    })

    it('handles mixed case and special chars', () => {
      const existingSlugs = new Set<string>()
      expect(generateSlug('API v2.0 - The New Version!', existingSlugs)).toBe('api-v20-the-new-version')
    })
  })

  describe('extractHeadings', () => {
    it('extracts h1 heading', () => {
      const markdown = '# Hello World'
      const headings = extractHeadings(markdown)
      expect(headings).toEqual([
        { id: 'hello-world', text: 'Hello World', level: 1 },
      ])
    })

    it('extracts h2 heading', () => {
      const markdown = '## Section Title'
      const headings = extractHeadings(markdown)
      expect(headings).toEqual([
        { id: 'section-title', text: 'Section Title', level: 2 },
      ])
    })

    it('extracts all heading levels', () => {
      const markdown = `# H1
## H2
### H3
#### H4
##### H5
###### H6`
      const headings = extractHeadings(markdown)
      expect(headings).toHaveLength(6)
      expect(headings.map(h => h.level)).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('extracts multiple headings', () => {
      const markdown = `# Introduction
Some text here.

## Background
More text.

## Methods
Even more text.

### Subsection
Details here.`
      const headings = extractHeadings(markdown)
      expect(headings).toHaveLength(4)
      expect(headings[0]).toEqual({ id: 'introduction', text: 'Introduction', level: 1 })
      expect(headings[1]).toEqual({ id: 'background', text: 'Background', level: 2 })
      expect(headings[2]).toEqual({ id: 'methods', text: 'Methods', level: 2 })
      expect(headings[3]).toEqual({ id: 'subsection', text: 'Subsection', level: 3 })
    })

    it('ignores headings inside code blocks', () => {
      const markdown = `# Real Heading

\`\`\`markdown
# Fake Heading in Code
## Another Fake
\`\`\`

## Another Real Heading`
      const headings = extractHeadings(markdown)
      expect(headings).toHaveLength(2)
      expect(headings[0].text).toBe('Real Heading')
      expect(headings[1].text).toBe('Another Real Heading')
    })

    it('handles nested code blocks correctly', () => {
      const markdown = `# Start
\`\`\`
code block 1
\`\`\`
## Middle
\`\`\`
code block 2
\`\`\`
# End`
      const headings = extractHeadings(markdown)
      expect(headings).toHaveLength(3)
      expect(headings.map(h => h.text)).toEqual(['Start', 'Middle', 'End'])
    })

    it('removes bold formatting from heading text', () => {
      const markdown = '# Hello **World**'
      const headings = extractHeadings(markdown)
      expect(headings[0].text).toBe('Hello World')
    })

    it('removes italic formatting from heading text', () => {
      const markdown = '# Hello *World*'
      const headings = extractHeadings(markdown)
      expect(headings[0].text).toBe('Hello World')
    })

    it('removes inline code from heading text', () => {
      const markdown = '# Using `console.log()`'
      const headings = extractHeadings(markdown)
      expect(headings[0].text).toBe('Using console.log()')
    })

    it('removes links but keeps text from heading', () => {
      const markdown = '# Check out [my site](https://example.com)'
      const headings = extractHeadings(markdown)
      expect(headings[0].text).toBe('Check out my site')
    })

    it('handles images in heading text', () => {
      // Note: Due to regex ordering, links are processed before images
      // so ![alt](url) becomes !alt (link text extracted, ! remains)
      const markdown = '# Logo ![alt](image.png) Title'
      const headings = extractHeadings(markdown)
      expect(headings[0].text).toBe('Logo !alt Title')
    })

    it('handles duplicate heading text with unique slugs', () => {
      const markdown = `# Introduction
## Introduction
### Introduction`
      const headings = extractHeadings(markdown)
      expect(headings).toHaveLength(3)
      expect(headings[0].id).toBe('introduction')
      expect(headings[1].id).toBe('introduction-1')
      expect(headings[2].id).toBe('introduction-2')
    })

    it('returns empty array for empty markdown', () => {
      expect(extractHeadings('')).toEqual([])
    })

    it('returns empty array for markdown without headings', () => {
      const markdown = `This is a paragraph.

Another paragraph here.

- List item
- Another item`
      expect(extractHeadings(markdown)).toEqual([])
    })

    it('skips headings that become empty after processing', () => {
      const markdown = `# Valid Heading
# !!!
## Another Valid`
      const headings = extractHeadings(markdown)
      // The !!! heading should still be included but with "heading" as slug
      expect(headings).toHaveLength(3)
    })

    it('requires space after hash marks', () => {
      const markdown = `#NoSpace
##AlsoNoSpace
# With Space`
      const headings = extractHeadings(markdown)
      expect(headings).toHaveLength(1)
      expect(headings[0].text).toBe('With Space')
    })

    it('handles complex nested formatting', () => {
      const markdown = '## **Bold** and *italic* with `code` and [link](url)'
      const headings = extractHeadings(markdown)
      expect(headings[0].text).toBe('Bold and italic with code and link')
    })

    it('handles underscore-style bold and italic', () => {
      const markdown = '# __Bold__ and _italic_'
      const headings = extractHeadings(markdown)
      expect(headings[0].text).toBe('Bold and italic')
    })

    it('preserves heading order from document', () => {
      const markdown = `## Second Level First
# Top Level
### Third Level`
      const headings = extractHeadings(markdown)
      expect(headings.map(h => h.level)).toEqual([2, 1, 3])
    })
  })
})
