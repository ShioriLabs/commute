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

describe('summarizeFares — Dukuh Atas priced corridor', () => {
  // MRT → free walk → paid corridor (KCI-SUD↔LRTJBDB-DKA) → LRT.
  // MRT DKA→BHI = 3000; LRTJBDB 900m (off-peak Sat) = 5000.
  const corridorJourney = (): RouteLeg[] => [
    ride('MRTJ', 'M', 'MRTJ-BHI', 'MRTJ-DKA', 800),
    walk('MRTJ-DKA', 'KCI-SUD', 90), // free
    walk('KCI-SUD', 'LRTJBDB-DKA', 310), // paid corridor
    ride('LRTJBDB', 'BK', 'LRTJBDB-DKA', 'LRTJBDB-SET', 900)
  ]

  it('adds Rp1 for card taps on top of the ride fares', () => {
    const s = summarizeFares(corridorJourney(), { paymentMethod: 'STORED_VALUE', departureAt: ctx.departureAt })
    expect(s.surchargedTransfers).toHaveLength(1)
    expect(s.surchargedTransfers[0]).toMatchObject({ fromStationId: 'KCI-SUD', toStationId: 'LRTJBDB-DKA', fare: 1, label: 'Transit via Peron Stasiun Sudirman' })
    expect(s.totalFare).toBe(3000 + 5000 + 1) // MRT + LRT + corridor
    expect(s.transferCount).toBe(2) // both walks still count as transfers
  })

  it('adds Rp3000 for QRIS Tap instead of Rp1', () => {
    const s = summarizeFares(corridorJourney(), { paymentMethod: 'QRIS_TAP', departureAt: ctx.departureAt })
    expect(s.surchargedTransfers[0]!.fare).toBe(3000)
    expect(s.totalFare).toBe(3000 + 5000 + 3000)
  })

  it('leaves ordinary free-walk journeys with no priced transfers', () => {
    const s = summarizeFares([ride('KCI', 'C', 'KCI-A', 'KCI-B', 10000), walk('KCI-B', 'KCI-C'), ride('KCI', 'T', 'KCI-C', 'KCI-D', 10000)], ctx)
    expect(s.surchargedTransfers).toHaveLength(0)
    expect(s.totalFare).toBe(6000) // unchanged from the free-walk test above
  })

  it('drops the surcharge when the rider transits KCI-SUD by KCI train (Kranji → LRT shape)', () => {
    // KCI ride into KCI-SUD → corridor → LRT ride: already inside Sudirman's
    // gates, so no passerby surcharge. KCI 17500m = 3000; LRTJBDB 900m off-peak = 5000.
    const s = summarizeFares([
      ride('KCI', 'C', 'KCI-KRI', 'KCI-SUD', 17500),
      walk('KCI-SUD', 'LRTJBDB-DKA', 310), // corridor, but no surcharge (prev is a KCI ride)
      ride('LRTJBDB', 'BK', 'LRTJBDB-DKA', 'LRTJBDB-RAS', 900)
    ], { paymentMethod: 'STORED_VALUE', departureAt: ctx.departureAt })
    expect(s.surchargedTransfers).toHaveLength(0)
    expect(s.totalFare).toBe(3000 + 5000) // no corridor fee
    expect(s.transferCount).toBe(1)
  })
})
