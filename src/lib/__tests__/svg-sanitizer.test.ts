/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { sanitizeSvg, wrapSvg } from '../svg-sanitizer'

describe('SVG Sanitizer', () => {
  describe('XSS Prevention', () => {
    it('removes script tags', () => {
      const input = '<svg><script>alert(1)</script><circle r="10"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).not.toContain('script')
      expect(result).toContain('circle')
    })

    it('removes onclick event handlers', () => {
      const input = '<svg onclick="alert(1)"><rect width="10" height="10"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).not.toContain('onclick')
      expect(result).toContain('rect')
    })

    it('removes onload event handlers', () => {
      const input = '<svg onload="alert(1)"><circle r="10"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).not.toContain('onload')
    })

    it('removes onmouseover event handlers', () => {
      const input = '<svg><rect onmouseover="alert(1)" width="10" height="10"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).not.toContain('onmouseover')
    })

    it('removes foreignObject elements', () => {
      const input = '<svg><foreignObject><body><script>alert(1)</script></body></foreignObject></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).not.toContain('foreignObject')
      expect(result).not.toContain('body')
    })

    it('removes javascript: URLs in href', () => {
      const input = '<svg><a href="javascript:alert(1)"><text>Click</text></a></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).not.toContain('javascript:')
    })

    it('removes external URLs in href (only # allowed)', () => {
      const input = '<svg><use href="https://evil.com/malicious.svg#icon"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).not.toContain('https://evil.com')
    })

    it('allows internal fragment references in href', () => {
      const input = '<svg><defs><circle id="myCircle" r="10"/></defs><use href="#myCircle"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).toContain('href="#myCircle"')
    })
  })

  describe('Dangerous Style Patterns', () => {
    it('removes style with url()', () => {
      const input = '<svg><rect style="background: url(https://evil.com/track.gif)" width="10" height="10"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).not.toContain('url(')
    })

    it('removes style with expression()', () => {
      const input = '<svg><rect style="width: expression(alert(1))" width="10" height="10"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).not.toContain('expression')
    })

    it('removes style with javascript:', () => {
      const input = '<svg><rect style="background: javascript:alert(1)" width="10" height="10"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).not.toContain('javascript:')
    })

    it('removes style elements with dangerous CSS', () => {
      const input = '<svg><style>rect { background: url(evil.com) }</style><rect width="10" height="10"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).not.toContain('url(')
    })

    it('allows safe inline styles', () => {
      const input = '<svg><rect style="fill: red; stroke: blue;" width="10" height="10"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).toContain('fill: red')
      expect(result).toContain('stroke: blue')
    })
  })

  describe('Allowed Elements', () => {
    it('allows basic shapes', () => {
      const input = '<svg><circle cx="50" cy="50" r="40"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).toContain('circle')
      expect(result).toContain('cx="50"')
    })

    it('allows rect element', () => {
      const input = '<svg><rect x="10" y="10" width="100" height="50" rx="5"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).toContain('rect')
      expect(result).toContain('width="100"')
    })

    it('allows path element', () => {
      const input = '<svg><path d="M10 10 L90 90"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).toContain('path')
      expect(result).toContain('d="M10 10 L90 90"')
    })

    it('allows text elements', () => {
      const input = '<svg><text x="10" y="20" font-size="16">Hello</text></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).toContain('text')
      expect(result).toContain('Hello')
    })

    it('allows gradients', () => {
      const input = `<svg>
        <defs>
          <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="red"/>
            <stop offset="100%" stop-color="blue"/>
          </linearGradient>
        </defs>
        <rect fill="url(#grad1)" width="100" height="100"/>
      </svg>`
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      // Note: element names are lowercased during sanitization
      expect(result).toContain('lineargradient')
      expect(result).toContain('stop')
    })

    it('allows filter elements', () => {
      const input = `<svg>
        <defs>
          <filter id="blur">
            <feGaussianBlur stdDeviation="5"/>
          </filter>
        </defs>
        <rect filter="url(#blur)" width="100" height="100"/>
      </svg>`
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).toContain('filter')
      // Note: element names are lowercased during sanitization
      expect(result).toContain('fegaussianblur')
    })

    it('allows animation elements', () => {
      const input = `<svg>
        <circle cx="50" cy="50" r="10">
          <animate attributeName="r" from="10" to="20" dur="1s" repeatCount="indefinite"/>
        </circle>
      </svg>`
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).toContain('animate')
    })
  })

  describe('Allowed Attributes', () => {
    it('preserves viewBox attribute', () => {
      const input = '<svg viewBox="0 0 100 100"><circle r="10"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).toContain('viewBox="0 0 100 100"')
    })

    it('preserves transform attribute', () => {
      const input = '<svg><g transform="translate(50,50)"><circle r="10"/></g></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).toContain('transform="translate(50,50)"')
    })

    it('preserves fill and stroke attributes', () => {
      const input = '<svg><circle fill="#ff0000" stroke="#000000" stroke-width="2" r="10"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).toContain('fill="#ff0000"')
      expect(result).toContain('stroke="#000000"')
      expect(result).toContain('stroke-width="2"')
    })

    it('preserves id and class attributes', () => {
      const input = '<svg><circle id="myCircle" class="highlight" r="10"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).toContain('id="myCircle"')
      expect(result).toContain('class="highlight"')
    })

    it('removes unknown attributes', () => {
      const input = '<svg><circle r="10" data-evil="payload" custom-attr="value"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).not.toContain('data-evil')
      expect(result).not.toContain('custom-attr')
    })
  })

  describe('Size Limits', () => {
    it('rejects SVG over 100KB', () => {
      const largeContent = 'x'.repeat(101 * 1024)
      const input = `<svg><text>${largeContent}</text></svg>`
      const result = sanitizeSvg(input)
      expect(result).toBeNull()
    })

    it('accepts SVG under 100KB', () => {
      const input = '<svg><circle r="10"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
    })
  })

  describe('Invalid Input', () => {
    it('returns null for malformed SVG', () => {
      const input = '<svg><circle r="10"'
      const result = sanitizeSvg(input)
      expect(result).toBeNull()
    })

    it('returns null for non-SVG root element', () => {
      const input = '<div><circle r="10"/></div>'
      const result = sanitizeSvg(input)
      expect(result).toBeNull()
    })

    it('returns null for empty string', () => {
      const result = sanitizeSvg('')
      expect(result).toBeNull()
    })
  })

  describe('wrapSvg', () => {
    it('wraps SVG in container div', () => {
      const svg = '<svg><circle r="10"/></svg>'
      const result = wrapSvg(svg)
      expect(result).toBe('<div class="svg-container"><svg><circle r="10"/></svg></div>')
    })
  })
})
