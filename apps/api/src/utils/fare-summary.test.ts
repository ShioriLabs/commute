import { describe, expect, it } from 'vitest'
import type { FareContext } from '@commute/constants'
import { summarizeFares } from 'utils/fare-summary'
import type { RouteLeg } from 'utils/router'

// Default single-tap context; step 1 fares don't depend on it, so a fixed value
// keeps these assertions stable.
const ctx: FareContext = { paymentMethod: 'STORED_VALUE', departureAt: new Date('2026-07-18T08:00:00+07:00') }

const ride = (operator: string, lineCode: string, from: string, to: string, distanceM: number): RouteLeg =>
  ({ type: 'RIDE', operator, lineCode, fromStationId: from, toStationId: to, stationIds: [from, to], distanceM })
const walk = (from: string, to: string, distanceM = 300): RouteLeg =>
  ({ type: 'TRANSFER', fromStationId: from, toStationId: to, distanceM })

describe('summarizeFares', () => {
  it('one fare for a same-operator trip across a line change', () => {
    const s = summarizeFares([ride('KCI', 'C', 'KCI-BKS', 'KCI-MRI', 20000), ride('KCI', 'B', 'KCI-MRI', 'KCI-JAKK', 10000)], ctx)
    expect(s.segments).toHaveLength(1)
    expect(s.segments[0]).toMatchObject({ operator: 'KCI', fromStationId: 'KCI-BKS', toStationId: 'KCI-JAKK', distanceM: 30000, fare: 4000 })
    expect(s.totalFare).toBe(4000)
  })

  it('a walk transfer starts a new fare even within one operator', () => {
    const s = summarizeFares([ride('KCI', 'C', 'KCI-A', 'KCI-B', 10000), walk('KCI-B', 'KCI-C'), ride('KCI', 'T', 'KCI-C', 'KCI-D', 10000)], ctx)
    expect(s.segments).toHaveLength(2)
    expect(s.totalFare).toBe(6000)
    expect(s.transferCount).toBe(1)
  })

  it('cross-operator trip sums both operators, walk distance counted in total distance only', () => {
    const s = summarizeFares([ride('KCI', 'C', 'KCI-BKS', 'KCI-SUDB', 22000), walk('KCI-SUDB', 'MRTJ-DKA', 400), ride('MRTJ', 'M', 'MRTJ-DKA', 'MRTJ-BHI', 800)], ctx)
    expect(s.segments.map(x => x.operator)).toEqual(['KCI', 'MRTJ'])
    expect(s.segments.map(x => x.fare)).toEqual([3000, 3000])
    expect(s.totalFare).toBe(6000)
    expect(s.totalDistanceM).toBe(23200)
  })

  it('null segment fare nulls the total', () => {
    const s = summarizeFares([ride('MRTJ', 'M', 'MRTJ-ZZ', 'MRTJ-QQ', 1000)], ctx)
    expect(s.segments[0]!.fare).toBeNull()
    expect(s.totalFare).toBeNull()
  })
})
