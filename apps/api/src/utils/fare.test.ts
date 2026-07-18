import { describe, expect, it } from 'vitest'
import type { FareContext } from '@commute/constants'
import { calculateSegmentFare, fareTimeBucket, LRTJBDB_FARE_CAP } from 'utils/fare'

const ctx: FareContext = { paymentMethod: 'STORED_VALUE', departureAt: new Date('2026-07-18T08:00:00+07:00') }

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

  it('never exceeds the cap', () => {
    expect(fare('LRTJBDB', 90000)).toBe(LRTJBDB_FARE_CAP)
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

describe('fare context (step 1: no behavioural effect yet)', () => {
  const offpeakWeekend: FareContext = { paymentMethod: 'STORED_VALUE', departureAt: new Date('2026-07-18T14:00:00+07:00') } // Sat
  const jaklingkoPeak: FareContext = { paymentMethod: 'JAKLINGKO', departureAt: new Date('2026-07-20T08:00:00+07:00') } // Mon peak

  it('fare is identical regardless of payment method or departure time', () => {
    for (const args of [['KCI', 54800], ['LRTJBDB', 90000], ['MRTJ', 15700, 'LBB', 'BHI']] as const) {
      const [op, dist, from, to] = args
      expect(fare(op, dist, from, to, offpeakWeekend)).toBe(fare(op, dist, from, to, ctx))
      expect(fare(op, dist, from, to, jaklingkoPeak)).toBe(fare(op, dist, from, to, ctx))
    }
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
