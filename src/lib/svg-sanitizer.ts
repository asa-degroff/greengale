/**
 * SVG Sanitizer
 *
 * Sanitizes SVG content to prevent XSS attacks while preserving
 * legitimate SVG functionality for diagrams and illustrations.
 */

// Allowed SVG elements (no scripts, no foreignObject, no handlers)
const ALLOWED_ELEMENTS = new Set([
  // Structure
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  // Shapes
  'circle',
  'ellipse',
  'line',
  'path',
  'polygon',
  'polyline',
  'rect',
  // Text
  'text',
  'tspan',
  'textPath',
  // Gradients and patterns
  'linearGradient',
  'radialGradient',
  'stop',
  'pattern',
  // Clipping and masking
  'clipPath',
  'mask',
  // Markers
  'marker',
  // Filters (basic)
  'filter',
  'feGaussianBlur',
  'feOffset',
  'feMerge',
  'feMergeNode',
  'feBlend',
  'feColorMatrix',
  'feFlood',
  'feComposite',
])

// Allowed attributes per element (and global)
const GLOBAL_ATTRIBUTES = new Set([
  'id',
  'class',
  'style',
  'transform',
  'opacity',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'clip-path',
  'clip-rule',
  'mask',
  'filter',
  'visibility',
  'display',
])

const ELEMENT_ATTRIBUTES: Record<string, Set<string>> = {
  svg: new Set([
    'xmlns',
    'viewBox',
    'width',
    'height',
    'preserveAspectRatio',
    'x',
    'y',
  ]),
  circle: new Set(['cx', 'cy', 'r']),
  ellipse: new Set(['cx', 'cy', 'rx', 'ry']),
  line: new Set(['x1', 'y1', 'x2', 'y2']),
  path: new Set(['d']),
  polygon: new Set(['points']),
  polyline: new Set(['points']),
  rect: new Set(['x', 'y', 'width', 'height', 'rx', 'ry']),
  text: new Set([
    'x',
    'y',
    'dx',
    'dy',
    'text-anchor',
    'dominant-baseline',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'letter-spacing',
  ]),
  tspan: new Set([
    'x',
    'y',
    'dx',
    'dy',
    'text-anchor',
    'dominant-baseline',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
  ]),
  textPath: new Set(['href', 'startOffset', 'method', 'spacing']),
  use: new Set(['href', 'x', 'y', 'width', 'height']),
  symbol: new Set(['viewBox', 'preserveAspectRatio']),
  linearGradient: new Set([
    'x1',
    'y1',
    'x2',
    'y2',
    'gradientUnits',
    'gradientTransform',
    'spreadMethod',
    'href',
  ]),
  radialGradient: new Set([
    'cx',
    'cy',
    'r',
    'fx',
    'fy',
    'gradientUnits',
    'gradientTransform',
    'spreadMethod',
    'href',
  ]),
  stop: new Set(['offset', 'stop-color', 'stop-opacity']),
  pattern: new Set([
    'x',
    'y',
    'width',
    'height',
    'patternUnits',
    'patternContentUnits',
    'patternTransform',
    'href',
  ]),
  clipPath: new Set(['clipPathUnits']),
  mask: new Set(['x', 'y', 'width', 'height', 'maskUnits', 'maskContentUnits']),
  marker: new Set([
    'markerWidth',
    'markerHeight',
    'refX',
    'refY',
    'orient',
    'markerUnits',
    'viewBox',
    'preserveAspectRatio',
  ]),
  filter: new Set([
    'x',
    'y',
    'width',
    'height',
    'filterUnits',
    'primitiveUnits',
  ]),
  feGaussianBlur: new Set(['in', 'stdDeviation', 'result']),
  feOffset: new Set(['in', 'dx', 'dy', 'result']),
  feMerge: new Set(['result']),
  feMergeNode: new Set(['in']),
  feBlend: new Set(['in', 'in2', 'mode', 'result']),
  feColorMatrix: new Set(['in', 'type', 'values', 'result']),
  feFlood: new Set(['flood-color', 'flood-opacity', 'result']),
  feComposite: new Set(['in', 'in2', 'operator', 'k1', 'k2', 'k3', 'k4', 'result']),
  g: new Set([]),
  defs: new Set([]),
  title: new Set([]),
  desc: new Set([]),
}

