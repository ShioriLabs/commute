import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExitRef, PinnedTransfer } from 'db/repositories/station-exits'

const getPinnedTransfers = vi.fn<() => Promise<PinnedTransfer[]>>()
vi.mock('db/repositories/station-exits', async (importOriginal) => {
  const original = await importOriginal<typeof import('db/repositories/station-exits')>()
  return { ...original, StationExitRepository: class { getPinnedTransfers = getPinnedTransfers } }
})

const { transferExitResolver, NO_EXITS } = await import('utils/transfer-exits')

const ref = (id: string, name: string | null = null): ExitRef => ({ id, ref: id.split(':')[1]!, name, signs: null })

const row = (over: Partial<PinnedTransfer> = {}): PinnedTransfer => ({
  fromStationId: 'MRTJ-DKA',
  toStationId: 'KCI-SUD',
  fromExit: ref('MRTJ-DKA:A', 'Jl. Thamrin'),
  toExit: ref('KCI-SUD:Utara'),
  ...over
})

describe('transferExitResolver', () => {
  it('returns both exits for the pinned direction', () => {
    const exits = transferExitResolver([row()])('MRTJ-DKA', 'KCI-SUD')
    expect(exits.fromExit?.ref).toBe('A')
    expect(exits.toExit?.ref).toBe('Utara')
  })

  it('swaps the exits for the reverse walk', () => {
    const exits = transferExitResolver([row()])('KCI-SUD', 'MRTJ-DKA')
    expect(exits.fromExit?.id).toBe('KCI-SUD:Utara')
    expect(exits.toExit?.id).toBe('MRTJ-DKA:A')
  })

  it('swaps a one-sided pin too, leaving the other door absent', () => {
    const exits = transferExitResolver([row({ toExit: null })])('KCI-SUD', 'MRTJ-DKA')
    expect(exits.toExit?.id).toBe('MRTJ-DKA:A')
    expect(exits).not.toHaveProperty('fromExit')
  })

  it('prefers a row pinned for the exact direction, and does not borrow the reverse row\'s other door', () => {
    const resolve = transferExitResolver([
      row(),
      row({ fromStationId: 'KCI-SUD', toStationId: 'MRTJ-DKA', fromExit: ref('KCI-SUD:Utara'), toExit: null })
    ])
    const exits = resolve('KCI-SUD', 'MRTJ-DKA')
    expect(exits.fromExit?.id).toBe('KCI-SUD:Utara')
    expect(exits).not.toHaveProperty('toExit')
  })

  it('ignores an exit that belongs to another station, in either direction', () => {
    const resolve = transferExitResolver([row({ toExit: ref('KCI-OTHER:Z') })])
    expect(resolve('MRTJ-DKA', 'KCI-SUD').fromExit?.id).toBe('MRTJ-DKA:A')
    expect(resolve('MRTJ-DKA', 'KCI-SUD')).not.toHaveProperty('toExit')
    // Reversed, the foreign door would have become the fromExit; it must not.
    expect(resolve('KCI-SUD', 'MRTJ-DKA')).not.toHaveProperty('fromExit')
  })

  it('skips a row with no destination station or no surviving exit', () => {
    const resolve = transferExitResolver([
      row({ toStationId: null }),
      row({ fromStationId: 'X', toStationId: 'Y', fromExit: null, toExit: null })
    ])
    expect(resolve('MRTJ-DKA', 'KCI-SUD')).toEqual({})
    expect(resolve('X', 'Y')).toEqual({})
  })

  it('names nothing for an unpinned pair', () => {
    expect(transferExitResolver([row()])('KCI-SUD', 'KCI-BOO')).toEqual({})
    expect(NO_EXITS('A', 'B')).toEqual({})
  })
})

describe('getTransferExitResolver', () => {
  // The module caches its promise per isolate, so each case gets a fresh module.
  beforeEach(() => {
    getPinnedTransfers.mockReset()
    vi.resetModules()
  })
  const load = async () => (await import('utils/transfer-exits')).getTransferExitResolver
  const d1 = {} as D1Database

  it('loads the pins once and shares them across calls', async () => {
    getPinnedTransfers.mockResolvedValue([row()])
    const get = await load()
    const [a, b] = await Promise.all([get(d1), get(d1)])
    expect(a).toBe(b)
    await get(d1)
    expect(getPinnedTransfers).toHaveBeenCalledTimes(1)
    expect(a('MRTJ-DKA', 'KCI-SUD').fromExit?.ref).toBe('A')
  })

  it('does not memoise a failed load, so the next call retries', async () => {
    getPinnedTransfers.mockRejectedValueOnce(new Error('D1 down')).mockResolvedValueOnce([row()])
    const get = await load()
    await expect(get(d1)).rejects.toThrow('D1 down')
    const resolve = await get(d1)
    expect(getPinnedTransfers).toHaveBeenCalledTimes(2)
    expect(resolve('MRTJ-DKA', 'KCI-SUD').fromExit?.ref).toBe('A')
  })
})
