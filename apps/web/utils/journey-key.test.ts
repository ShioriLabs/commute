import { describe, expect, it } from 'vitest'
import type { FareJourney, FareResultLeg } from '@commute/schemas'
import { findJourneyByKey, journeyKey } from './journey-key'

const station = (id: string) => ({ id, name: id })

const ride = (line: string, from: string, to: string, departureAt?: string): FareResultLeg => ({
  type: 'RIDE',
  line,
  operator: line.slice(0, line.indexOf(':')) as never,
  from: station(from),
  to: station(to),
  stationCount: 2,
  stops: [station(from), station(to)],
  headsign: null,
  distanceM: 1000,
  ...(departureAt ? { departureAt } : {})
})

const walk = (from: string, to: string): FareResultLeg => ({
  type: 'TRANSFER',
  from: station(from),
  to: station(to),
  distanceM: 310
})

const journey = (legs: FareResultLeg[], arrivalAt?: string): FareJourney => ({
  legs,
  segments: [],
  totalFare: 6500,
  totalDistanceM: 17200,
  transferCount: 1,
  labels: [],
  boardings: legs.filter(l => l.type === 'RIDE').length,
  walkDistanceM: 310,
  ...(arrivalAt ? { arrivalAt } : {})
})

describe('journeyKey', () => {
  it('names a single ride by line code and bare station ids', () => {
    expect(journeyKey(journey([ride('KCI:C', 'KCI-CUK', 'KCI-SUD')])))
      .toBe('C.CUK-SUD')
  })

  it('joins legs and marks the transfer between them', () => {
    const key = journeyKey(journey([
      ride('KCI:C', 'KCI-CUK', 'KCI-SUD'),
      walk('KCI-SUD', 'LRTJBDB-DKA'),
      ride('LRTJBDB:BK', 'LRTJBDB-DKA', 'LRTJBDB-RAS')
    ]))
    expect(key).toBe('C.CUK-SUD~_DKA~BK.DKA-RAS')
  })

  /*
   * The property the whole feature rests on: re-timing the same route must not
   * change its name, or a shared link would break a minute after it was sent.
   */
  it('is identical for two boardings of one route', () => {
    const first = journey([ride('KCI:C', 'KCI-CUK', 'KCI-SUD', '2026-09-07T22:58:00+07:00')])
    const later = journey([ride('KCI:C', 'KCI-CUK', 'KCI-SUD', '2026-09-07T23:05:00+07:00')])
    expect(journeyKey(first)).toBe(journeyKey(later))
  })

  it('separates routes that ride the same lines through different interchanges', () => {
    const viaDukuhAtas = journey([
      ride('KCI:C', 'KCI-CUK', 'KCI-SUD'),
      walk('KCI-SUD', 'LRTJBDB-DKA'),
      ride('LRTJBDB:BK', 'LRTJBDB-DKA', 'LRTJBDB-RAS')
    ])
    const viaSetiabudi = journey([
      ride('KCI:C', 'KCI-CUK', 'KCI-SUD'),
      walk('KCI-SUD', 'LRTJBDB-SET'),
      ride('LRTJBDB:BK', 'LRTJBDB-SET', 'LRTJBDB-RAS')
    ])
    expect(journeyKey(viaDukuhAtas)).not.toBe(journeyKey(viaSetiabudi))
  })

  it('stays URL-safe', () => {
    const key = journeyKey(journey([
      ride('TJ:6', 'TJ-H00283P', 'TJ-H00069P'),
      walk('TJ-H00069P', 'LRTJBDB-RAS')
    ]))
    expect(encodeURIComponent(key)).toBe(key)
  })
})

describe('findJourneyByKey', () => {
  const rows = [
    journey([ride('KCI:C', 'KCI-CUK', 'KCI-SUD')]),
    journey([ride('KCI:B', 'KCI-CUK', 'KCI-MRI')])
  ]

  it('finds the row a key names', () => {
    expect(findJourneyByKey(rows, 'B.CUK-MRI')).toBe(1)
  })

  // Not an error: a route can legitimately vanish between the sender's request
  // and the recipient's, and the caller falls back to the first row.
  it('returns null for a route that is no longer offered', () => {
    expect(findJourneyByKey(rows, 'M.LBB-BHI')).toBeNull()
  })

  it('returns null when no key was shared', () => {
    expect(findJourneyByKey(rows, null)).toBeNull()
  })
})
