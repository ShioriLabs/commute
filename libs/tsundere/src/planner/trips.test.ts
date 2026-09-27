import { describe, expect, it } from 'vitest'
import { buildTripIndex, nextTrip, type TripPattern } from './trips'

const at = (h: number, m = 0) => h * 3600 + m * 60

/** WD|SAT|SUN, matching the mask apps/api passes. The engine never reads the bits. */
const WD = 0b100
const SAT = 0b010
const ALL_DAYS = 0b111

const pattern = (overrides: Partial<TripPattern> = {}): TripPattern => ({
  lineCode: 'M',
  stationIds: ['MRTJ-LBB', 'MRTJ-FTM', 'MRTJ-BLA'],
  trips: [
    { id: 'a', dayMask: ALL_DAYS, departuresS: [at(6), at(6, 10), at(6, 20)] },
    { id: 'b', dayMask: ALL_DAYS, departuresS: [at(7), at(7, 10), at(7, 20)] }
  ],
  ...overrides
})

describe('buildTripIndex', () => {
  it('indexes patterns by stop and by line', () => {
    const index = buildTripIndex([pattern()])

    expect(index.patterns).toHaveLength(1)
    expect(index.tripCount).toBe(2)
    expect(index.byStop.get('MRTJ-FTM')).toHaveLength(1)
    expect(index.byLine.get('M')).toHaveLength(1)
    expect(index.byStop.get('MRTJ-NOPE')).toBeUndefined()
  })

  it('records each stop position for O(1) lookup', () => {
    const [indexed] = buildTripIndex([pattern()]).patterns

    expect(indexed!.stopIndex.get('MRTJ-LBB')).toBe(0)
    expect(indexed!.stopIndex.get('MRTJ-BLA')).toBe(2)
  })

  it('sorts trips by their first departure', () => {
    const index = buildTripIndex([pattern({
      trips: [
        { id: 'late', dayMask: ALL_DAYS, departuresS: [at(9), at(9, 10), at(9, 20)] },
        { id: 'early', dayMask: ALL_DAYS, departuresS: [at(5), at(5, 10), at(5, 20)] }
      ]
    })])

    expect(index.patterns[0]!.trips.map(t => t.id)).toEqual(['early', 'late'])
  })

  it('groups two patterns on one line under that line', () => {
    const index = buildTripIndex([
      pattern(),
      pattern({ stationIds: ['MRTJ-LBB', 'MRTJ-FTM'], trips: [
        { id: 'short', dayMask: ALL_DAYS, departuresS: [at(8), at(8, 10)] }
      ] })
    ])

    expect(index.byLine.get('M')).toHaveLength(2)
    // The short-turn does not serve BLA, so a scan from there must not see it.
    expect(index.byStop.get('MRTJ-BLA')).toHaveLength(1)
    expect(index.byStop.get('MRTJ-FTM')).toHaveLength(2)
  })

  /*
   * Dropping rather than throwing is the point: this input is generated, and one
   * malformed pattern must not take the whole graph down at isolate start.
   */
  describe('rejecting input it cannot scan', () => {
    it('drops a pattern with fewer than two stops', () => {
      const index = buildTripIndex([pattern({
        stationIds: ['LRTJ-VEL'],
        trips: [{ id: 'board', dayMask: ALL_DAYS, departuresS: [at(6)] }]
      })])

      expect(index.patterns).toHaveLength(0)
      expect(index.tripCount).toBe(0)
    })

    it('drops a trip whose times do not line up with the stops', () => {
      const index = buildTripIndex([pattern({
        trips: [
          { id: 'short', dayMask: ALL_DAYS, departuresS: [at(6), at(6, 10)] },
          { id: 'good', dayMask: ALL_DAYS, departuresS: [at(7), at(7, 10), at(7, 20)] }
        ]
      })])

      expect(index.tripCount).toBe(1)
      expect(index.patterns[0]!.trips[0]!.id).toBe('good')
    })

    it('drops a trip whose arrivals are the wrong length', () => {
      const index = buildTripIndex([pattern({
        trips: [{
          id: 'ragged',
          dayMask: ALL_DAYS,
          departuresS: [at(6), at(6, 10), at(6, 20)],
          arrivalsS: [at(6), at(6, 10)]
        }]
      })])

      expect(index.patterns).toHaveLength(0)
    })

    it('drops the pattern entirely when no trip survives', () => {
      const index = buildTripIndex([pattern({
        trips: [{ id: 'bad', dayMask: ALL_DAYS, departuresS: [at(6)] }]
      })])

      expect(index.patterns).toHaveLength(0)
    })
  })
})

