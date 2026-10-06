import { describe, it, expect, vi } from 'vitest'
import { releaseHandleFromOtherAuthors } from '../lib/authors'

describe('releaseHandleFromOtherAuthors', () => {
  function createMockDB() {
    const bind = vi.fn().mockReturnValue('prepared-statement')
    const prepare = vi.fn().mockReturnValue({ bind })
    return { prepare, bind } as unknown as {
      prepare: ReturnType<typeof vi.fn>
      bind: ReturnType<typeof vi.fn>
    }
  }

  it('clears the handle from every author other than the current DID', () => {
    const db = createMockDB()

    releaseHandleFromOtherAuthors(
      db as unknown as D1Database,
      'penny.hailey.at',
      'did:plc:newowner'
    )

    expect(db.prepare).toHaveBeenCalledTimes(1)
    const sql = db.prepare.mock.calls[0][0] as string
    expect(sql).toContain('UPDATE authors')
    expect(sql).toContain('SET handle = NULL')
    expect(sql).toContain('WHERE handle = ? AND did != ?')
    expect(db.bind).toHaveBeenCalledWith('penny.hailey.at', 'did:plc:newowner')
  })

  it('returns the prepared statement for atomic batching', () => {
    const db = createMockDB()

    const statement = releaseHandleFromOtherAuthors(
      db as unknown as D1Database,
      'user.example.com',
      'did:plc:abc'
    )

    expect(statement).toBe('prepared-statement')
  })
})
