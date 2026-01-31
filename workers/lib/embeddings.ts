/**
 * Embeddings Library
 *
 * Handles embedding generation via Workers AI and vector storage via Vectorize.
 * Uses the bge-m3 model (1024 dimensions) for multilingual support.
 */

// Cloudflare Workers AI types
export interface Ai {
  run(
    model: string,
    inputs: { text: string[] }
  ): Promise<{ data: number[][] }>
}

// Cloudflare Vectorize types
export interface VectorizeIndex {
  upsert(vectors: VectorizeVector[]): Promise<VectorizeVectorMutationResult>
  query(
    vector: number[],
    options?: VectorizeQueryOptions
  ): Promise<VectorizeQueryResult>
  getByIds(ids: string[]): Promise<VectorizeVector[]>
  deleteByIds(ids: string[]): Promise<VectorizeVectorMutationResult>
}

export interface VectorizeVector {
  id: string
  values: number[]
  metadata?: Record<string, VectorizeMetadataValue>
}

export type VectorizeMetadataValue = string | number | boolean

export interface VectorizeQueryOptions {
  topK?: number
  returnValues?: boolean
  returnMetadata?: 'none' | 'indexed' | 'all'
  filter?: Record<string, VectorizeMetadataFilterValue>
}

export type VectorizeMetadataFilterValue =
  | { $eq: string | number | boolean }
  | { $ne: string | number | boolean }

export interface VectorizeQueryResult {
  matches: Array<{
    id: string
    score: number
    values?: number[]
    metadata?: Record<string, VectorizeMetadataValue>
  }>
  count: number
}

export interface VectorizeVectorMutationResult {
  count: number
  ids: string[]
}

// Embedding model configuration
const EMBEDDING_MODEL = '@cf/baai/bge-m3'
const EMBEDDING_DIMENSIONS = 1024
const MAX_TEXT_LENGTH = 8000 // Characters, roughly 2000 tokens

export interface EmbeddingMetadata {
  /** Original post URI (for chunks, this is the parent post) */
  uri: string
  /** Author DID */
  authorDid: string
  /** Post title (truncated) */
  title?: string
  /** Post creation timestamp */
  createdAt?: string
  /** Chunk index (0 for single embeddings or first chunk) */
  chunkIndex?: number
  /** Total chunks for this post */
  totalChunks?: number
  /** Whether this is a chunk (vs whole post) */
  isChunk?: boolean
}

/**
 * Generate embedding for a single text using Workers AI
 */
export async function generateEmbedding(
  ai: Ai,
  text: string
): Promise<number[]> {
  // Truncate if too long
  const truncated = text.slice(0, MAX_TEXT_LENGTH)

  const result = await ai.run(EMBEDDING_MODEL, {
    text: [truncated],
  })

  if (!result.data || result.data.length === 0) {
    throw new Error('No embedding returned from Workers AI')
  }

  return result.data[0]
}

/**
 * Generate embeddings for multiple texts in batch
 * Workers AI supports batching for efficiency
 */
export async function generateEmbeddings(
  ai: Ai,
  texts: string[]
): Promise<number[][]> {
  if (texts.length === 0) {
    return []
  }

  // Truncate all texts
  const truncated = texts.map(t => t.slice(0, MAX_TEXT_LENGTH))

  // Workers AI can handle batches, but we should limit batch size
  const BATCH_SIZE = 50
  const results: number[][] = []

  for (let i = 0; i < truncated.length; i += BATCH_SIZE) {
    const batch = truncated.slice(i, i + BATCH_SIZE)
    const result = await ai.run(EMBEDDING_MODEL, {
      text: batch,
    })

    if (!result.data) {
      throw new Error('No embeddings returned from Workers AI')
    }

    results.push(...result.data)
  }

  return results
}

/**
 * Upsert embedding to Vectorize with metadata
 */
