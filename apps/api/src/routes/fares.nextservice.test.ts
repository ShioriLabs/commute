import { describe, expect, it } from 'vitest'
import { loadGraph } from '@commute/tsundere'
import { nextServiceAt } from 'routes/fares'
import { SERVICE_HOURS } from 'db/data/service-hours'

/*
 * Real line codes against the generated SERVICE_HOURS, so these assert the
 * shipped windows rather than a fixture that could drift from them.
 *
 * `9C` closes at 22:00 and reopens at 05:00; `1` is one of the fourteen AMARI
 * corridors that never close.
 */
const edge = (lineCode: string, from: string, to: string, distance = 1000) => ([
  { lineCode, fromStationId: from, toStationId: to, distance },
  { lineCode, fromStationId: to, toStationId: from, distance }
])

const at = (h: number, m = 0) => new Date(`2026-09-07T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`)
const context = (departureAt: Date) => ({ paymentMethod: 'STORED_VALUE' as const, departureAt })

describe('nextServiceAt', () => {
  // A pair reachable only by a daytime corridor.
  const daytimeOnly = loadGraph({ edges: edge('9C', 'TJ-X', 'TJ-Y'), transfers: [] })

  it('reports the next opening when the only corridor is shut', () => {
    const found = nextServiceAt(daytimeOnly, 'TJ-X', 'TJ-Y', context(at(3)))
    expect(found).not.toBeNull()
    // 9C opens at 05:00, and that is the first opening that makes this work.
    expect(found!.departureS).toBe(5 * 3600)
    expect(found!.at.toISOString()).toBe('2026-09-06T22:00:00.000Z') // 05:00 WIB
  })

  /*
   * A pair with no path at all must read as NO_ROUTE rather than pointing at a
   * reopening that will not help, which is why the probe returns null instead
   * of the earliest opening it tried.
   */
  it('returns null when no opening makes the pair routable', () => {
    const disconnected = loadGraph({
      edges: [...edge('9C', 'TJ-X', 'TJ-Y'), ...edge('9C', 'TJ-P', 'TJ-Q')],
      transfers: []
    })
    expect(nextServiceAt(disconnected, 'TJ-X', 'TJ-Q', context(at(3)))).toBeNull()
  })

  // Nothing later today can help once the last opening has passed.
  it('does not wrap into tomorrow', () => {
    expect(nextServiceAt(daytimeOnly, 'TJ-X', 'TJ-Y', context(at(23)))).toBeNull()
  })

  it('is not consulted for a corridor that never closes', () => {
    // Koridor 1 runs [0, 86399], so this pair is routable at 03:00 already and
    // the caller would never ask. Asserted so the window data stays honest.
    expect(SERVICE_HOURS['1']?.ALL).toEqual([0, 86399])
  })
})
