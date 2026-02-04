/**
 * SVG Sanitizer
 *
 * Sanitizes SVG content to prevent XSS attacks while preserving
 * legitimate SVG functionality for diagrams and illustrations.
 */

// Counter for generating unique SVG IDs
let svgCounter = 0

/**
 * Reset the SVG counter (for testing purposes)
 */
export function resetSvgCounter(): void {
  svgCounter = 0
}

/**
 * Generate a unique prefix for namespacing SVG IDs and classes
 */
function generateUniquePrefix(): string {
  return `svg${++svgCounter}_`
}

// Allowed SVG elements (no scripts, no foreignObject, no handlers)
// Note: all names must be lowercase since tagName.toLowerCase() is used for matching
const ALLOWED_ELEMENTS = new Set([
  // Structure
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'style',
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
  'textpath',
  // Gradients and patterns
  'lineargradient',
  'radialgradient',
  'stop',
  'pattern',
  // Clipping and masking
  'clippath',
  'mask',
  // Markers
  'marker',
  // Filters (basic)
  'filter',
  'fegaussianblur',
  'feoffset',
  'femerge',
  'femergenode',
  'feblend',
  'fecolormatrix',
  'feflood',
  'fecomposite',
  // Animation
  'animate',
  'animatetransform',
  'animatemotion',
  'set',
  'mpath',
])

// SVG element names that require specific casing (lowercase -> proper case)
// Most SVG elements are lowercase, but some use camelCase
const SVG_ELEMENT_CASE: Record<string, string> = {
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  clippath: 'clipPath',
  textpath: 'textPath',
  fegaussianblur: 'feGaussianBlur',
  feoffset: 'feOffset',
  femerge: 'feMerge',
  femergenode: 'feMergeNode',
  feblend: 'feBlend',
  fecolormatrix: 'feColorMatrix',
  feflood: 'feFlood',
  fecomposite: 'feComposite',
  animatetransform: 'animateTransform',
  animatemotion: 'animateMotion',
}

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

