import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  generateEmbedding,
  generateEmbeddings,
  upsertEmbedding,
  upsertEmbeddings,
  deleteEmbeddings,
  deletePostEmbeddings,
  querySimilar,
  getPostEmbeddings,
  reciprocalRankFusion,
  type Ai,
  type VectorizeIndex,
  type EmbeddingMetadata,
} from '../lib/embeddings'

// Mock Workers AI
function createMockAi(overrides: Partial<Ai> = {}): Ai {
  return {
    run: vi.fn().mockImplementation((_model: string, inputs: { text: string[] }) => {
      // Return mock embeddings (1024 dimensions)
      return Promise.resolve({
        data: inputs.text.map(() => new Array(1024).fill(0).map((_, i) => i / 1024)),
      })
    }),
    ...overrides,
  }
}

// Mock Vectorize index
function createMockVectorize(overrides: Partial<VectorizeIndex> = {}): VectorizeIndex {
  const vectors = new Map<string, { values: number[]; metadata: Record<string, unknown> }>()

  return {
    upsert: vi.fn().mockImplementation(async (items) => {
      for (const item of items) {
        vectors.set(item.id, { values: item.values, metadata: item.metadata || {} })
      }
      return { count: items.length, ids: items.map((i: { id: string }) => i.id) }
    }),
    query: vi.fn().mockImplementation(async (_vector, options) => {
      // Return mock results
      const topK = options?.topK || 10
      const matches = Array.from(vectors.entries())
        .slice(0, topK)
        .map(([id, data], idx) => ({
          id,
          score: 1 - idx * 0.1,
          metadata: data.metadata,
        }))
      return { matches, count: matches.length }
    }),
    getByIds: vi.fn().mockImplementation(async (ids) => {
      return ids
        .map((id: string) => {
          const data = vectors.get(id)
          return data ? { id, values: data.values, metadata: data.metadata } : null
        })
        .filter(Boolean)
    }),
    deleteByIds: vi.fn().mockImplementation(async (ids) => {
      let count = 0
      for (const id of ids) {
        if (vectors.delete(id)) count++
      }
      return { count, ids }
    }),
    ...overrides,
  }
}

describe('generateEmbedding', () => {
  it('generates a single embedding', async () => {
    const ai = createMockAi()
    const embedding = await generateEmbedding(ai, 'Hello world')

    expect(ai.run).toHaveBeenCalledWith('@cf/baai/bge-m3', { text: ['Hello world'] })
    expect(embedding).toHaveLength(1024)
  })

  it('truncates long text', async () => {
    const ai = createMockAi()
    const longText = 'a'.repeat(10000)
    await generateEmbedding(ai, longText)

    const call = (ai.run as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[1].text[0].length).toBeLessThanOrEqual(8000)
  })

  it('throws when no embedding returned', async () => {
    const ai = createMockAi({
      run: vi.fn().mockResolvedValue({ data: [] }),
    })

    await expect(generateEmbedding(ai, 'test')).rejects.toThrow('No embedding returned')
  })
})

describe('generateEmbeddings', () => {
  it('generates multiple embeddings', async () => {
    const ai = createMockAi()
    const texts = ['First text', 'Second text', 'Third text']
    const embeddings = await generateEmbeddings(ai, texts)

    expect(embeddings).toHaveLength(3)
    expect(embeddings[0]).toHaveLength(1024)
  })

  it('returns empty array for empty input', async () => {
    const ai = createMockAi()
    const embeddings = await generateEmbeddings(ai, [])

    expect(embeddings).toHaveLength(0)
    expect(ai.run).not.toHaveBeenCalled()
  })

  it('batches large inputs', async () => {
    const ai = createMockAi()
    const texts = new Array(75).fill('test text')
    await generateEmbeddings(ai, texts)

    // Should be called twice: 50 + 25
    expect(ai.run).toHaveBeenCalledTimes(2)
  })
})

