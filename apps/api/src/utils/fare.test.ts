import { describe, expect, it } from 'vitest'
import type { FareContext } from '@commute/constants'
import { calculateSegmentFare, calculateTransferFare, fareTimeBucket, LRTJBDB_FARE_CAP_OFFPEAK, LRTJBDB_FARE_CAP_PEAK, resolveCorridorMerges } from 'utils/fare'
import type { RouteLeg } from 'utils/router'

const ctx: FareContext = { paymentMethod: 'STORED_VALUE', departureAt: new Date('2026-07-18T08:00:00+07:00') }
// LRTJBDB cap depends on the time bucket, so pin explicit peak/off-peak contexts
// rather than relying on ctx's day (2026-07-18 is a Saturday → off-peak).
const peakCtx: FareContext = { paymentMethod: 'STORED_VALUE', departureAt: new Date('2026-07-20T08:00:00+07:00') } // Mon 08:00 WIB
const offpeakCtx: FareContext = { paymentMethod: 'STORED_VALUE', departureAt: new Date('2026-07-20T12:00:00+07:00') } // Mon 12:00 WIB

// Wraps calculateSegmentFare with a fixed default context so per-call fares are
// unaffected by context in step 1.
const fare = (operator: string, distanceM: number, from = 'X', to = 'Y', context: FareContext = ctx) =>
  calculateSegmentFare({ operator, distanceM, fromStationCode: from, toStationCode: to } as Parameters<typeof calculateSegmentFare>[0], context)

describe('KCI progressive fare', () => {
  it('charges the base fare up to exactly 25 km', () => {
    expect(fare('KCI', 1000)).toBe(3000)
    expect(fare('KCI', 25000)).toBe(3000)
  })

  it('adds 1000 per started 10 km block past 25 km', () => {
    expect(fare('KCI', 25001)).toBe(4000)
    expect(fare('KCI', 35000)).toBe(4000)
    expect(fare('KCI', 54800)).toBe(6000) // Bogor-Jakarta Kota
  })
})

describe('LRTJ flat fare', () => {
  it('is 5000 regardless of distance', () => {
    expect(fare('LRTJ', 12000)).toBe(5000)
  })
})

describe('LRTJBDB distance fare with cap', () => {
  it('charges 5000 for the first km', () => {
    expect(fare('LRTJBDB', 900)).toBe(5000)
  })

  it('adds 700 per started km after the first', () => {
    expect(fare('LRTJBDB', 2500)).toBe(6400) // 5000 + 2*700
  })

  it('caps at the peak ceiling during peak hours', () => {
    expect(fare('LRTJBDB', 90000, 'X', 'Y', peakCtx)).toBe(LRTJBDB_FARE_CAP_PEAK) // 20000
  })

  it('caps at the lower off-peak ceiling off-peak', () => {
    expect(fare('LRTJBDB', 90000, 'X', 'Y', offpeakCtx)).toBe(LRTJBDB_FARE_CAP_OFFPEAK) // 10000
  })

  it('below both caps, the fare is the same regardless of time (only the ceiling moves)', () => {
    expect(fare('LRTJBDB', 2500, 'X', 'Y', peakCtx)).toBe(6400)
    expect(fare('LRTJBDB', 2500, 'X', 'Y', offpeakCtx)).toBe(6400)
  })
})

describe('MRTJ matrix fare', () => {
  it('returns the matrix value for a known pair', () => {
    expect(fare('MRTJ', 15700, 'LBB', 'BHI')).toBe(14000)
  })

  it('is direction-agnostic', () => {
    expect(fare('MRTJ', 15700, 'BHI', 'LBB')).toBe(14000)
    expect(fare('MRTJ', 800, 'DKA', 'BHI')).toBe(3000)
    expect(fare('MRTJ', 800, 'BHI', 'DKA')).toBe(3000)
  })

  it('returns null for codes missing from the matrix', () => {
    expect(fare('MRTJ', 1000, 'ZZ', 'QQ')).toBeNull()
  })
})

describe('unknown operator', () => {
  it('returns null instead of guessing', () => {
    expect(fare('NUL', 1000)).toBeNull()
  })
})

describe('fare context (payment method inert; departure time affects LRT cap)', () => {
  const offpeakWeekend: FareContext = { paymentMethod: 'STORED_VALUE', departureAt: new Date('2026-07-18T14:00:00+07:00') } // Sat
  const jaklingkoPeak: FareContext = { paymentMethod: 'JAKLINGKO', departureAt: new Date('2026-07-20T08:00:00+07:00') } // Mon peak

  it('KCI and MRTJ fares are unaffected by payment method or departure time', () => {
    // LRTJBDB is intentionally excluded — its cap is now time-dependent (see above).
    for (const args of [['KCI', 54800], ['MRTJ', 15700, 'LBB', 'BHI']] as const) {
      const [op, dist, from, to] = args
      expect(fare(op, dist, from, to, offpeakWeekend)).toBe(fare(op, dist, from, to, ctx))
      expect(fare(op, dist, from, to, jaklingkoPeak)).toBe(fare(op, dist, from, to, ctx))
    }
  })

  it('payment method alone does not change the LRT cap (only time does)', () => {
    // Same peak instant, differing only in payment method → identical until step 4.
    const storedValuePeak: FareContext = { paymentMethod: 'STORED_VALUE', departureAt: jaklingkoPeak.departureAt }
    expect(fare('LRTJBDB', 90000, 'X', 'Y', jaklingkoPeak)).toBe(fare('LRTJBDB', 90000, 'X', 'Y', storedValuePeak))
  })
})

