/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { sanitizeSvg, wrapSvg, resetSvgCounter } from '../svg-sanitizer'

describe('SVG Sanitizer', () => {
  // Reset counter before each test for predictable prefixes
  beforeEach(() => {
    resetSvgCounter()
  })

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
      // IDs are namespaced with svg1_ prefix, href references are updated to match
      expect(result).toContain('id="svg1_myCircle"')
      expect(result).toContain('href="#svg1_myCircle"')
    })
  })

  describe('Dangerous Style Patterns', () => {
    it('removes style with external url()', () => {
      const input = '<svg><rect style="background: url(https://evil.com/track.gif)" width="10" height="10"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).not.toContain('url(https://evil.com')
    })

    it('allows style with internal url(#id) reference', () => {
      const input = '<svg><defs><filter id="glow"><feGaussianBlur stdDeviation="2"/></filter></defs><rect style="filter: url(#glow)" width="10" height="10"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      // ID and url() reference are namespaced
      expect(result).toContain('id="svg1_glow"')
      expect(result).toContain('url(#svg1_glow)')
    })

    it('allows style element with internal url(#id) references', () => {
      const input = '<svg><defs><filter id="blur"><feGaussianBlur stdDeviation="2"/></filter></defs><style>.edge { filter: url(#blur); }</style><rect class="edge" width="10" height="10"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      // IDs, classes, and url() references are all namespaced
      expect(result).toContain('id="svg1_blur"')
      expect(result).toContain('url(#svg1_blur)')
      expect(result).toContain('.svg1_edge')
      expect(result).toContain('class="svg1_edge"')
    })

    it('allows quoted internal url references', () => {
      const input = `<svg><defs><filter id="glow"><feGaussianBlur stdDeviation="2"/></filter></defs><style>.edge { filter: url('#glow'); }</style><rect class="edge" width="10" height="10"/></svg>`
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      // Quoted url() references are also namespaced
      expect(result).toContain(`url('#svg1_glow')`)
    })

    it('allows double-quoted internal url references', () => {
      const input = `<svg><defs><filter id="glow"><feGaussianBlur stdDeviation="2"/></filter></defs><rect style='filter: url("#glow")' width="10" height="10"/></svg>`
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      // XML serializer encodes quotes as &quot;, IDs are namespaced
      expect(result).toContain('url(&quot;#svg1_glow&quot;)')
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

    it('removes style elements with external url() in CSS', () => {
      const input = '<svg><style>rect { background: url(evil.com) }</style><rect width="10" height="10"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      expect(result).not.toContain('url(evil.com)')
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
      // SVG element names preserve proper casing (e.g., linearGradient, not lineargradient)
      expect(result).toContain('linearGradient')
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
      // SVG element names preserve proper casing (e.g., feGaussianBlur, not fegaussianblur)
      expect(result).toContain('feGaussianBlur')
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

    it('preserves id and class attributes (namespaced)', () => {
      const input = '<svg><circle id="myCircle" class="highlight" r="10"/></svg>'
      const result = sanitizeSvg(input)
      expect(result).not.toBeNull()
      // IDs and classes are namespaced with svg1_ prefix
      expect(result).toContain('id="svg1_myCircle"')
      expect(result).toContain('class="svg1_highlight"')
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

  describe('Namespacing', () => {
    it('namespaces multiple SVGs with different prefixes', () => {
      const svg1 = '<svg><defs><filter id="glow"/></defs><rect class="edge" filter="url(#glow)"/></svg>'
      const svg2 = '<svg><defs><filter id="glow"/></defs><rect class="edge" filter="url(#glow)"/></svg>'

      const result1 = sanitizeSvg(svg1)
      const result2 = sanitizeSvg(svg2)

      expect(result1).not.toBeNull()
      expect(result2).not.toBeNull()

      // First SVG gets svg1_ prefix
      expect(result1).toContain('id="svg1_glow"')
      expect(result1).toContain('class="svg1_edge"')
      expect(result1).toContain('filter="url(#svg1_glow)"')

      // Second SVG gets svg2_ prefix
      expect(result2).toContain('id="svg2_glow"')
      expect(result2).toContain('class="svg2_edge"')
      expect(result2).toContain('filter="url(#svg2_glow)"')
    })

    it('namespaces CSS selectors in style elements', () => {
      const input = '<svg><style>.foo { fill: red; } .bar { stroke: blue; }</style><rect class="foo bar"/></svg>'
      const result = sanitizeSvg(input)

      expect(result).not.toBeNull()
      expect(result).toContain('.svg1_foo')
      expect(result).toContain('.svg1_bar')
      expect(result).toContain('class="svg1_foo svg1_bar"')
    })

    it('namespaces gradient references in fill/stroke attributes', () => {
      const input = `<svg>
        <defs>
          <linearGradient id="grad1"/>
        </defs>
        <rect fill="url(#grad1)"/>
      </svg>`
      const result = sanitizeSvg(input)

      expect(result).not.toBeNull()
      expect(result).toContain('id="svg1_grad1"')
      expect(result).toContain('fill="url(#svg1_grad1)"')
    })

    it('namespaces clip-path and mask references', () => {
      const input = `<svg>
        <defs>
          <clipPath id="myClip"><rect/></clipPath>
          <mask id="myMask"><rect/></mask>
        </defs>
        <rect clip-path="url(#myClip)" mask="url(#myMask)"/>
      </svg>`
      const result = sanitizeSvg(input)

      expect(result).not.toBeNull()
      expect(result).toContain('id="svg1_myClip"')
      expect(result).toContain('id="svg1_myMask"')
      expect(result).toContain('clip-path="url(#svg1_myClip)"')
      expect(result).toContain('mask="url(#svg1_myMask)"')
    })

    it('handles url() with various quote styles in CSS', () => {
      const input = `<svg>
        <defs><filter id="f1"/><filter id="f2"/><filter id="f3"/></defs>
        <style>
          .a { filter: url(#f1); }
          .b { filter: url('#f2'); }
          .c { filter: url("#f3"); }
        </style>
        <rect class="a b c"/>
      </svg>`
      const result = sanitizeSvg(input)

      expect(result).not.toBeNull()
      expect(result).toContain('url(#svg1_f1)')
      expect(result).toContain(`url('#svg1_f2')`)
      expect(result).toContain(`url("#svg1_f3")`)
    })

    it('namespaces xlink:href references in use elements', () => {
      const input = `<svg xmlns:xlink="http://www.w3.org/1999/xlink">
        <defs>
          <path id="myPath" d="M10,10 L100,100"/>
        </defs>
        <use xlink:href="#myPath"/>
      </svg>`
      const result = sanitizeSvg(input)

      expect(result).not.toBeNull()
      expect(result).toContain('id="svg1_myPath"')
      // The serializer may use different prefixes (xlink:href, ns1:href, etc.)
      // but the important thing is the reference is updated
      expect(result).toMatch(/:href="#svg1_myPath"/)
      expect(result).toContain('http://www.w3.org/1999/xlink')
    })

    it('handles multiple use elements with xlink:href', () => {
      const input = `<svg xmlns:xlink="http://www.w3.org/1999/xlink">
        <defs>
          <rect id="box" width="10" height="10"/>
          <circle id="dot" r="5"/>
        </defs>
        <use xlink:href="#box" x="0"/>
        <use xlink:href="#box" x="20"/>
        <use xlink:href="#dot" x="40"/>
      </svg>`
      const result = sanitizeSvg(input)

      expect(result).not.toBeNull()
      expect(result).toContain('id="svg1_box"')
      expect(result).toContain('id="svg1_dot"')
      // All references should be updated (serializer may use different prefixes)
      const boxRefs = (result!.match(/:href="#svg1_box"/g) || []).length
      expect(boxRefs).toBe(2)
      expect(result).toMatch(/:href="#svg1_dot"/)
    })
  })
})
