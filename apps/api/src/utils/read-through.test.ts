import { describe, expect, it, vi } from 'vitest'
import { readThrough } from 'utils/read-through'

function ctx(stored: Record<string, unknown> = {}) {
  const puts: Array<[string, string]> = []
  const pending: Promise<unknown>[] = []
  const c = {
    env: {
      KV: {
        get: async (k: string) => (k in stored ? stored[k] : null),
        put: async (k: string, v: string) => { puts.push([k, v]) }
      }
    },
    executionCtx: { waitUntil: (p: Promise<unknown>) => { pending.push(p) } },
    json: (body: unknown, status: number) => new Response(JSON.stringify(body), { status })
  }
  return { c: c as never, puts, settle: () => Promise.all(pending) }
}

describe('readThrough', () => {
  it('serves the cached value without loading', async () => {
    const { c } = ctx({ k: [1] })
    const load = vi.fn()
    const res = await readThrough(c, 'k', load)
    expect(load).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ status: 200, data: [1] })
  })

  it('loads on a miss and writes the result back', async () => {
    const { c, puts, settle } = ctx()
    const res = await readThrough(c, 'k', async () => ['a'])
    await settle()
    expect(await res.json()).toEqual({ status: 200, data: ['a'] })
    expect(puts).toEqual([['k', '["a"]']])
  })

  it('passes a returned Response through and does not cache it', async () => {
    const { c, puts, settle } = ctx()
    const res = await readThrough(c, 'k', async () => new Response('nope', { status: 404 }))
    await settle()
    expect(res.status).toBe(404)
    expect(puts).toEqual([])
  })

  it('skips the write when shouldCache says no', async () => {
    const { c, puts, settle } = ctx()
    const res = await readThrough(c, 'k', async () => [] as number[], v => v.length > 0)
    await settle()
    expect(await res.json()).toEqual({ status: 200, data: [] })
    expect(puts).toEqual([])
  })
})