describe('fareTimeBucket', () => {
  it('is peak on weekday morning/evening windows (WIB)', () => {
    expect(fareTimeBucket(new Date('2026-07-20T08:00:00+07:00'))).toBe('peak') // Mon 08:00
    expect(fareTimeBucket(new Date('2026-07-20T17:30:00+07:00'))).toBe('peak') // Mon 17:30
  })

  it('is off-peak midday, late night, and weekends', () => {
    expect(fareTimeBucket(new Date('2026-07-20T12:00:00+07:00'))).toBe('offpeak') // Mon midday
    expect(fareTimeBucket(new Date('2026-07-20T22:00:00+07:00'))).toBe('offpeak') // Mon night
    expect(fareTimeBucket(new Date('2026-07-18T08:00:00+07:00'))).toBe('offpeak') // Sat morning
  })
})

describe('calculateTransferFare (Dukuh Atas priced corridor)', () => {
  const at = new Date('2026-07-20T08:00:00+07:00')
  const withMethod = (paymentMethod: FareContext['paymentMethod']): FareContext => ({ paymentMethod, departureAt: at })

  it('charges Rp1 for card taps (stored value / JakLingko)', () => {
    expect(calculateTransferFare('KCI-SUD', 'LRTJBDB-DKA', withMethod('STORED_VALUE'))?.fare).toBe(1)
    expect(calculateTransferFare('KCI-SUD', 'LRTJBDB-DKA', withMethod('JAKLINGKO'))?.fare).toBe(1)
  })

  it('charges the full Rp3000 for QRIS Tap (vendor can\'t apply the discount)', () => {
    expect(calculateTransferFare('KCI-SUD', 'LRTJBDB-DKA', withMethod('QRIS_TAP'))?.fare).toBe(3000)
  })

  it('is direction-agnostic', () => {
    expect(calculateTransferFare('LRTJBDB-DKA', 'KCI-SUD', withMethod('STORED_VALUE'))?.fare).toBe(1)
    expect(calculateTransferFare('LRTJBDB-DKA', 'KCI-SUD', withMethod('QRIS_TAP'))?.fare).toBe(3000)
  })

  it('carries the corridor label', () => {
    expect(calculateTransferFare('KCI-SUD', 'LRTJBDB-DKA', withMethod('STORED_VALUE'))?.corridor.label).toBe('Transit berbayar via Peron Sudirman')
  })

  it('returns null for an ordinary (free) walking transfer', () => {
    // MRT↔KCI Sudirman is a free walk, not the paid corridor.
    expect(calculateTransferFare('MRTJ-DKA', 'KCI-SUD', withMethod('STORED_VALUE'))).toBeNull()
    expect(calculateTransferFare('KCI-BKS', 'KCI-JAKK', withMethod('QRIS_TAP'))).toBeNull()
  })
})

