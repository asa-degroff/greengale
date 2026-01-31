import { describe, it, expect } from 'vitest'
import { extractLeafletContent, isLeafletContent } from '../leaflet-parser'

describe('leaflet-parser', () => {
  describe('extractLeafletContent', () => {
    it('extracts text from simple blocks', () => {
      const content = {
        $type: 'pub.leaflet.content',
        pages: [{
          $type: 'pub.leaflet.pages.linearDocument',
          blocks: [
            { $type: 'pub.leaflet.pages.linearDocument#block', block: { $type: 'pub.leaflet.blocks.text', plaintext: 'Hello world' } },
            { $type: 'pub.leaflet.pages.linearDocument#block', block: { $type: 'pub.leaflet.blocks.text', plaintext: 'Second paragraph' } },
          ]
        }]
      }
      expect(extractLeafletContent(content)).toBe('Hello world\n\nSecond paragraph')
    })

    it('extracts text from blockquotes', () => {
      const content = {
        $type: 'pub.leaflet.content',
        pages: [{
          blocks: [
            { block: { $type: 'pub.leaflet.blocks.blockquote', plaintext: 'A quote' } },
          ]
        }]
      }
      expect(extractLeafletContent(content)).toBe('A quote')
    })

    it('extracts text from unordered list items', () => {
      const content = {
        $type: 'pub.leaflet.content',
        pages: [{
          blocks: [{
            block: {
              $type: 'pub.leaflet.blocks.unorderedList',
              children: [
                { $type: 'pub.leaflet.blocks.unorderedList#listItem', content: { plaintext: 'Item 1' }, children: [] },
                { $type: 'pub.leaflet.blocks.unorderedList#listItem', content: { plaintext: 'Item 2' }, children: [] },
              ]
            }
          }]
        }]
      }
      expect(extractLeafletContent(content)).toBe('Item 1\n\nItem 2')
    })

    it('extracts text from ordered list items', () => {
      const content = {
        $type: 'pub.leaflet.content',
        pages: [{
          blocks: [{
            block: {
              $type: 'pub.leaflet.blocks.orderedList',
              children: [
                { content: { plaintext: 'First' }, children: [] },
                { content: { plaintext: 'Second' }, children: [] },
                { content: { plaintext: 'Third' }, children: [] },
              ]
            }
          }]
        }]
      }
      expect(extractLeafletContent(content)).toBe('First\n\nSecond\n\nThird')
    })

    it('handles nested lists', () => {
      const content = {
        $type: 'pub.leaflet.content',
        pages: [{
          blocks: [{
            block: {
              $type: 'pub.leaflet.blocks.unorderedList',
              children: [
                {
                  content: { plaintext: 'Parent' },
                  children: [
                    { content: { plaintext: 'Child 1' }, children: [] },
                    { content: { plaintext: 'Child 2' }, children: [] },
                  ]
                },
              ]
            }
          }]
        }]
      }
      expect(extractLeafletContent(content)).toBe('Parent\n\nChild 1\n\nChild 2')
    })

    it('handles deeply nested lists', () => {
      const content = {
        $type: 'pub.leaflet.content',
        pages: [{
          blocks: [{
            block: {
              $type: 'pub.leaflet.blocks.unorderedList',
              children: [
                {
                  content: { plaintext: 'Level 1' },
                  children: [
                    {
                      content: { plaintext: 'Level 2' },
                      children: [
                        { content: { plaintext: 'Level 3' }, children: [] }
                      ]
                    }
                  ]
                },
              ]
            }
          }]
        }]
      }
      expect(extractLeafletContent(content)).toBe('Level 1\n\nLevel 2\n\nLevel 3')
    })

    it('skips empty text blocks', () => {
      const content = {
        $type: 'pub.leaflet.content',
        pages: [{
          blocks: [
            { block: { $type: 'pub.leaflet.blocks.text', plaintext: 'Content' } },
            { block: { $type: 'pub.leaflet.blocks.text', plaintext: '' } },
            { block: { $type: 'pub.leaflet.blocks.text', plaintext: '   ' } },
            { block: { $type: 'pub.leaflet.blocks.text', plaintext: 'More content' } },
          ]
        }]
      }
      expect(extractLeafletContent(content)).toBe('Content\n\nMore content')
    })

    it('skips image blocks', () => {
      const content = {
        $type: 'pub.leaflet.content',
        pages: [{
          blocks: [
            { block: { $type: 'pub.leaflet.blocks.text', plaintext: 'Before image' } },
            { block: { $type: 'pub.leaflet.blocks.image', image: { ref: { $link: 'bafkreiabc' } } } },
            { block: { $type: 'pub.leaflet.blocks.text', plaintext: 'After image' } },
          ]
        }]
      }
      expect(extractLeafletContent(content)).toBe('Before image\n\nAfter image')
    })

    it('skips horizontal rule blocks', () => {
      const content = {
        $type: 'pub.leaflet.content',
        pages: [{
          blocks: [
            { block: { $type: 'pub.leaflet.blocks.text', plaintext: 'Section 1' } },
            { block: { $type: 'pub.leaflet.blocks.horizontalRule' } },
            { block: { $type: 'pub.leaflet.blocks.text', plaintext: 'Section 2' } },
          ]
        }]
      }
      expect(extractLeafletContent(content)).toBe('Section 1\n\nSection 2')
    })

    it('handles multiple pages', () => {
      const content = {
        $type: 'pub.leaflet.content',
        pages: [
          {
            blocks: [
              { block: { $type: 'pub.leaflet.blocks.text', plaintext: 'Page 1 content' } },
            ]
          },
          {
            blocks: [
              { block: { $type: 'pub.leaflet.blocks.text', plaintext: 'Page 2 content' } },
            ]
          }
        ]
      }
      expect(extractLeafletContent(content)).toBe('Page 1 content\n\nPage 2 content')
    })

    it('handles mixed block types', () => {
      const content = {
        $type: 'pub.leaflet.content',
        pages: [{
          blocks: [
            { block: { $type: 'pub.leaflet.blocks.text', plaintext: 'Intro text' } },
            { block: { $type: 'pub.leaflet.blocks.blockquote', plaintext: 'A quote' } },
            { block: {
              $type: 'pub.leaflet.blocks.unorderedList',
              children: [
                { content: { plaintext: 'List item' }, children: [] },
              ]
            }},
            { block: { $type: 'pub.leaflet.blocks.text', plaintext: 'Conclusion' } },
          ]
        }]
      }
      expect(extractLeafletContent(content)).toBe('Intro text\n\nA quote\n\nList item\n\nConclusion')
    })

    it('returns empty string for null content', () => {
      expect(extractLeafletContent(null)).toBe('')
    })

    it('returns empty string for undefined content', () => {
      expect(extractLeafletContent(undefined)).toBe('')
    })

    it('returns empty string for empty object', () => {
      expect(extractLeafletContent({})).toBe('')
    })

    it('returns empty string when pages is null', () => {
      expect(extractLeafletContent({ pages: null })).toBe('')
    })

    it('returns empty string when pages is empty array', () => {
      expect(extractLeafletContent({ pages: [] })).toBe('')
    })

    it('handles pages with no blocks', () => {
      expect(extractLeafletContent({ pages: [{}] })).toBe('')
      expect(extractLeafletContent({ pages: [{ blocks: null }] })).toBe('')
      expect(extractLeafletContent({ pages: [{ blocks: [] }] })).toBe('')
    })

    it('handles blocks with no block property', () => {
      const content = {
        pages: [{
          blocks: [
            { $type: 'pub.leaflet.pages.linearDocument#block' },
            { block: { $type: 'pub.leaflet.blocks.text', plaintext: 'Valid' } },
          ]
        }]
      }
      expect(extractLeafletContent(content)).toBe('Valid')
    })

    it('handles list items with no content', () => {
      const content = {
        pages: [{
          blocks: [{
            block: {
              $type: 'pub.leaflet.blocks.unorderedList',
              children: [
                { children: [] },
                { content: { plaintext: 'Has content' }, children: [] },
                { content: {}, children: [] },
              ]
            }
          }]
        }]
      }
      expect(extractLeafletContent(content)).toBe('Has content')
    })

    it('extracts content from real Leaflet document structure', () => {
      // This is a simplified version of a real Leaflet document
      const content = {
        $type: 'pub.leaflet.content',
        pages: [{
          $type: 'pub.leaflet.pages.linearDocument',
          blocks: [
            {
              $type: 'pub.leaflet.pages.linearDocument#block',
              block: {
                $type: 'pub.leaflet.blocks.text',
                facets: [],
                plaintext: 'Physics engines compute the next states of modeled objects using "ticks" of processing.'
              }
            },
            {
              $type: 'pub.leaflet.pages.linearDocument#block',
              block: {
                $type: 'pub.leaflet.blocks.text',
                facets: [],
                plaintext: ''
              }
            },
            {
              $type: 'pub.leaflet.pages.linearDocument#block',
              block: {
                $type: 'pub.leaflet.blocks.text',
                plaintext: 'The availability of processing time for running a tick is variable.'
              }
            },
            {
              $type: 'pub.leaflet.pages.linearDocument#block',
              block: {
                $type: 'pub.leaflet.blocks.blockquote',
                plaintext: 'Example: an object with a velocity of 5 meters per second.'
              }
            },
            {
              $type: 'pub.leaflet.pages.linearDocument#block',
              block: {
                $type: 'pub.leaflet.blocks.horizontalRule'
              }
            },
            {
              $type: 'pub.leaflet.pages.linearDocument#block',
              block: {
                $type: 'pub.leaflet.blocks.unorderedList',
                children: [
                  {
                    $type: 'pub.leaflet.blocks.unorderedList#listItem',
                    content: {
                      $type: 'pub.leaflet.blocks.text',
                      plaintext: 'Each object is assigned an independent process,'
                    },
                    children: []
                  },
                  {
                    $type: 'pub.leaflet.blocks.unorderedList#listItem',
                    content: {
                      $type: 'pub.leaflet.blocks.text',
                      plaintext: 'There is no global clock.'
                    },
                    children: []
                  }
                ]
              }
            }
          ]
        }]
      }

      const result = extractLeafletContent(content)
      expect(result).toContain('Physics engines compute')
      expect(result).toContain('The availability of processing time')
      expect(result).toContain('Example: an object with a velocity')
      expect(result).toContain('Each object is assigned')
      expect(result).toContain('There is no global clock')
      expect(result).not.toContain('horizontalRule')
    })
  })

  describe('isLeafletContent', () => {
    it('returns true for Leaflet content', () => {
      expect(isLeafletContent({ $type: 'pub.leaflet.content' })).toBe(true)
    })

    it('returns true for Leaflet content with pages', () => {
      expect(isLeafletContent({ $type: 'pub.leaflet.content', pages: [] })).toBe(true)
    })

    it('returns false for non-Leaflet content type', () => {
      expect(isLeafletContent({ $type: 'other.type' })).toBe(false)
      expect(isLeafletContent({ $type: 'app.greengale.document#contentRef' })).toBe(false)
    })

    it('returns false for null', () => {
      expect(isLeafletContent(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isLeafletContent(undefined)).toBe(false)
    })

    it('returns false for string', () => {
      expect(isLeafletContent('string content')).toBe(false)
    })

    it('returns false for number', () => {
      expect(isLeafletContent(123)).toBe(false)
    })

    it('returns false for object without $type', () => {
      expect(isLeafletContent({})).toBe(false)
      expect(isLeafletContent({ pages: [] })).toBe(false)
    })
  })
})
