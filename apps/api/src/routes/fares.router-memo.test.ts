import { describe, expect, it, vi } from 'vitest'

/*
 * A publish changes transfers, and transfers are baked into the graph, so the
 * per-isolate router must rebuild when the data version moves, and only then.
 */
const getGraphInputs = vi.fn(async () => ({ edges: [], transfers: [] }))
vi.mock('db/repositories/edges', () => ({
  EdgeRepository: class { getGraphInputs = getGraphInputs }
}))

const { getRouter } = await import('routes/fares')

describe('getRouter memo', () => {
  it('reuses the graph for the same version and rebuilds on a new one', async () => {
    const d1 = {} as D1Database
    const a = await getRouter(d1, 'v1.0')
    const b = await getRouter(d1, 'v1.0')
    expect(b).toBe(a)
    expect(getGraphInputs).toHaveBeenCalledTimes(1)

    const c = await getRouter(d1, 'v1.p1')
    expect(c).not.toBe(a)
    expect(getGraphInputs).toHaveBeenCalledTimes(2)
  })
})