describe('calculateTransferFare — Sudirman passerby surcharge', () => {
  const ctx: FareContext = { paymentMethod: 'STORED_VALUE', departureAt: new Date('2026-07-20T08:00:00+07:00') }
  const rideLeg = (operator: string, from: string, to: string): RouteLeg =>
    ({ type: 'RIDE', operator, lineCode: 'X', fromStationId: from, toStationId: to, stationIds: [from, to], distanceM: 1000 })
  const walkLeg = (from: string, to: string): RouteLeg =>
    ({ type: 'TRANSFER', fromStationId: from, toStationId: to, distanceM: 300 })

  it('drops the surcharge when a KCI ride arrives at KCI-SUD before the corridor (Kranji shape)', () => {
    // [KCI ride ->KCI-SUD] [corridor KCI-SUD->LRT DKA]: transfer.from is the gate, prev is the KCI ride.
    const surcharge = calculateTransferFare('KCI-SUD', 'LRTJBDB-DKA', ctx, { prev: rideLeg('KCI', 'KCI-KRI', 'KCI-SUD'), next: null })
    expect(surcharge).toBeNull()
  })

  it('drops the surcharge in the reverse direction when a KCI ride departs KCI-SUD after the corridor', () => {
    // [corridor LRT DKA->KCI-SUD] [KCI ride KCI-SUD->...]: transfer.to is the gate, next is the KCI ride.
    const surcharge = calculateTransferFare('LRTJBDB-DKA', 'KCI-SUD', ctx, { prev: null, next: rideLeg('KCI', 'KCI-SUD', 'KCI-KRI') })
    expect(surcharge).toBeNull()
  })

  it('still charges when the approach to KCI-SUD is a walk, not a KCI ride (MRT passerby)', () => {
    // [MRT ride] [walk MRTJ-DKA->KCI-SUD] [corridor KCI-SUD->LRT DKA]: prev of the corridor is the WALK.
    const surcharge = calculateTransferFare('KCI-SUD', 'LRTJBDB-DKA', ctx, { prev: walkLeg('MRTJ-DKA', 'KCI-SUD'), next: null })
    expect(surcharge?.fare).toBe(1)
  })

  it('still charges for a non-KCI ride at the gate', () => {
    // An MRT ride touching KCI-SUD (hypothetical) is not the through operator.
    const surcharge = calculateTransferFare('KCI-SUD', 'LRTJBDB-DKA', ctx, { prev: rideLeg('MRTJ', 'MRTJ-DKA', 'KCI-SUD'), next: null })
    expect(surcharge?.fare).toBe(1)
  })

  it('still charges when the KCI ride is on the far (non-gated) side of the transfer', () => {
    // A KCI ride sitting as `next` while the gate is the transfer's `from` must be ignored.
    const surcharge = calculateTransferFare('KCI-SUD', 'LRTJBDB-DKA', ctx, { prev: walkLeg('MRTJ-DKA', 'KCI-SUD'), next: rideLeg('KCI', 'LRTJBDB-DKA', 'X') })
    expect(surcharge?.fare).toBe(1)
  })
})

describe('resolveCorridorMerges', () => {
  const ctx: FareContext = { paymentMethod: 'STORED_VALUE', departureAt: new Date('2026-07-20T08:00:00+07:00') }
  const ride = (operator: string, from: string, to: string): RouteLeg =>
    ({ type: 'RIDE', operator, lineCode: 'X', fromStationId: from, toStationId: to, stationIds: [from, to], distanceM: 5000 })
  const walk = (from: string, to: string, distanceM: number): RouteLeg =>
    ({ type: 'TRANSFER', fromStationId: from, toStationId: to, distanceM })

  it('merges a surcharged corridor + chained free walk (Setiabudi → GI shape)', () => {
    // LRT ride → [corridor LRTJBDB-DKA→KCI-SUD, Rp1] → [free walk KCI-SUD→MRTJ-DKA] → MRT ride
    const legs: RouteLeg[] = [
      ride('LRTJBDB', 'LRTJBDB-SET', 'LRTJBDB-DKA'),
      walk('LRTJBDB-DKA', 'KCI-SUD', 310), // corridor (surcharged)
      walk('KCI-SUD', 'MRTJ-DKA', 90), // free walk
      ride('MRTJ', 'MRTJ-DKA', 'MRTJ-BHI')
    ]
    const merges = resolveCorridorMerges(legs, ctx)
    const anchor = merges.get(1)
    expect(anchor?.kind).toBe('MERGE_ANCHOR')
    if (anchor?.kind === 'MERGE_ANCHOR') {
      expect(anchor.fromStationId).toBe('LRTJBDB-DKA') // outer end of corridor
      expect(anchor.toStationId).toBe('MRTJ-DKA') // outer end of free walk
      expect(anchor.distanceM).toBe(310 + 90 + 140) // + internal peron walk
      expect(anchor.fare).toBe(1)
    }
    expect(merges.get(2)).toEqual({ kind: 'ABSORBED' })
  })

  it('does not merge a lone surcharged corridor with no adjacent free walk', () => {
    // ...→ [corridor KCI-SUD→LRTJBDB-DKA] end (routing to LRT DKA itself)
    const legs: RouteLeg[] = [
      ride('KCI', 'KCI-BKS', 'KCI-SUD'), // waiver would apply here → not surcharged anyway
      walk('KCI-SUD', 'LRTJBDB-DKA', 310)
    ]
    expect(resolveCorridorMerges(legs, ctx).size).toBe(0)
  })

  it('does not merge when the corridor is waived (through-rider, no fee)', () => {
    // KCI ride into KCI-SUD → corridor: waived, so nothing to merge even if a walk followed.
    const legs: RouteLeg[] = [
      ride('KCI', 'KCI-KRI', 'KCI-SUD'),
      walk('KCI-SUD', 'LRTJBDB-DKA', 310), // corridor, but waived (prev is KCI ride)
      ride('LRTJBDB', 'LRTJBDB-DKA', 'LRTJBDB-RAS')
    ]
    expect(resolveCorridorMerges(legs, ctx).size).toBe(0)
  })

  it('does not merge an ordinary free walk with no corridor', () => {
    const legs: RouteLeg[] = [ride('KCI', 'KCI-A', 'KCI-B'), walk('KCI-B', 'KCI-C', 200), ride('KCI', 'KCI-C', 'KCI-D')]
    expect(resolveCorridorMerges(legs, ctx).size).toBe(0)
  })
})
