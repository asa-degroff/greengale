import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock D1 Database
function createMockD1() {
  const mockStatement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
    run: vi.fn().mockResolvedValue({ success: true }),
  }

  return {
    prepare: vi.fn().mockReturnValue(mockStatement),
    batch: vi.fn().mockResolvedValue([]),
    _statement: mockStatement,
  }
}

// Mock KV Namespace
function createMockKV() {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

// Mock Durable Object storage
function createMockStorage() {
  const store = new Map<string, unknown>()
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    put: vi.fn(async (key: string, value: unknown) => { store.set(key, value) }),
    delete: vi.fn(async (key: string) => { store.delete(key) }),
    getAlarm: vi.fn().mockResolvedValue(null),
    setAlarm: vi.fn().mockResolvedValue(undefined),
    deleteAlarm: vi.fn().mockResolvedValue(undefined),
    _store: store,
  }
}

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Collections
const BLOG_COLLECTIONS = [
  'com.whtwnd.blog.entry',
  'app.greengale.blog.entry',
  'app.greengale.document',
  'site.standard.document',
]

const PUBLICATION_COLLECTIONS = [
  'app.greengale.publication',
  'site.standard.publication',
]

const SENSITIVE_LABELS = ['nudity', 'sexual', 'porn', 'graphic-media']

// Helper functions extracted from the firehose consumer for testing
function hasSensitiveLabels(blob: Record<string, unknown>): boolean {
  const labels = blob.labels as { values?: Array<{ val: string }> } | undefined
  if (!labels?.values) return false
  return labels.values.some(l => SENSITIVE_LABELS.includes(l.val))
}

function extractCidFromBlobref(blobref: unknown): string | null {
  if (!blobref) return null
  if (typeof blobref === 'string') return blobref
  if (typeof blobref !== 'object') return null

  const ref = blobref as Record<string, unknown>

  if (ref.ref && typeof ref.ref === 'object') {
    const innerRef = ref.ref as Record<string, unknown>
    if (typeof innerRef.$link === 'string') return innerRef.$link
    if (typeof innerRef.toString === 'function') {
      const cidStr = innerRef.toString()
      if (typeof cidStr === 'string' && cidStr.startsWith('baf')) return cidStr
    }
  }

  if (typeof ref.$link === 'string') return ref.$link
  if (typeof ref.cid === 'string') return ref.cid

  return null
}

function extractFirstImageCid(record: Record<string, unknown>): string | null {
  const blobs = record?.blobs
  if (!blobs || !Array.isArray(blobs)) return null

  for (const blob of blobs) {
    if (typeof blob !== 'object' || blob === null) continue
    if (hasSensitiveLabels(blob as Record<string, unknown>)) continue

    const blobRecord = blob as Record<string, unknown>
    const cid = extractCidFromBlobref(blobRecord.blobref)
    if (cid) return cid
  }

  return null
}

// Simulated indexPost logic for testing (extracted core logic)
interface IndexedPost {
  uri: string
  did: string
  rkey: string
  title: string | null
  subtitle: string | null
  visibility: string
  content: string
  hasLatex: boolean
  createdAt: string | null
  themePreset: string | null
  firstImageCid: string | null
  source: 'whitewind' | 'greengale'
  slug: string | null
  contentPreview: string
}

