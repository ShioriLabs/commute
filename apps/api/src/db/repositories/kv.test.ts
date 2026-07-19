import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KVRepository } from 'db/repositories/kv'

// Minimal KVNamespace fake — only get/put/delete are exercised.
function makeKV() {
  return {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn()
  }
}

describe('KVRepository with a namespace', () => {
  let kv: ReturnType<typeof makeKV>
  let repo: KVRepository

  beforeEach(() => {
    kv = makeKV()
    repo = new KVRepository(kv as unknown as KVNamespace)
  })

  it('get returns the stored value and reads it as json', async () => {
    kv.get.mockResolvedValue({ hello: 'world' })
    await expect(repo.get('k')).resolves.toEqual({ hello: 'world' })
    expect(kv.get).toHaveBeenCalledWith('k', 'json')
  })

  it('get returns null when the underlying value is null', async () => {
    kv.get.mockResolvedValue(null)
    await expect(repo.get('missing')).resolves.toBe(null)
  })

  it('set stringifies the value with the default TTL and returns the data', async () => {
    const data = { a: 1 }
    await expect(repo.set('k', data)).resolves.toBe(data)
    expect(kv.put).toHaveBeenCalledWith('k', JSON.stringify(data), { expirationTtl: 60 * 60 * 20 })
  })

  it('set honors a custom TTL', async () => {
    await repo.set('k', { a: 1 }, 120)
    expect(kv.put).toHaveBeenCalledWith('k', JSON.stringify({ a: 1 }), { expirationTtl: 120 })
  })

  it('del delegates to kv.delete', async () => {
    await repo.del('k')
    expect(kv.delete).toHaveBeenCalledWith('k')
  })
})

describe('KVRepository without a namespace (undefined kv)', () => {
  const repo = new KVRepository(undefined)

  it('get short-circuits to null', async () => {
    await expect(repo.get('k')).resolves.toBe(null)
  })

  it('set returns the data unchanged without writing', async () => {
    const data = { a: 1 }
    await expect(repo.set('k', data)).resolves.toBe(data)
  })

  it('del is a no-op', async () => {
    await expect(repo.del('k')).resolves.toBeUndefined()
  })
})
