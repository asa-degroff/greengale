import { describe, it, expect } from 'vitest'
import {
  extractCidFromBlobUrl,
  extractCidFromBlobref,
  getBlobLabelsMap,
  getBlobAltMap,
  getLabelWarningText,
  getLabelValues,
  requiresAgeVerification,
  CONTENT_LABEL_OPTIONS,
} from '../image-labels'

describe('Image Labels Utilities', () => {
  describe('extractCidFromBlobUrl', () => {
    it('extracts CID from valid blob URL', () => {
      const url = 'https://pds.example.com/xrpc/com.atproto.sync.getBlob?did=did:plc:abc&cid=bafkreiabc123'
      expect(extractCidFromBlobUrl(url)).toBe('bafkreiabc123')
    })

    it('extracts CID when it is the first parameter', () => {
      const url = 'https://pds.example.com/xrpc/com.atproto.sync.getBlob?cid=bafkreixyz&did=did:plc:abc'
      expect(extractCidFromBlobUrl(url)).toBe('bafkreixyz')
    })

    it('returns null when CID parameter is missing', () => {
      const url = 'https://pds.example.com/xrpc/com.atproto.sync.getBlob?did=did:plc:abc'
      expect(extractCidFromBlobUrl(url)).toBeNull()
    })

    it('returns null for empty CID parameter', () => {
      const url = 'https://pds.example.com/xrpc/com.atproto.sync.getBlob?cid=&did=did:plc:abc'
      expect(extractCidFromBlobUrl(url)).toBeNull()
    })

    it('handles URL-encoded CID values', () => {
      const url = 'https://pds.example.com/xrpc/com.atproto.sync.getBlob?cid=bafkrei%2Babc'
      expect(extractCidFromBlobUrl(url)).toBe('bafkrei+abc')
    })

    it('uses regex fallback for malformed URLs', () => {
      const url = 'not-a-valid-url?cid=bafkreifallback'
      expect(extractCidFromBlobUrl(url)).toBe('bafkreifallback')
    })

    it('returns null for completely invalid input', () => {
      expect(extractCidFromBlobUrl('just-a-string')).toBeNull()
    })

    it('handles relative URLs via regex fallback', () => {
      const url = '/xrpc/com.atproto.sync.getBlob?cid=bafkreirelative&did=did:plc:abc'
      expect(extractCidFromBlobUrl(url)).toBe('bafkreirelative')
    })
  })

  describe('extractCidFromBlobref', () => {
    it('returns null for null input', () => {
      expect(extractCidFromBlobref(null)).toBeNull()
    })

    it('returns null for undefined input', () => {
      expect(extractCidFromBlobref(undefined)).toBeNull()
    })

    it('handles direct CID string', () => {
      expect(extractCidFromBlobref('bafkreidirect')).toBe('bafkreidirect')
    })

    it('returns null for non-object, non-string input', () => {
      expect(extractCidFromBlobref(123)).toBeNull()
      expect(extractCidFromBlobref(true)).toBeNull()
    })

    it('extracts CID from { ref: CID } structure with toString()', () => {
      const blobref = {
        ref: {
          toString: () => 'bafkreitostring',
        },
      }
      expect(extractCidFromBlobref(blobref)).toBe('bafkreitostring')
    })

    it('ignores toString() if result does not start with baf', () => {
      const blobref = {
        ref: {
          toString: () => 'invalid-cid',
        },
      }
      expect(extractCidFromBlobref(blobref)).toBeNull()
    })

    it('extracts CID from { ref: { $link: cid } } structure', () => {
      const blobref = {
        ref: {
          $link: 'bafkreilinknested',
        },
      }
      expect(extractCidFromBlobref(blobref)).toBe('bafkreilinknested')
    })

    it('extracts CID from { $link: cid } structure', () => {
      const blobref = {
        $link: 'bafkreilink',
      }
      expect(extractCidFromBlobref(blobref)).toBe('bafkreilink')
    })

    it('extracts CID from { cid: string } structure', () => {
      const blobref = {
        cid: 'bafkreicid',
      }
      expect(extractCidFromBlobref(blobref)).toBe('bafkreicid')
    })

    it('returns null for empty object', () => {
      expect(extractCidFromBlobref({})).toBeNull()
    })

    it('returns null for object with non-string $link', () => {
      expect(extractCidFromBlobref({ $link: 123 })).toBeNull()
    })

    it('returns null for object with non-string cid', () => {
      expect(extractCidFromBlobref({ cid: null })).toBeNull()
    })

    it('prefers ref.toString() over $link', () => {
      const blobref = {
        ref: {
          toString: () => 'bafkreifirst',
        },
        $link: 'bafkreisecond',
      }
      expect(extractCidFromBlobref(blobref)).toBe('bafkreifirst')
    })
  })

  describe('getBlobLabelsMap', () => {
    it('returns empty map for null blobs', () => {
      const map = getBlobLabelsMap(null as unknown as undefined)
      expect(map.size).toBe(0)
    })

    it('returns empty map for undefined blobs', () => {
      const map = getBlobLabelsMap(undefined)
      expect(map.size).toBe(0)
    })

    it('returns empty map for empty array', () => {
      const map = getBlobLabelsMap([])
      expect(map.size).toBe(0)
    })

    it('skips blobs without labels', () => {
      const blobs = [
        { blobref: { $link: 'bafkrei1' } },
        { blobref: { $link: 'bafkrei2' }, alt: 'An image' },
      ]
      const map = getBlobLabelsMap(blobs)
      expect(map.size).toBe(0)
    })

    it('skips blobs with empty labels values', () => {
      const blobs = [
        { blobref: { $link: 'bafkrei1' }, labels: { values: [] } },
      ]
      const map = getBlobLabelsMap(blobs)
      expect(map.size).toBe(0)
    })

    it('builds map from blobs with labels', () => {
      const labels = { values: [{ val: 'nudity' }] }
      const blobs = [
        { blobref: { $link: 'bafkrei1' }, labels },
      ]
      const map = getBlobLabelsMap(blobs)
      expect(map.size).toBe(1)
      expect(map.get('bafkrei1')).toBe(labels)
    })

    it('handles multiple blobs with labels', () => {
      const labels1 = { values: [{ val: 'nudity' }] }
      const labels2 = { values: [{ val: 'porn' }] }
      const blobs = [
        { blobref: { $link: 'bafkrei1' }, labels: labels1 },
        { blobref: { $link: 'bafkrei2' } }, // No labels
        { blobref: { $link: 'bafkrei3' }, labels: labels2 },
      ]
      const map = getBlobLabelsMap(blobs)
      expect(map.size).toBe(2)
      expect(map.get('bafkrei1')).toBe(labels1)
      expect(map.get('bafkrei3')).toBe(labels2)
    })

    it('skips blobs where CID cannot be extracted', () => {
      const labels = { values: [{ val: 'nudity' }] }
      const blobs = [
        { blobref: null, labels },
        { blobref: {}, labels },
      ]
      const map = getBlobLabelsMap(blobs)
      expect(map.size).toBe(0)
    })
  })

  describe('getBlobAltMap', () => {
    it('returns empty map for null blobs', () => {
      const map = getBlobAltMap(null as unknown as undefined)
      expect(map.size).toBe(0)
    })

    it('returns empty map for undefined blobs', () => {
      const map = getBlobAltMap(undefined)
      expect(map.size).toBe(0)
    })

    it('returns empty map for empty array', () => {
      const map = getBlobAltMap([])
      expect(map.size).toBe(0)
    })

    it('skips blobs without alt text', () => {
      const blobs = [
        { blobref: { $link: 'bafkrei1' } },
        { blobref: { $link: 'bafkrei2' }, labels: { values: [{ val: 'nudity' }] } },
      ]
      const map = getBlobAltMap(blobs)
      expect(map.size).toBe(0)
    })

    it('builds map from blobs with alt text', () => {
      const blobs = [
        { blobref: { $link: 'bafkrei1' }, alt: 'A beautiful sunset' },
      ]
      const map = getBlobAltMap(blobs)
      expect(map.size).toBe(1)
      expect(map.get('bafkrei1')).toBe('A beautiful sunset')
    })

    it('handles multiple blobs with alt text', () => {
      const blobs = [
        { blobref: { $link: 'bafkrei1' }, alt: 'Image one' },
        { blobref: { $link: 'bafkrei2' } }, // No alt
        { blobref: { $link: 'bafkrei3' }, alt: 'Image three' },
      ]
      const map = getBlobAltMap(blobs)
      expect(map.size).toBe(2)
      expect(map.get('bafkrei1')).toBe('Image one')
      expect(map.get('bafkrei3')).toBe('Image three')
    })

    it('skips blobs where CID cannot be extracted', () => {
      const blobs = [
        { blobref: null, alt: 'Alt text' },
        { blobref: {}, alt: 'More alt' },
      ]
      const map = getBlobAltMap(blobs)
      expect(map.size).toBe(0)
    })
  })

  describe('getLabelWarningText', () => {
    it('returns porn warning for porn label', () => {
      expect(getLabelWarningText(['porn'])).toBe('Adult Content (Explicit)')
    })

    it('returns sexual warning for sexual label', () => {
      expect(getLabelWarningText(['sexual'])).toBe('Sexually Suggestive Content')
    })

    it('returns graphic warning for graphic-media label', () => {
      expect(getLabelWarningText(['graphic-media'])).toBe('Graphic/Disturbing Media')
    })

    it('returns nudity warning for nudity label', () => {
      expect(getLabelWarningText(['nudity'])).toBe('Nudity')
    })

    it('returns generic warning for unknown labels', () => {
      expect(getLabelWarningText([])).toBe('Sensitive Content')
      expect(getLabelWarningText(['unknown' as 'nudity'])).toBe('Sensitive Content')
    })

    it('prioritizes porn over other labels', () => {
      expect(getLabelWarningText(['nudity', 'porn', 'sexual'])).toBe('Adult Content (Explicit)')
    })

    it('prioritizes sexual over graphic-media and nudity', () => {
      expect(getLabelWarningText(['nudity', 'graphic-media', 'sexual'])).toBe('Sexually Suggestive Content')
    })

    it('prioritizes graphic-media over nudity', () => {
      expect(getLabelWarningText(['nudity', 'graphic-media'])).toBe('Graphic/Disturbing Media')
    })
  })

  describe('getLabelValues', () => {
    it('returns empty array for undefined labels', () => {
      expect(getLabelValues(undefined)).toEqual([])
    })

    it('returns empty array for labels without values', () => {
      expect(getLabelValues({} as { values?: { val: string }[] })).toEqual([])
    })

    it('returns empty array for labels with empty values', () => {
      expect(getLabelValues({ values: [] })).toEqual([])
    })

    it('extracts val from each label value', () => {
      const labels = {
        values: [{ val: 'nudity' }, { val: 'sexual' }],
      }
      expect(getLabelValues(labels)).toEqual(['nudity', 'sexual'])
    })

    it('handles single label value', () => {
      const labels = {
        values: [{ val: 'graphic-media' }],
      }
      expect(getLabelValues(labels)).toEqual(['graphic-media'])
    })
  })

  describe('requiresAgeVerification', () => {
    it('returns true for porn label', () => {
      expect(requiresAgeVerification(['porn'])).toBe(true)
    })

    it('returns true for sexual label', () => {
      expect(requiresAgeVerification(['sexual'])).toBe(true)
    })

    it('returns true when porn is among other labels', () => {
      expect(requiresAgeVerification(['nudity', 'porn'])).toBe(true)
    })

    it('returns true when sexual is among other labels', () => {
      expect(requiresAgeVerification(['graphic-media', 'sexual'])).toBe(true)
    })

    it('returns false for nudity alone', () => {
      expect(requiresAgeVerification(['nudity'])).toBe(false)
    })

    it('returns false for graphic-media alone', () => {
      expect(requiresAgeVerification(['graphic-media'])).toBe(false)
    })

    it('returns false for empty labels', () => {
      expect(requiresAgeVerification([])).toBe(false)
    })

    it('returns false for nudity and graphic-media combined', () => {
      expect(requiresAgeVerification(['nudity', 'graphic-media'])).toBe(false)
    })
  })

  describe('CONTENT_LABEL_OPTIONS', () => {
    it('contains all four label types', () => {
      const values = CONTENT_LABEL_OPTIONS.map(opt => opt.value)
      expect(values).toContain('nudity')
      expect(values).toContain('sexual')
      expect(values).toContain('porn')
      expect(values).toContain('graphic-media')
    })

    it('has exactly 4 options', () => {
      expect(CONTENT_LABEL_OPTIONS).toHaveLength(4)
    })

    it('each option has value, label, and description', () => {
      for (const option of CONTENT_LABEL_OPTIONS) {
        expect(option.value).toBeDefined()
        expect(option.label).toBeDefined()
        expect(option.description).toBeDefined()
        expect(typeof option.value).toBe('string')
        expect(typeof option.label).toBe('string')
        expect(typeof option.description).toBe('string')
      }
    })
  })
})