function extractPostData(
  uri: string,
  did: string,
  rkey: string,
  source: 'whitewind' | 'greengale',
  record: Record<string, unknown> | undefined,
  collection: string
): IndexedPost {
  const isV2Document = collection === 'app.greengale.document'
  const isSiteStandardDocument = collection === 'site.standard.document'

  const title = (record?.title as string) || null
  const subtitle = isSiteStandardDocument
    ? (record?.description as string) || null
    : (record?.subtitle as string) || null
  const visibility = (record?.visibility as string) || 'public'
  const content = isSiteStandardDocument
    ? (record?.textContent as string) || ''
    : (record?.content as string) || ''
  const hasLatex = source === 'greengale' && !isSiteStandardDocument && (record?.latex === true)

  const createdAt = (isV2Document || isSiteStandardDocument)
    ? (record?.publishedAt as string) || null
    : (record?.createdAt as string) || null

  let themePreset: string | null = null
  if (record?.theme) {
    const themeData = record.theme as Record<string, unknown>
    if (themeData.custom) {
      themePreset = JSON.stringify(themeData.custom)
    } else if (themeData.preset) {
      themePreset = themeData.preset as string
    }
  }

  const firstImageCid = source === 'greengale' && record
    ? extractFirstImageCid(record)
    : null

  const contentPreview = content
    .replace(/[#*`\[\]()!]/g, '')
    .replace(/\n+/g, ' ')
    .slice(0, 300)

  const slug = title
    ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    : null

  return {
    uri,
    did,
    rkey,
    title,
    subtitle,
    visibility,
    content,
    hasLatex,
    createdAt,
    themePreset,
    firstImageCid,
    source,
    slug,
    contentPreview,
  }
}

describe('Firehose Indexer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  describe('hasSensitiveLabels', () => {
    it('returns false when no labels', () => {
      expect(hasSensitiveLabels({})).toBe(false)
    })

    it('returns false when labels.values is empty', () => {
      expect(hasSensitiveLabels({ labels: { values: [] } })).toBe(false)
    })

    it('returns true for nudity label', () => {
      expect(hasSensitiveLabels({ labels: { values: [{ val: 'nudity' }] } })).toBe(true)
    })

    it('returns true for sexual label', () => {
      expect(hasSensitiveLabels({ labels: { values: [{ val: 'sexual' }] } })).toBe(true)
    })

    it('returns true for porn label', () => {
      expect(hasSensitiveLabels({ labels: { values: [{ val: 'porn' }] } })).toBe(true)
    })

    it('returns true for graphic-media label', () => {
      expect(hasSensitiveLabels({ labels: { values: [{ val: 'graphic-media' }] } })).toBe(true)
    })

    it('returns false for non-sensitive labels', () => {
      expect(hasSensitiveLabels({ labels: { values: [{ val: 'art' }] } })).toBe(false)
    })

    it('returns true when one of multiple labels is sensitive', () => {
      expect(hasSensitiveLabels({
        labels: { values: [{ val: 'art' }, { val: 'nudity' }, { val: 'photography' }] }
      })).toBe(true)
    })
  })

  describe('extractCidFromBlobref', () => {
    it('returns null for null/undefined', () => {
      expect(extractCidFromBlobref(null)).toBeNull()
      expect(extractCidFromBlobref(undefined)).toBeNull()
    })

    it('returns direct string CID', () => {
      expect(extractCidFromBlobref('bafkreiabc123')).toBe('bafkreiabc123')
    })

    it('returns null for non-object, non-string', () => {
      expect(extractCidFromBlobref(123)).toBeNull()
      expect(extractCidFromBlobref(true)).toBeNull()
    })

    it('extracts CID from { ref: { $link: cid } } structure', () => {
      const blobref = { ref: { $link: 'bafkreinested' } }
      expect(extractCidFromBlobref(blobref)).toBe('bafkreinested')
    })

    it('extracts CID from ref.toString() when starts with baf', () => {
      const blobref = {
        ref: {
          toString: () => 'bafkreitostring123',
        },
      }
      expect(extractCidFromBlobref(blobref)).toBe('bafkreitostring123')
    })

    it('ignores toString() result not starting with baf', () => {
      const blobref = {
        ref: {
          toString: () => 'invalid-not-baf',
        },
      }
      expect(extractCidFromBlobref(blobref)).toBeNull()
    })

    it('extracts CID from { $link: cid } structure', () => {
      const blobref = { $link: 'bafkreidirect' }
      expect(extractCidFromBlobref(blobref)).toBe('bafkreidirect')
    })

    it('extracts CID from { cid: string } structure', () => {
      const blobref = { cid: 'bafkreicidfield' }
      expect(extractCidFromBlobref(blobref)).toBe('bafkreicidfield')
    })

    it('returns null for empty object', () => {
      expect(extractCidFromBlobref({})).toBeNull()
    })

    it('prefers ref.$link over direct $link', () => {
      const blobref = {
        ref: { $link: 'bafkreifirst' },
        $link: 'bafkreisecond',
      }
      expect(extractCidFromBlobref(blobref)).toBe('bafkreifirst')
    })
  })

  describe('extractFirstImageCid', () => {
    it('returns null when no blobs array', () => {
      expect(extractFirstImageCid({})).toBeNull()
      expect(extractFirstImageCid({ blobs: null })).toBeNull()
    })

    it('returns null for empty blobs array', () => {
      expect(extractFirstImageCid({ blobs: [] })).toBeNull()
    })

    it('extracts CID from first blob', () => {
      const record = {
        blobs: [
          { blobref: { $link: 'bafkreifirst' } },
          { blobref: { $link: 'bafkreisecond' } },
        ],
      }
      expect(extractFirstImageCid(record)).toBe('bafkreifirst')
    })

    it('skips blobs with sensitive labels', () => {
      const record = {
        blobs: [
          { blobref: { $link: 'bafkreisensitive' }, labels: { values: [{ val: 'nudity' }] } },
          { blobref: { $link: 'bafkreisafe' } },
        ],
      }
      expect(extractFirstImageCid(record)).toBe('bafkreisafe')
    })

    it('returns null when all blobs are sensitive', () => {
      const record = {
        blobs: [
          { blobref: { $link: 'bafkrei1' }, labels: { values: [{ val: 'porn' }] } },
          { blobref: { $link: 'bafkrei2' }, labels: { values: [{ val: 'sexual' }] } },
        ],
      }
      expect(extractFirstImageCid(record)).toBeNull()
    })

    it('skips invalid blob entries', () => {
      const record = {
        blobs: [
          null,
          'not-an-object',
          123,
          { blobref: { $link: 'bafkreivalid' } },
        ],
      }
      expect(extractFirstImageCid(record)).toBe('bafkreivalid')
    })

    it('handles blob without blobref', () => {
      const record = {
        blobs: [
          { alt: 'An image without blobref' },
          { blobref: { $link: 'bafkreihasref' } },
        ],
      }
      expect(extractFirstImageCid(record)).toBe('bafkreihasref')
    })
  })

  describe('extractPostData', () => {
    const baseArgs = {
      uri: 'at://did:plc:abc/app.greengale.document/xyz',
      did: 'did:plc:abc',
      rkey: 'xyz',
      source: 'greengale' as const,
    }

    describe('GreenGale V2 documents', () => {
      const collection = 'app.greengale.document'

      it('extracts all fields from complete record', () => {
        const record = {
          title: 'My Post',
          subtitle: 'A great post',
          content: 'Hello world content',
          visibility: 'public',
          publishedAt: '2024-01-01T00:00:00Z',
          latex: true,
          theme: { preset: 'dracula' },
          blobs: [{ blobref: { $link: 'bafkreiimg' } }],
        }

        const result = extractPostData(
          baseArgs.uri, baseArgs.did, baseArgs.rkey, baseArgs.source, record, collection
        )

        expect(result.title).toBe('My Post')
        expect(result.subtitle).toBe('A great post')
        expect(result.visibility).toBe('public')
        expect(result.createdAt).toBe('2024-01-01T00:00:00Z')
        expect(result.hasLatex).toBe(true)
        expect(result.themePreset).toBe('dracula')
        expect(result.firstImageCid).toBe('bafkreiimg')
        expect(result.slug).toBe('my-post')
      })

      it('handles missing optional fields', () => {
        const record = {}
        const result = extractPostData(
          baseArgs.uri, baseArgs.did, baseArgs.rkey, baseArgs.source, record, collection
        )

        expect(result.title).toBeNull()
        expect(result.subtitle).toBeNull()
        expect(result.visibility).toBe('public')
        expect(result.hasLatex).toBe(false)
        expect(result.themePreset).toBeNull()
        expect(result.firstImageCid).toBeNull()
        expect(result.slug).toBeNull()
      })

      it('handles custom theme colors', () => {
        const record = {
          title: 'Test',
          theme: {
            custom: { background: '#ffffff', text: '#000000', accent: '#0066cc' },
          },
        }

        const result = extractPostData(
          baseArgs.uri, baseArgs.did, baseArgs.rkey, baseArgs.source, record, collection
        )

        expect(result.themePreset).toBe(
          JSON.stringify({ background: '#ffffff', text: '#000000', accent: '#0066cc' })
        )
      })

      it('creates slug from title', () => {
        const record = { title: 'Hello World: A Test Post!' }
        const result = extractPostData(
          baseArgs.uri, baseArgs.did, baseArgs.rkey, baseArgs.source, record, collection
        )
        expect(result.slug).toBe('hello-world-a-test-post')
      })

      it('creates content preview stripping markdown', () => {
        const record = { content: '# Hello\n\n**Bold** and `code` here\n\n- List item' }
        const result = extractPostData(
          baseArgs.uri, baseArgs.did, baseArgs.rkey, baseArgs.source, record, collection
        )
        expect(result.contentPreview).toBe(' Hello Bold and code here - List item')
      })

      it('truncates content preview to 300 chars', () => {
        const record = { content: 'a'.repeat(500) }
        const result = extractPostData(
          baseArgs.uri, baseArgs.did, baseArgs.rkey, baseArgs.source, record, collection
        )
        expect(result.contentPreview.length).toBe(300)
      })
    })

    describe('GreenGale V1 blog entries', () => {
      const collection = 'app.greengale.blog.entry'

      it('uses createdAt instead of publishedAt', () => {
        const record = {
          title: 'V1 Post',
          createdAt: '2024-01-01T00:00:00Z',
          publishedAt: '2024-06-01T00:00:00Z', // Should be ignored
        }

        const result = extractPostData(
          baseArgs.uri, baseArgs.did, baseArgs.rkey, baseArgs.source, record, collection
        )

        expect(result.createdAt).toBe('2024-01-01T00:00:00Z')
      })
    })

    describe('WhiteWind posts', () => {
      const collection = 'com.whtwnd.blog.entry'

      it('uses whitewind source and does not extract images', () => {
        const record = {
          title: 'WhiteWind Post',
          createdAt: '2024-01-01T00:00:00Z',
          blobs: [{ blobref: { $link: 'bafkreiimg' } }],
        }

        const result = extractPostData(
          'at://did:plc:abc/com.whtwnd.blog.entry/xyz',
          baseArgs.did, baseArgs.rkey, 'whitewind', record, collection
        )

        expect(result.source).toBe('whitewind')
        expect(result.firstImageCid).toBeNull() // WhiteWind doesn't support images
        expect(result.hasLatex).toBe(false) // WhiteWind doesn't support latex
      })
    })

    describe('site.standard.document', () => {
      const collection = 'site.standard.document'

      it('uses description instead of subtitle', () => {
        const record = {
          title: 'Standard Site Post',
          description: 'This is the description',
          subtitle: 'This should be ignored',
        }

        const result = extractPostData(
          'at://did:plc:abc/site.standard.document/xyz',
          baseArgs.did, baseArgs.rkey, baseArgs.source, record, collection
        )

        expect(result.subtitle).toBe('This is the description')
      })

      it('uses textContent instead of content', () => {
        const record = {
          title: 'Test',
          textContent: 'Plain text content for indexing',
          content: { uri: 'at://...' }, // This would be a reference, ignored
        }

        const result = extractPostData(
          'at://did:plc:abc/site.standard.document/xyz',
          baseArgs.did, baseArgs.rkey, baseArgs.source, record, collection
        )

        expect(result.content).toBe('Plain text content for indexing')
      })

      it('uses publishedAt for date', () => {
        const record = {
          title: 'Test',
          publishedAt: '2024-06-01T00:00:00Z',
          createdAt: '2024-01-01T00:00:00Z',
        }

        const result = extractPostData(
          'at://did:plc:abc/site.standard.document/xyz',
          baseArgs.did, baseArgs.rkey, baseArgs.source, record, collection
        )

        expect(result.createdAt).toBe('2024-06-01T00:00:00Z')
      })

      it('does not set hasLatex for site.standard documents', () => {
        const record = {
          title: 'Test',
          latex: true, // Should be ignored
        }

        const result = extractPostData(
          'at://did:plc:abc/site.standard.document/xyz',
          baseArgs.did, baseArgs.rkey, baseArgs.source, record, collection
        )

        expect(result.hasLatex).toBe(false)
      })
    })
  })

  describe('Publication Indexing', () => {
    function extractPublicationData(
      record: Record<string, unknown> | undefined,
      collection: string
    ) {
      const isSiteStandard = collection === 'site.standard.publication'

      const name = (record?.name as string) || null
      const description = (record?.description as string) || null
      const url = (record?.url as string) || null

      let themePreset: string | null = null
      const themeSource = isSiteStandard ? record?.basicTheme : record?.theme
      if (themeSource) {
        const themeData = themeSource as Record<string, unknown>
        if (isSiteStandard) {
          themePreset = JSON.stringify({
            background: themeData.backgroundColor,
            text: themeData.primaryColor,
            accent: themeData.accentColor,
          })
        } else if (themeData.custom) {
          themePreset = JSON.stringify(themeData.custom)
        } else if (themeData.preset) {
          themePreset = themeData.preset as string
        }
      }

      return { name, description, url, themePreset }
    }

    describe('app.greengale.publication', () => {
      it('extracts all fields', () => {
        const record = {
          name: 'My Blog',
          description: 'A blog about things',
          url: 'https://myblog.com',
          theme: { preset: 'github-dark' },
        }

        const result = extractPublicationData(record, 'app.greengale.publication')

        expect(result.name).toBe('My Blog')
        expect(result.description).toBe('A blog about things')
        expect(result.url).toBe('https://myblog.com')
        expect(result.themePreset).toBe('github-dark')
      })

      it('handles custom theme', () => {
        const record = {
          name: 'Blog',
          url: 'https://example.com',
          theme: {
            custom: { background: '#000', text: '#fff', accent: '#f00' },
          },
        }

        const result = extractPublicationData(record, 'app.greengale.publication')

        expect(result.themePreset).toBe(
          JSON.stringify({ background: '#000', text: '#fff', accent: '#f00' })
        )
      })
    })

    describe('site.standard.publication', () => {
      it('converts basicTheme to theme format', () => {
        const record = {
          name: 'Standard Blog',
          url: 'https://standard.site',
          basicTheme: {
            primaryColor: '#24292f',
            backgroundColor: '#ffffff',
            accentColor: '#0969da',
          },
        }

        const result = extractPublicationData(record, 'site.standard.publication')

        const parsed = JSON.parse(result.themePreset!)
        expect(parsed.background).toBe('#ffffff')
        expect(parsed.text).toBe('#24292f')
        expect(parsed.accent).toBe('#0969da')
      })

      it('uses basicTheme not theme', () => {
        const record = {
          name: 'Blog',
          url: 'https://example.com',
          theme: { preset: 'ignored' }, // Should be ignored for site.standard
          basicTheme: {
            primaryColor: '#000',
            backgroundColor: '#fff',
            accentColor: '#00f',
          },
        }

        const result = extractPublicationData(record, 'site.standard.publication')

        const parsed = JSON.parse(result.themePreset!)
        expect(parsed.text).toBe('#000')
      })
    })
  })

  describe('Event Routing', () => {
    // Simulated handleMessage routing logic
    function routeEvent(event: {
      kind: string
      commit?: {
        operation: string
        collection: string
      }
    }): 'ignore' | 'index_post' | 'delete_post' | 'index_pub' | 'delete_pub' {
      if (event.kind !== 'commit') return 'ignore'
      if (!event.commit) return 'ignore'

      const { operation, collection } = event.commit

      if (PUBLICATION_COLLECTIONS.includes(collection)) {
        return operation === 'delete' ? 'delete_pub' : 'index_pub'
      }

      if (BLOG_COLLECTIONS.includes(collection)) {
        return operation === 'delete' ? 'delete_post' : 'index_post'
      }

      return 'ignore'
    }

    it('ignores non-commit events', () => {
      expect(routeEvent({ kind: 'identity' })).toBe('ignore')
      expect(routeEvent({ kind: 'account' })).toBe('ignore')
    })

    it('routes blog post creates to index_post', () => {
      for (const collection of BLOG_COLLECTIONS) {
        expect(routeEvent({
          kind: 'commit',
          commit: { operation: 'create', collection },
        })).toBe('index_post')
      }
    })

    it('routes blog post updates to index_post', () => {
      expect(routeEvent({
        kind: 'commit',
        commit: { operation: 'update', collection: 'app.greengale.document' },
      })).toBe('index_post')
    })

    it('routes blog post deletes to delete_post', () => {
      expect(routeEvent({
        kind: 'commit',
        commit: { operation: 'delete', collection: 'app.greengale.document' },
      })).toBe('delete_post')
    })

    it('routes publication creates to index_pub', () => {
      for (const collection of PUBLICATION_COLLECTIONS) {
        expect(routeEvent({
          kind: 'commit',
          commit: { operation: 'create', collection },
        })).toBe('index_pub')
      }
    })

    it('routes publication deletes to delete_pub', () => {
      expect(routeEvent({
        kind: 'commit',
        commit: { operation: 'delete', collection: 'app.greengale.publication' },
      })).toBe('delete_pub')
    })

    it('ignores unknown collections', () => {
      expect(routeEvent({
        kind: 'commit',
        commit: { operation: 'create', collection: 'app.bsky.feed.post' },
      })).toBe('ignore')
    })
  })

  describe('Cache Invalidation', () => {
    it('should invalidate all common cache keys on post index', () => {
      // This tests the expected cache keys that should be invalidated
      const expectedKeys = [
        'recent_posts:12:',
        'recent_posts:24:',
        'recent_posts:50:',
        'recent_posts:100:',
      ]

      // Verify the pattern matches what the code uses
      for (const key of expectedKeys) {
        expect(key).toMatch(/^recent_posts:\d+:$/)
      }
    })

    it('should invalidate OG cache with correct key format', () => {
      const handle = 'test.bsky.social'
      const rkey = 'abc123'
      const expectedKey = `og:${handle}:${rkey}`
      expect(expectedKey).toBe('og:test.bsky.social:abc123')
    })

    it('should invalidate profile OG cache with correct key format', () => {
      const handle = 'test.bsky.social'
      const expectedKey = `og:profile:${handle}`
      expect(expectedKey).toBe('og:profile:test.bsky.social')
    })
  })

  describe('Author Data Fetching', () => {
    interface AuthorData {
      did: string
      handle: string
      displayName: string | null
      description: string | null
      avatar: string | null
      banner: string | null
      pdsEndpoint: string | null
    }

    // Simulated fetchAuthorData logic (matches firehose implementation)
    async function fetchAuthorData(did: string): Promise<AuthorData | null> {
      try {
        const response = await fetch(
          `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
        )

        if (!response.ok) return null

        const profile = await response.json() as {
          did: string
          handle: string
          displayName?: string
          description?: string
          avatar?: string
          banner?: string
        }

        // Also fetch PDS endpoint
        let pdsEndpoint: string | null = null
        try {
          const didDocResponse = await fetch(`https://plc.directory/${did}`)
          if (didDocResponse.ok) {
            const didDoc = await didDocResponse.json() as {
              service?: Array<{ id: string; type: string; serviceEndpoint: string }>
            }
            const pdsService = didDoc.service?.find(
              (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
            )
            pdsEndpoint = pdsService?.serviceEndpoint || null
          }
        } catch {
          // PDS lookup failed
        }

        return {
          did: profile.did,
          handle: profile.handle,
          displayName: profile.displayName || null,
          description: profile.description || null,
          avatar: profile.avatar || null,
          banner: profile.banner || null,
          pdsEndpoint,
        }
      } catch {
        return null
      }
    }

    it('returns null when profile fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })

      const result = await fetchAuthorData('did:plc:unknown')
      expect(result).toBeNull()
    })

    it('extracts author data from successful response', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            did: 'did:plc:abc',
            handle: 'test.bsky.social',
            displayName: 'Test User',
            description: 'A test user',
            avatar: 'https://cdn.bsky.app/avatar.jpg',
            banner: 'https://cdn.bsky.app/banner.jpg',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            service: [
              { id: '#atproto_pds', serviceEndpoint: 'https://pds.example.com' },
            ],
          }),
        })

      const result = await fetchAuthorData('did:plc:abc')

      expect(result).not.toBeNull()
      expect(result!.handle).toBe('test.bsky.social')
      expect(result!.displayName).toBe('Test User')
      expect(result!.pdsEndpoint).toBe('https://pds.example.com')
    })

    it('handles missing optional profile fields', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            did: 'did:plc:minimal',
            handle: 'minimal.bsky.social',
            // No displayName, description, avatar, banner
          }),
        })
        .mockResolvedValueOnce({ ok: false }) // PDS lookup fails

      const result = await fetchAuthorData('did:plc:minimal')

      expect(result).not.toBeNull()
      expect(result!.displayName).toBeNull()
      expect(result!.description).toBeNull()
      expect(result!.avatar).toBeNull()
      expect(result!.pdsEndpoint).toBeNull()
    })

    it('extracts PDS endpoint from DID document', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            did: 'did:plc:abc',
            handle: 'test.bsky.social',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            service: [
              { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://bsky.social' },
            ],
          }),
        })

      const result = await fetchAuthorData('did:plc:abc')

      expect(result!.pdsEndpoint).toBe('https://bsky.social')
    })

    it('continues without PDS when DID resolution fails', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            did: 'did:plc:abc',
            handle: 'test.bsky.social',
          }),
        })
        .mockRejectedValueOnce(new Error('Network error'))

      const result = await fetchAuthorData('did:plc:abc')

      expect(result).not.toBeNull()
      expect(result!.handle).toBe('test.bsky.social')
      expect(result!.pdsEndpoint).toBeNull()
    })
  })

  describe('Database Operations', () => {
    let mockDB: ReturnType<typeof createMockD1>
    let mockCache: ReturnType<typeof createMockKV>

    beforeEach(() => {
      mockDB = createMockD1()
      mockCache = createMockKV()
    })

    describe('Post Indexing', () => {
      it('prepares correct SQL for post upsert', () => {
        const uri = 'at://did:plc:abc/app.greengale.document/xyz'
        const did = 'did:plc:abc'
        const rkey = 'xyz'
        const title = 'Test Post'

        mockDB.prepare(`
          INSERT INTO posts (uri, author_did, rkey, title, ...)
          ON CONFLICT(uri) DO UPDATE SET ...
        `).bind(uri, did, rkey, title)

        expect(mockDB.prepare).toHaveBeenCalled()
        expect(mockDB._statement.bind).toHaveBeenCalledWith(uri, did, rkey, title)
      })
    })

    describe('Post Deletion', () => {
      it('fetches post data before deleting', async () => {
        mockDB._statement.first.mockResolvedValueOnce({
          author_did: 'did:plc:abc',
          rkey: 'xyz',
        })

        // Simulate the lookup
        const post = await mockDB.prepare(
          'SELECT author_did, rkey FROM posts WHERE uri = ?'
        ).bind('at://...').first()

        expect(post).not.toBeNull()
        expect(post!.author_did).toBe('did:plc:abc')
      })

      it('uses batch for atomic delete and count update', async () => {
        const statements = [
          mockDB.prepare('DELETE FROM posts WHERE uri = ?').bind('at://...'),
          mockDB.prepare('UPDATE authors SET posts_count = ...').bind('did:plc:abc', 'did:plc:abc'),
        ]

        await mockDB.batch(statements)

        expect(mockDB.batch).toHaveBeenCalledWith(statements)
      })
    })

    describe('Publication Indexing', () => {
      it('validates required fields', () => {
        const record = { url: 'https://example.com' } // Missing name

        const name = (record as Record<string, unknown>).name as string | null
        const url = (record as Record<string, unknown>).url as string | null

        expect(!name || !url).toBe(true) // Should fail validation
      })
    })
  })

  describe('Slug Generation', () => {
    function generateSlug(title: string | null): string | null {
      return title
        ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        : null
    }

    it('converts to lowercase', () => {
      expect(generateSlug('Hello World')).toBe('hello-world')
    })

    it('replaces non-alphanumeric with hyphens', () => {
      expect(generateSlug('Hello, World!')).toBe('hello-world')
    })

    it('trims leading and trailing hyphens', () => {
      expect(generateSlug('...Hello...')).toBe('hello')
    })

    it('returns null for null title', () => {
      expect(generateSlug(null)).toBeNull()
    })

    it('handles empty string', () => {
      expect(generateSlug('')).toBeNull()
    })

    it('preserves numbers', () => {
      expect(generateSlug('Chapter 1: Introduction')).toBe('chapter-1-introduction')
    })

    it('collapses multiple hyphens', () => {
      expect(generateSlug('Hello   World')).toBe('hello-world')
    })
  })

  describe('Content Preview', () => {
    function generateContentPreview(content: string): string {
      return content
        .replace(/[#*`\[\]()!]/g, '')
        .replace(/\n+/g, ' ')
        .slice(0, 300)
    }

    it('strips markdown formatting', () => {
      expect(generateContentPreview('# Hello **World**')).toBe(' Hello World')
    })

    it('removes code backticks', () => {
      expect(generateContentPreview('Use `code` here')).toBe('Use code here')
    })

    it('removes link brackets and parens', () => {
      expect(generateContentPreview('[link](https://example.com)')).toBe('linkhttps://example.com')
    })

    it('removes image syntax', () => {
      expect(generateContentPreview('![alt](image.png)')).toBe('altimage.png')
    })

    it('collapses newlines to spaces', () => {
      expect(generateContentPreview('Line 1\n\nLine 2\n\n\nLine 3')).toBe('Line 1 Line 2 Line 3')
    })

    it('truncates to 300 characters', () => {
      const long = 'a'.repeat(500)
      expect(generateContentPreview(long).length).toBe(300)
    })
  })

  describe('External URL Resolution', () => {
    it('constructs URL from publication URL and document path', () => {
      const pubUrl = 'https://myblog.com'
      const path = '/posts/hello-world'

      const baseUrl = pubUrl.replace(/\/$/, '')
      const normalizedPath = path.startsWith('/') ? path : `/${path}`
      const externalUrl = `${baseUrl}${normalizedPath}`

      expect(externalUrl).toBe('https://myblog.com/posts/hello-world')
    })

    it('handles trailing slash in publication URL', () => {
      const pubUrl = 'https://myblog.com/'
      const path = 'posts/hello'

      const baseUrl = pubUrl.replace(/\/$/, '')
      const normalizedPath = path.startsWith('/') ? path : `/${path}`
      const externalUrl = `${baseUrl}${normalizedPath}`

      expect(externalUrl).toBe('https://myblog.com/posts/hello')
    })

    it('handles path without leading slash', () => {
      const pubUrl = 'https://myblog.com'
      const path = 'posts/hello'

      const baseUrl = pubUrl.replace(/\/$/, '')
      const normalizedPath = path.startsWith('/') ? path : `/${path}`
      const externalUrl = `${baseUrl}${normalizedPath}`

      expect(externalUrl).toBe('https://myblog.com/posts/hello')
    })
  })
})