describe('nextTrip', () => {
  const indexed = buildTripIndex([pattern()]).patterns[0]!

  it('finds the first departure at or after the given time', () => {
    expect(nextTrip(indexed, 0, at(5), ALL_DAYS)?.id).toBe('a')
    expect(nextTrip(indexed, 0, at(6, 30), ALL_DAYS)?.id).toBe('b')
  })

  it('treats the boundary as boardable', () => {
    expect(nextTrip(indexed, 0, at(7), ALL_DAYS)?.id).toBe('b')
  })

  it('answers for a stop partway along the pattern', () => {
    // 06:10 at FTM is still catchable; 06:11 is not, so the next is b.
    expect(nextTrip(indexed, 1, at(6, 10), ALL_DAYS)?.id).toBe('a')
    expect(nextTrip(indexed, 1, at(6, 11), ALL_DAYS)?.id).toBe('b')
  })

  it('returns null once the pattern is done for the day', () => {
    expect(nextTrip(indexed, 0, at(23), ALL_DAYS)).toBeNull()
  })

  describe('day masks', () => {
    const byDay = buildTripIndex([pattern({
      trips: [
        { id: 'weekday', dayMask: WD, departuresS: [at(6), at(6, 10), at(6, 20)] },
        { id: 'saturday', dayMask: SAT, departuresS: [at(7), at(7, 10), at(7, 20)] }
      ]
    })]).patterns[0]!

    it('skips a trip that does not run on the asked-for day', () => {
      expect(nextTrip(byDay, 0, at(5), WD)?.id).toBe('weekday')
      expect(nextTrip(byDay, 0, at(5), SAT)?.id).toBe('saturday')
    })

    it('matches on intersection, so a multi-day query sees both', () => {
      expect(nextTrip(byDay, 0, at(5), ALL_DAYS)?.id).toBe('weekday')
    })

    it('matches nothing for a zero mask', () => {
      expect(nextTrip(byDay, 0, at(0), 0)).toBeNull()
    })
  })

  /*
   * The case the >DAY_S convention exists for. A trip leaving 23:48 and arriving
   * 00:23 is stored as 85680 -> 87780, never 85680 -> 1380, or the arrival sorts
   * before the departure it follows and the journey reads backwards.
   */
  describe('a trip crossing midnight', () => {
    const overnight = buildTripIndex([pattern({
      lineCode: 'B',
      stationIds: ['KCI-JAKK', 'KCI-BJD', 'KCI-CLT'],
      trips: [{
        id: 'last',
        dayMask: ALL_DAYS,
        departuresS: [at(22, 48), at(23, 59), at(24, 5)]
      }]
    })]).patterns[0]!

    it('keeps the sequence monotonic past midnight', () => {
      const trip = overnight.trips[0]!
      expect(trip.departuresS[2]).toBeGreaterThan(trip.departuresS[1]!)
      expect(trip.departuresS[2]).toBeGreaterThan(86400)
    })

    it('is still boardable late in the evening', () => {
      expect(nextTrip(overnight, 0, at(22), ALL_DAYS)?.id).toBe('last')
    })

    it('is found at a stop whose time is past midnight', () => {
      expect(nextTrip(overnight, 2, at(24), ALL_DAYS)?.id).toBe('last')
    })
  })
})