export async function upsertEmbedding(
  vectorize: VectorizeIndex,
  id: string,
  vector: number[],
  metadata: EmbeddingMetadata
): Promise<void> {
  // Validate vector dimensions
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Invalid vector dimensions: expected ${EMBEDDING_DIMENSIONS}, got ${vector.length}`
    )
  }

  // Convert metadata to Vectorize-compatible format
  const vectorizeMetadata: Record<string, VectorizeMetadataValue> = {
    uri: metadata.uri,
    authorDid: metadata.authorDid,
  }

  if (metadata.title) {
    vectorizeMetadata.title = metadata.title.slice(0, 100)
  }
  if (metadata.createdAt) {
    vectorizeMetadata.createdAt = metadata.createdAt
  }
  if (metadata.chunkIndex !== undefined) {
    vectorizeMetadata.chunkIndex = metadata.chunkIndex
  }
  if (metadata.totalChunks !== undefined) {
    vectorizeMetadata.totalChunks = metadata.totalChunks
  }
  if (metadata.isChunk !== undefined) {
    vectorizeMetadata.isChunk = metadata.isChunk
  }

  await vectorize.upsert([
    {
      id,
      values: vector,
      metadata: vectorizeMetadata,
    },
  ])
}

/**
 * Upsert multiple embeddings to Vectorize
 */
export async function upsertEmbeddings(
  vectorize: VectorizeIndex,
  embeddings: Array<{
    id: string
    vector: number[]
    metadata: EmbeddingMetadata
  }>
): Promise<void> {
  if (embeddings.length === 0) return

  // Validate all vector dimensions
  for (const e of embeddings) {
    if (e.vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Invalid vector dimensions for ${e.id}: expected ${EMBEDDING_DIMENSIONS}, got ${e.vector.length}`
      )
    }
  }

  // Vectorize batch limit
  const BATCH_SIZE = 100

  for (let i = 0; i < embeddings.length; i += BATCH_SIZE) {
    const batch = embeddings.slice(i, i + BATCH_SIZE)

    const vectors: VectorizeVector[] = batch.map(e => ({
      id: e.id,
      values: e.vector,
      metadata: {
        uri: e.metadata.uri,
        authorDid: e.metadata.authorDid,
        ...(e.metadata.title && { title: e.metadata.title.slice(0, 100) }),
        ...(e.metadata.createdAt && { createdAt: e.metadata.createdAt }),
        ...(e.metadata.chunkIndex !== undefined && {
          chunkIndex: e.metadata.chunkIndex,
        }),
        ...(e.metadata.totalChunks !== undefined && {
          totalChunks: e.metadata.totalChunks,
        }),
        ...(e.metadata.isChunk !== undefined && { isChunk: e.metadata.isChunk }),
      },
    }))

    await vectorize.upsert(vectors)
  }
}

/**
 * Delete embeddings from Vectorize by IDs
 */
export async function deleteEmbeddings(
  vectorize: VectorizeIndex,
  ids: string[]
): Promise<number> {
  if (ids.length === 0) return 0

  // Vectorize batch limit for deletes
  const BATCH_SIZE = 100
  let totalDeleted = 0

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE)
    const result = await vectorize.deleteByIds(batch)
    totalDeleted += result.count
  }

  return totalDeleted
}

/**
 * Delete all embeddings for a post (including chunks)
 */
export async function deletePostEmbeddings(
  vectorize: VectorizeIndex,
  postUri: string,
  maxChunks: number = 20
): Promise<number> {
  // Generate all possible IDs for this post
  const ids = [postUri]
  for (let i = 0; i < maxChunks; i++) {
    ids.push(`${postUri}:chunk${i}`)
  }

  return deleteEmbeddings(vectorize, ids)
}

/**
 * Query for similar vectors
 */
export async function querySimilar(
  vectorize: VectorizeIndex,
  vector: number[],
  options: {
    topK?: number
    filter?: Record<string, VectorizeMetadataFilterValue>
  } = {}
): Promise<
  Array<{
    id: string
    score: number
    metadata: Record<string, VectorizeMetadataValue>
  }>
> {
  const { topK = 10, filter } = options

  const result = await vectorize.query(vector, {
    topK,
    returnMetadata: 'all',
    filter,
  })

  return result.matches.map(m => ({
    id: m.id,
    score: m.score,
    metadata: m.metadata || {},
  }))
}

/**
 * Get post's embedding(s) by URI
 */
export async function getPostEmbeddings(
  vectorize: VectorizeIndex,
  postUri: string
): Promise<VectorizeVector[]> {
  // Try to get the single embedding first
  const single = await vectorize.getByIds([postUri])
  if (single.length > 0) {
    return single
  }

  // Try chunks
  const chunkIds = Array.from({ length: 20 }, (_, i) => `${postUri}:chunk${i}`)
  const chunks = await vectorize.getByIds(chunkIds)
  return chunks.filter(c => c.values && c.values.length > 0)
}

/**
 * Reciprocal Rank Fusion for combining multiple rankings
 * Used for hybrid search (combining keyword and semantic results)
 *
 * @param rankings Array of ranked result lists
 * @param k RRF constant (typically 60)
 */
export function reciprocalRankFusion(
  rankings: Array<Array<{ id: string; score?: number }>>,
  k: number = 60
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>()

  for (const ranking of rankings) {
    for (let rank = 0; rank < ranking.length; rank++) {
      const { id } = ranking[rank]
      const currentScore = scores.get(id) || 0
      scores.set(id, currentScore + 1 / (k + rank + 1))
    }
  }

  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
}