// Element keys must be lowercase to match tagName.toLowerCase()
// Attribute values must also be lowercase to match attr.name.toLowerCase()
const ELEMENT_ATTRIBUTES: Record<string, Set<string>> = {
  svg: new Set([
    'xmlns',
    'viewbox',
    'width',
    'height',
    'preserveaspectratio',
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
  textpath: new Set(['href', 'startoffset', 'method', 'spacing']),
  use: new Set(['href', 'x', 'y', 'width', 'height']),
  symbol: new Set(['viewbox', 'preserveaspectratio']),
  lineargradient: new Set([
    'x1',
    'y1',
    'x2',
    'y2',
    'gradientunits',
    'gradienttransform',
    'spreadmethod',
    'href',
  ]),
  radialgradient: new Set([
    'cx',
    'cy',
    'r',
    'fx',
    'fy',
    'gradientunits',
    'gradienttransform',
    'spreadmethod',
    'href',
  ]),
  stop: new Set(['offset', 'stop-color', 'stop-opacity']),
  pattern: new Set([
    'x',
    'y',
    'width',
    'height',
    'patternunits',
    'patterncontentunits',
    'patterntransform',
    'href',
  ]),
  clippath: new Set(['clippathunits']),
  mask: new Set(['x', 'y', 'width', 'height', 'maskunits', 'maskcontentunits']),
  marker: new Set([
    'markerwidth',
    'markerheight',
    'refx',
    'refy',
    'orient',
    'markerunits',
    'viewbox',
    'preserveaspectratio',
  ]),
  filter: new Set([
    'x',
    'y',
    'width',
    'height',
    'filterunits',
    'primitiveunits',
  ]),
  fegaussianblur: new Set(['in', 'stddeviation', 'result']),
  feoffset: new Set(['in', 'dx', 'dy', 'result']),
  femerge: new Set(['result']),
  femergenode: new Set(['in']),
  feblend: new Set(['in', 'in2', 'mode', 'result']),
  fecolormatrix: new Set(['in', 'type', 'values', 'result']),
  feflood: new Set(['flood-color', 'flood-opacity', 'result']),
  fecomposite: new Set(['in', 'in2', 'operator', 'k1', 'k2', 'k3', 'k4', 'result']),
  g: new Set([]),
  defs: new Set([]),
  title: new Set([]),
  desc: new Set([]),
  style: new Set(['type']),
  // Animation elements
  animate: new Set([
    'attributename',
    'attributetype',
    'from',
    'to',
    'by',
    'values',
    'dur',
    'begin',
    'end',
    'min',
    'max',
    'restart',
    'repeatcount',
    'repeatdur',
    'fill',
    'calcmode',
    'keytimes',
    'keysplines',
    'additive',
    'accumulate',
  ]),
  animatetransform: new Set([
    'attributename',
    'attributetype',
    'type',
    'from',
    'to',
    'by',
    'values',
    'dur',
    'begin',
    'end',
    'min',
    'max',
    'restart',
    'repeatcount',
    'repeatdur',
    'fill',
    'calcmode',
    'keytimes',
    'keysplines',
    'additive',
    'accumulate',
  ]),
  animatemotion: new Set([
    'path',
    'keypoints',
    'rotate',
    'origin',
    'dur',
    'begin',
    'end',
    'min',
    'max',
    'restart',
    'repeatcount',
    'repeatdur',
    'fill',
    'calcmode',
    'keytimes',
    'keysplines',
    'additive',
    'accumulate',
  ]),
  set: new Set([
    'attributename',
    'attributetype',
    'to',
    'dur',
    'begin',
    'end',
    'min',
    'max',
    'restart',
    'repeatcount',
    'repeatdur',
    'fill',
  ]),
  mpath: new Set(['href']),
}

// Dangerous patterns in style attributes
const DANGEROUS_STYLE_PATTERNS = [
  /url\s*\(\s*(?!["']?#)/i, // url() that doesn't reference internal #id
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
 * Sanitize CSS content from a <style> element
 * Returns the sanitized CSS or null if it contains dangerous patterns
 */
function sanitizeCssContent(css: string): string | null {
  if (!isSafeStyle(css)) {
    console.warn('Dangerous pattern detected in SVG style element')
    return null
  }
  return css
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
  const tagNameLower = element.tagName.toLowerCase()

  // Remove disallowed elements entirely
  if (!ALLOWED_ELEMENTS.has(tagNameLower)) {
    return null
  }

  // Use proper SVG element casing (e.g., linearGradient, not lineargradient)
  const properTagName = SVG_ELEMENT_CASE[tagNameLower] || tagNameLower

  // Create a new element with only allowed attributes
  const cleanElement = element.ownerDocument!.createElementNS(
    'http://www.w3.org/2000/svg',
    properTagName
  )

  // Copy allowed attributes
  for (const attr of Array.from(element.attributes)) {
    // Skip xmlns declarations - they're handled automatically by createElementNS
    // and xlink namespace is added inline when xlink:href is used
    if (attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) {
      continue
    }

    if (isAllowedAttribute(tagNameLower, attr.name, attr.value)) {
      // Handle xlink:href specially - it needs the xlink namespace
      if (attr.name === 'xlink:href' || (attr.namespaceURI === 'http://www.w3.org/1999/xlink' && attr.localName === 'href')) {
        cleanElement.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', attr.value)
      } else {
        cleanElement.setAttribute(attr.name, attr.value)
      }
    }
  }

  // Special handling for <style> elements - sanitize CSS content
  if (tagNameLower === 'style') {
    const cssContent = element.textContent || ''
    const sanitizedCss = sanitizeCssContent(cssContent)
    if (sanitizedCss === null) {
      // Dangerous CSS detected, remove the entire style element
      return null
    }
    cleanElement.textContent = sanitizedCss
    return cleanElement
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
 * Namespace all IDs and class names in an SVG to prevent conflicts
 * when multiple SVGs are rendered on the same page.
 */
function namespaceSvg(svgElement: Element, prefix: string): void {
  // Collect all IDs in the SVG
  const idMap = new Map<string, string>()
  const elementsWithId = svgElement.querySelectorAll('[id]')
  for (const el of elementsWithId) {
    const oldId = el.getAttribute('id')!
    const newId = prefix + oldId
    idMap.set(oldId, newId)
    el.setAttribute('id', newId)
  }

  // Collect all classes and create a class map
  const classMap = new Map<string, string>()
  const elementsWithClass = svgElement.querySelectorAll('[class]')
  for (const el of elementsWithClass) {
    const classes = el.getAttribute('class')!.split(/\s+/)
    const newClasses = classes.map((cls) => {
      if (!classMap.has(cls)) {
        classMap.set(cls, prefix + cls)
      }
      return classMap.get(cls)!
    })
    el.setAttribute('class', newClasses.join(' '))
  }

  // Update all href references (href="#id" -> href="#prefix_id")
  const elementsWithHref = svgElement.querySelectorAll('[href]')
  for (const el of elementsWithHref) {
    const href = el.getAttribute('href')
    if (href && href.startsWith('#')) {
      const oldId = href.slice(1)
      if (idMap.has(oldId)) {
        el.setAttribute('href', '#' + idMap.get(oldId))
      }
    }
  }

  // Update all xlink:href references (xlink:href="#id" -> xlink:href="#prefix_id")
  // Note: querySelectorAll doesn't work well with namespaced attributes, so we check all use/textPath/etc elements
  const xlinkElements = svgElement.querySelectorAll('use, textPath, pattern, linearGradient, radialGradient, mpath')
  for (const el of xlinkElements) {
    const xlinkHref = el.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
    if (xlinkHref && xlinkHref.startsWith('#')) {
      const oldId = xlinkHref.slice(1)
      if (idMap.has(oldId)) {
        el.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#' + idMap.get(oldId))
      }
    }
  }

  // Update all style attributes containing url(#id)
  const elementsWithStyle = svgElement.querySelectorAll('[style]')
  for (const el of elementsWithStyle) {
    let style = el.getAttribute('style')!
    for (const [oldId, newId] of idMap) {
      // Match url(#id), url('#id'), url("#id")
      style = style.replace(
        new RegExp(`url\\((['"]?)#${escapeRegExp(oldId)}\\1\\)`, 'g'),
        `url($1#${newId}$1)`
      )
    }
    el.setAttribute('style', style)
  }

  // Update all presentation attributes that reference IDs (fill, stroke, filter, clip-path, mask, marker-*)
  const urlAttributes = [
    'fill',
    'stroke',
    'filter',
    'clip-path',
    'mask',
    'marker-start',
    'marker-mid',
    'marker-end',
  ]
  for (const attr of urlAttributes) {
    const elementsWithAttr = svgElement.querySelectorAll(`[${attr}]`)
    for (const el of elementsWithAttr) {
      let value = el.getAttribute(attr)!
      for (const [oldId, newId] of idMap) {
        value = value.replace(
          new RegExp(`url\\((['"]?)#${escapeRegExp(oldId)}\\1\\)`, 'g'),
          `url($1#${newId}$1)`
        )
      }
      el.setAttribute(attr, value)
    }
  }

  // Update <style> elements - replace class selectors and url() references
  const styleElements = svgElement.querySelectorAll('style')
  for (const styleEl of styleElements) {
    let css = styleEl.textContent || ''

    // Replace class selectors (.classname -> .prefix_classname)
    for (const [oldClass, newClass] of classMap) {
      css = css.replace(
        new RegExp(`\\.${escapeRegExp(oldClass)}(?![a-zA-Z0-9_-])`, 'g'),
        `.${newClass}`
      )
    }

    // Replace url(#id) references
    for (const [oldId, newId] of idMap) {
      css = css.replace(
        new RegExp(`url\\((['"]?)#${escapeRegExp(oldId)}\\1\\)`, 'g'),
        `url($1#${newId}$1)`
      )
    }

    styleEl.textContent = css
  }
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

  // Namespace IDs and classes to prevent conflicts between multiple SVGs
  const prefix = generateUniquePrefix()
  namespaceSvg(cleanSvg, prefix)

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