describe('upsertEmbedding', () => {
  it('upserts a single embedding', async () => {
    const vectorize = createMockVectorize()
    const metadata: EmbeddingMetadata = {
      uri: 'at://did:plc:test/app.greengale.document/abc123',
      authorDid: 'did:plc:test',
      title: 'Test Post',
    }

    await upsertEmbedding(vectorize, 'test-id', new Array(1024).fill(0.5), metadata)

    expect(vectorize.upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'test-id',
        values: expect.any(Array),
        metadata: expect.objectContaining({
          uri: metadata.uri,
          authorDid: metadata.authorDid,
          title: 'Test Post',
        }),
      }),
    ])
  })

  it('truncates long titles', async () => {
    const vectorize = createMockVectorize()
    const longTitle = 'a'.repeat(200)
    const metadata: EmbeddingMetadata = {
      uri: 'at://test',
      authorDid: 'did:plc:test',
      title: longTitle,
    }

    await upsertEmbedding(vectorize, 'test-id', new Array(1024).fill(0.5), metadata)

    const call = (vectorize.upsert as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0][0].metadata.title.length).toBeLessThanOrEqual(100)
  })

  it('rejects invalid vector dimensions', async () => {
    const vectorize = createMockVectorize()
    const metadata: EmbeddingMetadata = { uri: 'at://test', authorDid: 'did:plc:test' }

    await expect(
      upsertEmbedding(vectorize, 'test-id', new Array(512).fill(0.5), metadata)
    ).rejects.toThrow('Invalid vector dimensions')
  })
})

describe('upsertEmbeddings', () => {
  it('upserts multiple embeddings', async () => {
    const vectorize = createMockVectorize()
    const embeddings = [
      {
        id: 'id1',
        vector: new Array(1024).fill(0.5),
        metadata: { uri: 'at://test1', authorDid: 'did:plc:test' } as EmbeddingMetadata,
      },
      {
        id: 'id2',
        vector: new Array(1024).fill(0.6),
        metadata: { uri: 'at://test2', authorDid: 'did:plc:test' } as EmbeddingMetadata,
      },
    ]

    await upsertEmbeddings(vectorize, embeddings)

    expect(vectorize.upsert).toHaveBeenCalled()
  })

  it('handles empty array', async () => {
    const vectorize = createMockVectorize()
    await upsertEmbeddings(vectorize, [])

    expect(vectorize.upsert).not.toHaveBeenCalled()
  })

  it('rejects invalid vector dimensions', async () => {
    const vectorize = createMockVectorize()
    const embeddings = [
      {
        id: 'id1',
        vector: new Array(512).fill(0.5), // Wrong dimensions
        metadata: { uri: 'at://test1', authorDid: 'did:plc:test' } as EmbeddingMetadata,
      },
    ]

    await expect(upsertEmbeddings(vectorize, embeddings)).rejects.toThrow('Invalid vector dimensions')
  })

  it('batches large inputs', async () => {
    const vectorize = createMockVectorize()
    const embeddings = new Array(150).fill(null).map((_, i) => ({
      id: `id${i}`,
      vector: new Array(1024).fill(0.5),
      metadata: { uri: `at://test${i}`, authorDid: 'did:plc:test' } as EmbeddingMetadata,
    }))

    await upsertEmbeddings(vectorize, embeddings)

    // Should be called twice: 100 + 50
    expect(vectorize.upsert).toHaveBeenCalledTimes(2)
  })
})

describe('deleteEmbeddings', () => {
  it('deletes embeddings by ID', async () => {
    const vectorize = createMockVectorize()
    const count = await deleteEmbeddings(vectorize, ['id1', 'id2'])

    expect(vectorize.deleteByIds).toHaveBeenCalledWith(['id1', 'id2'])
    expect(count).toBeGreaterThanOrEqual(0)
  })

  it('returns 0 for empty array', async () => {
    const vectorize = createMockVectorize()
    const count = await deleteEmbeddings(vectorize, [])

    expect(count).toBe(0)
    expect(vectorize.deleteByIds).not.toHaveBeenCalled()
  })
})

