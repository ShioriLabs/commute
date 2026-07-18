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

describe('summarizeFares — JakLingko journey cap', () => {
  const jaklingko: FareContext = { paymentMethod: 'JAKLINGKO', departureAt: ctx.departureAt }

  // Integrated multimodal: MRT (LBB→BHI = 14000) → walk → TJ (3500) → walk → TJ
  // (3500). Uncapped 21000 across two participating operators (MRTJ + TJ).
  const integratedJourney = (): RouteLeg[] => [
    ride('MRTJ', 'M', 'MRTJ-LBB', 'MRTJ-BHI', 15700),
    walk('MRTJ-BHI', 'TJ-H1', 400),
    ride('TJ', '1', 'TJ-H1', 'TJ-H2', 5000),
    walk('TJ-H2', 'TJ-H3', 400),
    ride('TJ', '2', 'TJ-H3', 'TJ-H4', 5000)
  ]

  it('caps the participating portion at 10000 under JakLingko', () => {
    const s = summarizeFares(integratedJourney(), jaklingko)
    expect(s.segments.reduce((sum, x) => sum + (x.fare ?? 0), 0)).toBe(21000) // per-segment stays uncapped
    expect(s.totalFare).toBe(10000) // MRTJ+TJ+TJ all integrated → whole thing capped
  })

  it('does not cap the same journey under stored value', () => {
    const s = summarizeFares(integratedJourney(), ctx)
    expect(s.totalFare).toBe(21000)
  })

  it('charges non-integrated legs (KCI) in full on TOP of the capped portion', () => {
    // KCI (54800m = 6000, NOT integrated) → walk → MRT (14000) → walk → TJ (3500).
    // Integrated portion = MRT+TJ = 17500 → capped to 10000; KCI 6000 rides on top.
    const s = summarizeFares([
      ride('KCI', 'C', 'KCI-BOO', 'KCI-SUDB', 54800),
      walk('KCI-SUDB', 'MRTJ-LBB', 400),
      ride('MRTJ', 'M', 'MRTJ-LBB', 'MRTJ-BHI', 15700),
      walk('MRTJ-BHI', 'TJ-H1', 400),
      ride('TJ', '1', 'TJ-H1', 'TJ-H2', 5000)
    ], jaklingko)
    expect(s.totalFare).toBe(6000 + 10000) // KCI full + capped MRT/TJ
  })

  it('does NOT cap a KCI-only journey even split by a walk (KCI not integrated)', () => {
    const s = summarizeFares([
      ride('KCI', 'C', 'KCI-BOO', 'KCI-JAKK', 54800),
      walk('KCI-JAKK', 'KCI-KPB'),
      ride('KCI', 'T', 'KCI-KPB', 'KCI-TNT', 54800)
    ], jaklingko)
    expect(s.totalFare).toBe(12000) // 6000 + 6000, uncapped
  })

  it('does NOT cap a KCI + LRTJBDB journey (neither is integrated)', () => {
    // Both operators sit outside JakLingko, so no cap despite being multimodal.
    // KCI 22000m = 3000; LRTJBDB 90000m off-peak Sat capped at 10000.
    const s = summarizeFares([
      ride('KCI', 'C', 'KCI-BKS', 'KCI-SUDB', 22000),
      walk('KCI-SUDB', 'LRTJBDB-DKA', 400),
      ride('LRTJBDB', 'BK', 'LRTJBDB-DKA', 'LRTJBDB-JATB', 90000)
    ], jaklingko)
    expect(s.totalFare).toBe(13000) // 3000 + 10000, uncapped
  })

  it('does NOT cap a single participating-operator journey (MRT LBB→BHI)', () => {
    // MRT Lebak Bulus → Bundaran HI = 14000, one operator. Integrated fare needs
    // >1 participating mode, so this stays 14000 regardless of card.
    const s = summarizeFares([ride('MRTJ', 'M', 'MRTJ-LBB', 'MRTJ-BHI', 15700)], jaklingko)
    expect(s.totalFare).toBe(14000)
  })

  it('leaves an under-cap integrated journey at its real total', () => {
    // MRT (BHI→DKA = 3000) → walk → TJ (3500) = 6500, integrated but under cap.
    const s = summarizeFares([
      ride('MRTJ', 'M', 'MRTJ-BHI', 'MRTJ-DKA', 800),
      walk('MRTJ-DKA', 'TJ-H1', 400),
      ride('TJ', '1', 'TJ-H1', 'TJ-H2', 5000)
    ], jaklingko)
    expect(s.totalFare).toBe(6500)
  })

  it('preserves null under JakLingko (cap never fabricates a number)', () => {
    const s = summarizeFares([
      ride('NUL', 'X', 'NUL-A', 'NUL-B', 1000),
      walk('NUL-B', 'MRTJ-DKA', 400),
      ride('MRTJ', 'M', 'MRTJ-DKA', 'MRTJ-BHI', 800)
    ], jaklingko)
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
    expect(s.surchargedTransfers[0]).toMatchObject({ fromStationId: 'KCI-SUD', toStationId: 'LRTJBDB-DKA', fare: 1, label: 'Transit berbayar via Peron Sudirman' })
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