// Dangerous patterns in style attributes
const DANGEROUS_STYLE_PATTERNS = [
  /url\s*\(/i, // url() can load external resources
  /expression\s*\(/i, // IE expression()
  /javascript:/i,
  /data:/i, // data: URIs in styles
  /@import/i,
  /behavior\s*:/i, // IE behavior
  /-moz-binding/i, // Firefox XBL
]

/**
 * Check if a style attribute value is safe
 */
function isSafeStyle(value: string): boolean {
  return !DANGEROUS_STYLE_PATTERNS.some((pattern) => pattern.test(value))
}

/**
 * Check if an href value is safe (only allows internal references)
 */
function isSafeHref(value: string): boolean {
  // Only allow internal fragment references (#id)
  if (value.startsWith('#')) {
    return true
  }
  // Block all other href patterns
  return false
}

/**
 * Check if an attribute is allowed for an element
 */
function isAllowedAttribute(
  element: string,
  attr: string,
  value: string
): boolean {
  const lowerAttr = attr.toLowerCase()

  // Block all event handlers
  if (lowerAttr.startsWith('on')) {
    return false
  }

  // Check style safety
  if (lowerAttr === 'style') {
    return isSafeStyle(value)
  }

  // Check href safety (for use, textPath, gradients, patterns)
  if (lowerAttr === 'href' || lowerAttr === 'xlink:href') {
    return isSafeHref(value)
  }

  // Check global attributes
  if (GLOBAL_ATTRIBUTES.has(lowerAttr)) {
    return true
  }

  // Check element-specific attributes
  const elementAttrs = ELEMENT_ATTRIBUTES[element]
  if (elementAttrs && elementAttrs.has(lowerAttr)) {
    return true
  }

  return false
}

/**
 * Sanitize an SVG element and its children recursively
 */
function sanitizeElement(element: Element): Element | null {
  const tagName = element.tagName.toLowerCase()

  // Remove disallowed elements entirely
  if (!ALLOWED_ELEMENTS.has(tagName)) {
    return null
  }

  // Create a new element with only allowed attributes
  const cleanElement = element.ownerDocument!.createElementNS(
    'http://www.w3.org/2000/svg',
    tagName
  )

  // Copy allowed attributes
  for (const attr of Array.from(element.attributes)) {
    if (isAllowedAttribute(tagName, attr.name, attr.value)) {
      cleanElement.setAttribute(attr.name, attr.value)
    }
  }

  // Process children
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 1) {
      // Element node
      const cleanChild = sanitizeElement(child as Element)
      if (cleanChild) {
        cleanElement.appendChild(cleanChild)
      }
    } else if (child.nodeType === 3) {
      // Text node - keep it (for text elements)
      cleanElement.appendChild(child.cloneNode())
    }
  }

  return cleanElement
}

/**
 * Parse and sanitize SVG content
 *
 * @param svgContent - Raw SVG string from user input
 * @returns Sanitized SVG string, or null if invalid/empty
 */
export function sanitizeSvg(svgContent: string): string | null {
  // Size limit: 100KB max
  if (svgContent.length > 100 * 1024) {
    console.warn('SVG content exceeds size limit')
    return null
  }

  // Parse the SVG
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')

  // Check for parsing errors
  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    console.warn('SVG parsing error:', parserError.textContent)
    return null
  }

  // Get the root SVG element
  const svgElement = doc.documentElement
  if (svgElement.tagName.toLowerCase() !== 'svg') {
    console.warn('Root element is not an SVG')
    return null
  }

  // Sanitize the SVG
  const cleanSvg = sanitizeElement(svgElement)
  if (!cleanSvg) {
    return null
  }

  // Serialize back to string
  const serializer = new XMLSerializer()
  return serializer.serializeToString(cleanSvg)
}

/**
 * Wrap sanitized SVG in a container div for styling
 */
export function wrapSvg(sanitizedSvg: string): string {
  return `<div class="svg-container">${sanitizedSvg}</div>`
}