describe('deletePostEmbeddings', () => {
  it('deletes main embedding and chunks', async () => {
    const vectorize = createMockVectorize()
    const uri = 'at://did:plc:test/app.greengale.document/abc123'

    await deletePostEmbeddings(vectorize, uri)

    const call = (vectorize.deleteByIds as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toContain(uri)
    expect(call[0]).toContain(`${uri}:chunk0`)
    expect(call[0]).toContain(`${uri}:chunk19`)
  })
})

describe('querySimilar', () => {
  it('queries for similar vectors', async () => {
    const vectorize = createMockVectorize()
    // Pre-populate with some vectors
    await vectorize.upsert([
      { id: 'post1', values: new Array(1024).fill(0.5), metadata: { uri: 'at://test1' } },
      { id: 'post2', values: new Array(1024).fill(0.6), metadata: { uri: 'at://test2' } },
    ])

    const results = await querySimilar(vectorize, new Array(1024).fill(0.5))

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).toHaveProperty('id')
    expect(results[0]).toHaveProperty('score')
    expect(results[0]).toHaveProperty('metadata')
  })

  it('respects topK option', async () => {
    const vectorize = createMockVectorize()

    await querySimilar(vectorize, new Array(1024).fill(0.5), { topK: 5 })

    expect(vectorize.query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ topK: 5 })
    )
  })

  it('passes filter to query', async () => {
    const vectorize = createMockVectorize()

    await querySimilar(vectorize, new Array(1024).fill(0.5), {
      filter: { authorDid: { $eq: 'did:plc:test' } },
    })

    expect(vectorize.query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        filter: { authorDid: { $eq: 'did:plc:test' } },
      })
    )
  })
})

describe('getPostEmbeddings', () => {
  it('gets single post embedding', async () => {
    const vectorize = createMockVectorize()
    const uri = 'at://test/post'
    await vectorize.upsert([{ id: uri, values: new Array(1024).fill(0.5), metadata: {} }])

    const embeddings = await getPostEmbeddings(vectorize, uri)

    expect(embeddings).toHaveLength(1)
    expect(embeddings[0].id).toBe(uri)
  })

  it('gets chunked post embeddings', async () => {
    const vectorize = createMockVectorize()
    const uri = 'at://test/post'

    // Simulate chunked embeddings (no main, only chunks)
    const mockGetByIds = vi.fn()
      .mockResolvedValueOnce([]) // First call for main URI returns empty
      .mockResolvedValueOnce([ // Second call for chunks
        { id: `${uri}:chunk0`, values: new Array(1024).fill(0.5), metadata: {} },
        { id: `${uri}:chunk1`, values: new Array(1024).fill(0.6), metadata: {} },
      ])

    vectorize.getByIds = mockGetByIds

    const embeddings = await getPostEmbeddings(vectorize, uri)

    expect(mockGetByIds).toHaveBeenCalledTimes(2)
    expect(embeddings).toHaveLength(2)
  })
})

describe('reciprocalRankFusion', () => {
  it('combines multiple rankings', () => {
    const ranking1 = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const ranking2 = [{ id: 'b' }, { id: 'a' }, { id: 'd' }]

    const fused = reciprocalRankFusion([ranking1, ranking2])

    expect(fused.length).toBe(4)
    expect(fused.every(r => r.score > 0)).toBe(true)
  })

  it('ranks items appearing in multiple lists higher', () => {
    const ranking1 = [{ id: 'a' }, { id: 'b' }]
    const ranking2 = [{ id: 'b' }, { id: 'c' }]

    const fused = reciprocalRankFusion([ranking1, ranking2])

    // 'b' appears in both, should rank higher than 'c' which only appears once
    const bIndex = fused.findIndex(r => r.id === 'b')
    const cIndex = fused.findIndex(r => r.id === 'c')
    expect(bIndex).toBeLessThan(cIndex)
  })

  it('respects custom k parameter', () => {
    const ranking1 = [{ id: 'a' }, { id: 'b' }]
    const ranking2 = [{ id: 'a' }, { id: 'c' }]

    const fused1 = reciprocalRankFusion([ranking1, ranking2], 1)
    const fused60 = reciprocalRankFusion([ranking1, ranking2], 60)

    // Different k values should produce different scores (but same order)
    expect(fused1[0].score).not.toBe(fused60[0].score)
  })

  it('handles empty rankings', () => {
    const fused = reciprocalRankFusion([])

    expect(fused).toHaveLength(0)
  })

  it('handles single ranking', () => {
    const ranking = [{ id: 'a' }, { id: 'b' }]
    const fused = reciprocalRankFusion([ranking])

    expect(fused).toHaveLength(2)
    expect(fused[0].id).toBe('a')
    expect(fused[1].id).toBe('b')
  })

  it('preserves order for identical rankings', () => {
    const ranking = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const fused = reciprocalRankFusion([ranking, ranking])

    expect(fused[0].id).toBe('a')
    expect(fused[1].id).toBe('b')
    expect(fused[2].id).toBe('c')
  })
})
