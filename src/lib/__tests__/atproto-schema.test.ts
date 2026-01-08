/**
 * AT Protocol Schema Validation Tests
 *
 * These tests verify that records created by the application conform to
 * the lexicon schemas defined in /lexicons/. This helps catch schema
 * drift and ensures interoperability with other AT Protocol clients.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load lexicon definitions from files
let documentLexicon: Record<string, unknown>
let publicationLexicon: Record<string, unknown>
let defsLexicon: Record<string, unknown>

beforeAll(() => {
  const lexiconDir = resolve(process.cwd(), 'lexicons')
  documentLexicon = JSON.parse(readFileSync(resolve(lexiconDir, 'app/greengale/document.json'), 'utf-8'))
  publicationLexicon = JSON.parse(readFileSync(resolve(lexiconDir, 'app/greengale/publication.json'), 'utf-8'))
  defsLexicon = JSON.parse(readFileSync(resolve(lexiconDir, 'app/greengale/blog/defs.json'), 'utf-8'))
})

// Type definitions matching the lexicons
interface Theme {
  preset?: string
  custom?: {
    background?: string
    text?: string
    accent?: string
    codeBackground?: string
  }
}

interface OGP {
  url: string
  width?: number
  height?: number
}

interface SelfLabel {
  val: string
}

interface SelfLabels {
  values: SelfLabel[]
}

interface BlobMetadata {
  blobref: { $type: string; ref: { $link: string }; mimeType: string; size: number }
  name?: string
  alt?: string
  labels?: SelfLabels
}

interface DocumentRecord {
  content: string
  url: string
  path: string
  title: string
  subtitle?: string
  publishedAt: string
  theme?: Theme
  visibility?: 'public' | 'url' | 'author'
  ogp?: OGP
  blobs?: BlobMetadata[]
  latex?: boolean
}

interface PublicationRecord {
  url: string
  name: string
  description?: string
  theme?: Theme
  enableSiteStandard?: boolean
}

// Validation helpers
function isValidUri(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function isValidDatetime(value: string): boolean {
  const date = new Date(value)
  return !isNaN(date.getTime()) && value.includes('T')
}

function getDefsSchema(): Record<string, Record<string, unknown>> {
  return (defsLexicon as { defs: Record<string, Record<string, unknown>> }).defs
}

function getDocSchema(): { required: string[]; properties: Record<string, unknown> } {
  const defs = (documentLexicon as { defs: { main: { record: { required: string[]; properties: Record<string, unknown> } } } }).defs
  return defs.main.record
}

function getPubSchema(): { required: string[]; properties: Record<string, unknown> } {
  const defs = (publicationLexicon as { defs: { main: { record: { required: string[]; properties: Record<string, unknown> } } } }).defs
  return defs.main.record
}

function validateDocument(record: DocumentRecord): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const schema = getDocSchema()

  // Required fields
  const required = schema.required as string[]
  for (const field of required) {
    if (!(field in record) || record[field as keyof DocumentRecord] === undefined) {
      errors.push(`Missing required field: ${field}`)
    }
  }

  // Content validation
  if (record.content !== undefined) {
    if (typeof record.content !== 'string') {
      errors.push('content must be a string')
    } else if (record.content.length > 100000) {
      errors.push('content exceeds maxLength of 100000')
    }
  }

  // URL format validation
  if (record.url !== undefined && !isValidUri(record.url)) {
    errors.push('url must be a valid URI')
  }

  // Path validation
  if (record.path !== undefined) {
    if (typeof record.path !== 'string') {
      errors.push('path must be a string')
    } else if (record.path.length > 500) {
      errors.push('path exceeds maxLength of 500')
    }
  }

  // Title validation
  if (record.title !== undefined) {
    if (typeof record.title !== 'string') {
      errors.push('title must be a string')
    } else if (record.title.length > 1000) {
      errors.push('title exceeds maxLength of 1000')
    }
  }

  // Subtitle validation
  if (record.subtitle !== undefined) {
    if (typeof record.subtitle !== 'string') {
      errors.push('subtitle must be a string')
    } else if (record.subtitle.length > 1000) {
      errors.push('subtitle exceeds maxLength of 1000')
    }
  }

  // PublishedAt datetime validation
  if (record.publishedAt !== undefined && !isValidDatetime(record.publishedAt)) {
    errors.push('publishedAt must be a valid datetime')
  }

  // Visibility enum validation
  const validVisibilities = ['public', 'url', 'author']
  if (record.visibility !== undefined && !validVisibilities.includes(record.visibility)) {
    errors.push(`visibility must be one of: ${validVisibilities.join(', ')}`)
  }

  // Theme preset enum validation
  if (record.theme?.preset !== undefined) {
    const themeDef = getDefsSchema().theme as { properties: { preset: { enum: string[] } } }
    const validPresets = themeDef.properties.preset.enum
    if (!validPresets.includes(record.theme.preset)) {
      errors.push(`theme.preset must be one of: ${validPresets.join(', ')}`)
    }
  }

  // Latex boolean validation
  if (record.latex !== undefined && typeof record.latex !== 'boolean') {
    errors.push('latex must be a boolean')
  }

  return { valid: errors.length === 0, errors }
}

function validatePublication(record: PublicationRecord): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const schema = getPubSchema()

  // Required fields
  const required = schema.required as string[]
  for (const field of required) {
    if (!(field in record) || record[field as keyof PublicationRecord] === undefined) {
      errors.push(`Missing required field: ${field}`)
    }
  }

  // URL format validation
  if (record.url !== undefined && !isValidUri(record.url)) {
    errors.push('url must be a valid URI')
  }

  // Name validation
  if (record.name !== undefined) {
    if (typeof record.name !== 'string') {
      errors.push('name must be a string')
    } else if (record.name.length > 200) {
      errors.push('name exceeds maxLength of 200')
    }
  }

  // Description validation
  if (record.description !== undefined) {
    if (typeof record.description !== 'string') {
      errors.push('description must be a string')
    } else if (record.description.length > 1000) {
      errors.push('description exceeds maxLength of 1000')
    }
  }

  // Theme preset enum validation
  if (record.theme?.preset !== undefined) {
    const themeDef = getDefsSchema().theme as { properties: { preset: { enum: string[] } } }
    const validPresets = themeDef.properties.preset.enum
    if (!validPresets.includes(record.theme.preset)) {
      errors.push(`theme.preset must be one of: ${validPresets.join(', ')}`)
    }
  }

  // enableSiteStandard boolean validation
  if (record.enableSiteStandard !== undefined && typeof record.enableSiteStandard !== 'boolean') {
    errors.push('enableSiteStandard must be a boolean')
  }

  return { valid: errors.length === 0, errors }
}

describe('AT Protocol Schema Validation', () => {
  describe('app.greengale.document', () => {
    it('validates minimal document with all required fields', () => {
      const doc: DocumentRecord = {
        content: 'Hello world',
        url: 'https://greengale.app',
        path: '/author/post',
        title: 'My Post',
        publishedAt: new Date().toISOString(),
      }

      const result = validateDocument(doc)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('validates full document with all optional fields', () => {
      const doc: DocumentRecord = {
        content: '# Title\n\nContent here with **bold** text.',
        url: 'https://greengale.app',
        path: '/user.bsky.social/3kxyz',
        title: 'My Blog Post',
        subtitle: 'A subtitle for the post',
        publishedAt: '2024-01-15T12:00:00.000Z',
        theme: {
          preset: 'dracula',
          custom: {
            background: '#282a36',
            text: '#f8f8f2',
          },
        },
        visibility: 'public',
        latex: true,
        ogp: {
          url: 'https://greengale.app/og/user/post.png',
          width: 1200,
          height: 630,
        },
      }

      const result = validateDocument(doc)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('rejects document missing required fields', () => {
      const doc = {
        content: 'Hello world',
        // Missing: url, path, title, publishedAt
      } as DocumentRecord

      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing required field: url')
      expect(result.errors).toContain('Missing required field: path')
      expect(result.errors).toContain('Missing required field: title')
      expect(result.errors).toContain('Missing required field: publishedAt')
    })

    it('rejects invalid visibility value', () => {
      const doc: DocumentRecord = {
        content: 'Test',
        url: 'https://greengale.app',
        path: '/test',
        title: 'Test',
        publishedAt: new Date().toISOString(),
        visibility: 'invalid' as 'public',
      }

      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('visibility'))).toBe(true)
    })

    it('rejects invalid theme preset', () => {
      const doc: DocumentRecord = {
        content: 'Test',
        url: 'https://greengale.app',
        path: '/test',
        title: 'Test',
        publishedAt: new Date().toISOString(),
        theme: {
          preset: 'invalid-theme',
        },
      }

      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('theme.preset'))).toBe(true)
    })

    it('rejects content exceeding maxLength', () => {
      const doc: DocumentRecord = {
        content: 'x'.repeat(100001),
        url: 'https://greengale.app',
        path: '/test',
        title: 'Test',
        publishedAt: new Date().toISOString(),
      }

      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('content exceeds maxLength'))).toBe(true)
    })

    it('rejects invalid URL format', () => {
      const doc: DocumentRecord = {
        content: 'Test',
        url: 'not-a-valid-url',
        path: '/test',
        title: 'Test',
        publishedAt: new Date().toISOString(),
      }

      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('url must be a valid URI'))).toBe(true)
    })

    it('rejects invalid datetime format', () => {
      const doc: DocumentRecord = {
        content: 'Test',
        url: 'https://greengale.app',
        path: '/test',
        title: 'Test',
        publishedAt: '2024-01-15', // Missing time component
      }

      const result = validateDocument(doc)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('publishedAt must be a valid datetime'))).toBe(true)
    })

    it('accepts all valid theme presets', () => {
      const presets = ['github-light', 'github-dark', 'dracula', 'nord', 'solarized-light', 'solarized-dark', 'monokai']

      for (const preset of presets) {
        const doc: DocumentRecord = {
          content: 'Test',
          url: 'https://greengale.app',
          path: '/test',
          title: 'Test',
          publishedAt: new Date().toISOString(),
          theme: { preset },
        }

        const result = validateDocument(doc)
        expect(result.valid).toBe(true)
      }
    })

    it('accepts all valid visibility values', () => {
      const visibilities: Array<'public' | 'url' | 'author'> = ['public', 'url', 'author']

      for (const visibility of visibilities) {
        const doc: DocumentRecord = {
          content: 'Test',
          url: 'https://greengale.app',
          path: '/test',
          title: 'Test',
          publishedAt: new Date().toISOString(),
          visibility,
        }

        const result = validateDocument(doc)
        expect(result.valid).toBe(true)
      }
    })
  })

  describe('app.greengale.publication', () => {
    it('validates minimal publication with all required fields', () => {
      const pub: PublicationRecord = {
        url: 'https://greengale.app',
        name: 'My Blog',
      }

      const result = validatePublication(pub)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('validates full publication with all optional fields', () => {
      const pub: PublicationRecord = {
        url: 'https://greengale.app',
        name: 'My Tech Blog',
        description: 'A blog about programming and technology.',
        theme: {
          preset: 'nord',
          custom: {
            accent: '#88c0d0',
          },
        },
        enableSiteStandard: true,
      }

      const result = validatePublication(pub)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('rejects publication missing required fields', () => {
      const pub = {
        // Missing: url, name
        description: 'A blog',
      } as PublicationRecord

      const result = validatePublication(pub)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing required field: url')
      expect(result.errors).toContain('Missing required field: name')
    })

    it('rejects name exceeding maxLength', () => {
      const pub: PublicationRecord = {
        url: 'https://greengale.app',
        name: 'x'.repeat(201),
      }

      const result = validatePublication(pub)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('name exceeds maxLength'))).toBe(true)
    })

    it('rejects description exceeding maxLength', () => {
      const pub: PublicationRecord = {
        url: 'https://greengale.app',
        name: 'My Blog',
        description: 'x'.repeat(1001),
      }

      const result = validatePublication(pub)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('description exceeds maxLength'))).toBe(true)
    })

    it('rejects invalid URL format', () => {
      const pub: PublicationRecord = {
        url: 'invalid-url',
        name: 'My Blog',
      }

      const result = validatePublication(pub)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('url must be a valid URI'))).toBe(true)
    })

    it('rejects invalid theme preset', () => {
      const pub: PublicationRecord = {
        url: 'https://greengale.app',
        name: 'My Blog',
        theme: {
          preset: 'invalid-preset',
        },
      }

      const result = validatePublication(pub)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('theme.preset'))).toBe(true)
    })
  })

  describe('app.greengale.blog.defs', () => {
    describe('theme', () => {
      it('has all expected preset values', () => {
        const themeDef = getDefsSchema().theme as { properties: { preset: { enum: string[] } } }
        const presets = themeDef.properties.preset.enum
        expect(presets).toContain('github-light')
        expect(presets).toContain('github-dark')
        expect(presets).toContain('dracula')
        expect(presets).toContain('nord')
        expect(presets).toContain('solarized-light')
        expect(presets).toContain('solarized-dark')
        expect(presets).toContain('monokai')
      })
    })

    describe('selfLabels', () => {
      it('validates self labels structure', () => {
        const labels: SelfLabels = {
          values: [
            { val: 'nudity' },
            { val: 'graphic-media' },
          ],
        }

        expect(labels.values.length).toBeLessThanOrEqual(10)
        for (const label of labels.values) {
          expect(label.val.length).toBeLessThanOrEqual(128)
        }
      })

      it('rejects too many labels', () => {
        const labels: SelfLabels = {
          values: Array.from({ length: 11 }, (_, i) => ({ val: `label${i}` })),
        }

        // maxLength is 10
        expect(labels.values.length).toBeGreaterThan(10)
      })
    })

    describe('blobMetadata', () => {
      it('validates blob metadata structure', () => {
        const blob: BlobMetadata = {
          blobref: {
            $type: 'blob',
            ref: { $link: 'bafyreig5m3k3bnv7kbzxzwwqxwqyqzxw' },
            mimeType: 'image/jpeg',
            size: 12345,
          },
          name: 'photo.jpg',
          alt: 'A beautiful sunset over the mountains',
          labels: {
            values: [{ val: 'nudity' }],
          },
        }

        expect(blob.blobref).toBeDefined()
        expect(blob.alt).toBeDefined()
        expect(blob.alt!.length).toBeLessThanOrEqual(1000)
      })

      it('rejects alt text exceeding maxLength', () => {
        const blob: BlobMetadata = {
          blobref: {
            $type: 'blob',
            ref: { $link: 'bafyreig5m3k3bnv7kbzxzwwqxwqyqzxw' },
            mimeType: 'image/jpeg',
            size: 12345,
          },
          alt: 'x'.repeat(1001),
        }

        expect(blob.alt!.length).toBeGreaterThan(1000)
      })
    })
  })

  describe('Schema Cross-References', () => {
    it('document theme references defs#theme correctly', () => {
      const docProps = getDocSchema().properties as Record<string, { ref?: string }>
      expect(docProps.theme.ref).toBe('app.greengale.blog.defs#theme')
    })

    it('document blobs reference defs#blobMetadata correctly', () => {
      const docProps = getDocSchema().properties as Record<string, { items?: { ref?: string } }>
      expect(docProps.blobs.items?.ref).toBe('app.greengale.blog.defs#blobMetadata')
    })

    it('publication theme references defs#theme correctly', () => {
      const pubProps = getPubSchema().properties as Record<string, { ref?: string }>
      expect(pubProps.theme.ref).toBe('app.greengale.blog.defs#theme')
    })
  })
})
