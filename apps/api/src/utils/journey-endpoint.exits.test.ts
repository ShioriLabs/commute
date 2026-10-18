import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { FareContext } from '@commute/constants'
import type { Tsundere } from '@commute/tsundere'

const kvSet = vi.fn()
const getResolver = vi.fn()

vi.mock('db/repositories/kv', () => ({
  KVRepository: class {
    get = async () => null
    set = kvSet
  }
}))
vi.mock('db/repositories/stations', () => ({
  StationRepository: class {
    getByIds = async (ids: string[]) => ids.map(id => ({ id, name: id }))
  }
}))
vi.mock('utils/transfer-exits', async (importOriginal) => {
  const original = await importOriginal<typeof import('utils/transfer-exits')>()
  return { ...original, getTransferExitResolver: getResolver }
})

const { handleJourneyRequest } = await import('utils/journey-endpoint')
const { NO_EXITS } = await import('utils/transfer-exits')

const context = { paymentMethod: 'STORED_VALUE', departureAt: new Date('2026-07-20T08:00:00+07:00') } as unknown as FareContext

/*
 * Doors are decoration. A failed load must not sink a journey that was already
 * routed, and the body it produces must not be frozen for the usual 20 hours or
 * the missing doors would outlive the outage.
 */
describe('handleJourneyRequest transferExits', () => {
  const run = async (built: (tools: { transferExits: () => Promise<unknown> }) => Promise<unknown>) => {
    const app = new Hono<{ Bindings: never }>()
    app.get('/:from/:to', c => handleJourneyRequest(
      c as never,
      async () => ({}) as Tsundere,
      () => context,
      { keyPrefix: 'trips', build: built as never }
    ))
    const waitUntil = vi.fn()
    const res = await app.request('/KCI-SUD/MRTJ-DKA', {}, { DB: {}, KV: {}, API_VERSION: 'v1' }, { waitUntil, passThroughException: () => {} } as never)
    return { res, waitUntil }
  }

  beforeEach(() => {
    kvSet.mockReset().mockResolvedValue(undefined)
    getResolver.mockReset()
  })

  it('answers with no doors, not a 500, when the pins cannot be loaded', async () => {
    getResolver.mockRejectedValue(new Error('D1 down'))
    let resolver: unknown
    const { res } = await run(async ({ transferExits }) => {
      resolver = await transferExits()
      return { journeys: [] }
    })
    expect(res.status).toBe(200)
    expect(resolver).toBe(NO_EXITS)
  })

  it('caches that degraded body briefly, and a healthy one for the default 20 hours', async () => {
    getResolver.mockRejectedValue(new Error('D1 down'))
    await run(async ({ transferExits }) => {
      await transferExits()
      return { journeys: [] }
    })
    expect(kvSet).toHaveBeenCalledTimes(1)
    expect(kvSet.mock.calls[0]![2]).toBe(5 * 60)

    kvSet.mockClear()
    getResolver.mockResolvedValue(NO_EXITS)
    await run(async ({ transferExits }) => {
      await transferExits()
      return { journeys: [] }
    })
    expect(kvSet).toHaveBeenCalledTimes(1)
    expect(kvSet.mock.calls[0]).toHaveLength(2) // no ttl argument: the 20 h default
  })

  it('never loads the pins for an endpoint that does not ask, as /fares does', async () => {
    await run(async () => ({ journeys: [] }))
    expect(getResolver).not.toHaveBeenCalled()
  })
})
