import { describe, expect, it } from 'vitest'
import type { RouteLeg } from '../router'
import { journeyArrivalS, resolveDepartures, clockOf } from './departures'
import { buildTripIndex, type TripPattern } from './trips'

const at = (h: number, m = 0) => h * 3600 + m * 60
const ALL_DAYS = 0b111
const WD = 0b100

const ride = (lineCode: string, stationIds: string[]): RouteLeg => ({
  type: 'RIDE',
  lineCode,
  operator: stationIds[0]!.split('-')[0]!,
  fromStationId: stationIds[0]!,
  toStationId: stationIds[stationIds.length - 1]!,
  stationIds,
  distanceM: 1000 * (stationIds.length - 1)
})

const walk = (from: string, to: string, distanceM = 240): RouteLeg => ({
  type: 'TRANSFER', fromStationId: from, toStationId: to, distanceM, noTap: false
})

/* Three stops, two trips an hour apart, with real per-stop arrivals. */
const mrt: TripPattern = {
  lineCode: 'M',
  stationIds: ['MRTJ-LBB', 'MRTJ-FTM', 'MRTJ-BLA'],
  trips: [
    { id: 'm6', dayMask: ALL_DAYS, departuresS: [at(6), at(6, 10), at(6, 20)], arrivalsS: [at(6), at(6, 9), at(6, 19)] },
    { id: 'm7', dayMask: ALL_DAYS, departuresS: [at(7), at(7, 10), at(7, 20)], arrivalsS: [at(7), at(7, 9), at(7, 19)] }
  ]
}

const index = (...patterns: TripPattern[]) => buildTripIndex(patterns)

describe('resolveDepartures', () => {
  it('boards the first trip at or after the rider sets off', () => {
    const [timing] = resolveDepartures(
      [ride('M', ['MRTJ-LBB', 'MRTJ-FTM'])], index(mrt), { departureS: at(5, 30), dayMask: ALL_DAYS }
    )
    expect(timing?.tripId).toBe('m6')
    expect(timing?.departureS).toBe(at(6))
  })

  it('takes the later trip when the earlier one has gone', () => {
    const [timing] = resolveDepartures(
      [ride('M', ['MRTJ-LBB', 'MRTJ-FTM'])], index(mrt), { departureS: at(6, 30), dayMask: ALL_DAYS }
    )
    expect(timing?.tripId).toBe('m7')
  })

  /*
   * The arrival is the arrival, not the departure, wherever the feed records
   * one — 06:09 at FTM, not the 06:10 the train leaves again.
   */
  it('reports a real per-stop arrival where the feed has one', () => {
    const [timing] = resolveDepartures(
      [ride('M', ['MRTJ-LBB', 'MRTJ-FTM'])], index(mrt), { departureS: at(5), dayMask: ALL_DAYS }
    )
    expect(timing?.arrivalS).toBe(at(6, 9))
  })

  /*
   * KCI drops its arrivals entirely — the column held the terminus time on
   * every row, so the generator kept none of it. The departure from the
   * alighting stop is then the honest figure, and no dwell may be invented.
   */
  it('falls back to the departure when no arrival was recorded', () => {
    const kci: TripPattern = {
      lineCode: 'B',
      stationIds: ['KCI-BOO', 'KCI-CLT'],
      trips: [{ id: 'b1', dayMask: ALL_DAYS, departuresS: [at(6), at(6, 12)] }]
    }
    const [timing] = resolveDepartures(
      [ride('B', ['KCI-BOO', 'KCI-CLT'])], index(kci), { departureS: at(5), dayMask: ALL_DAYS }
    )
    expect(timing?.arrivalS).toBe(at(6, 12))
  })

  it('carries the clock across a transfer at walking pace', () => {
    const feeder: TripPattern = {
      lineCode: 'C',
      stationIds: ['KCI-X', 'KCI-Y'],
      trips: [
        // 06:20 is unreachable: alighting 06:19 plus a 240m walk lands at 06:22.
        { id: 'c-early', dayMask: ALL_DAYS, departuresS: [at(6, 20), at(6, 30)] },
        { id: 'c-late', dayMask: ALL_DAYS, departuresS: [at(6, 40), at(6, 50)] }
      ]
    }
    // The full run LBB -> FTM -> BLA, so one trip covers it and it is timed.
    const legs = [
      ride('M', ['MRTJ-LBB', 'MRTJ-FTM', 'MRTJ-BLA']),
      walk('MRTJ-BLA', 'KCI-X'),
      ride('C', ['KCI-X', 'KCI-Y'])
    ]
    const timings = resolveDepartures(legs, index(mrt, feeder), { departureS: at(5), dayMask: ALL_DAYS })

    expect(timings[0]?.arrivalS).toBe(at(6, 19))
    expect(timings[1]).toBeNull() // a walk is not a boarding
    expect(timings[2]?.tripId).toBe('c-late')
  })

  /*
   * A change of vehicle takes time, and none of it is recorded anywhere.
   *
   * These are the cases that used to quote a connection nobody can make: the
   * clock only ever moved across a TRANSFER leg, and a change at one station
   * does not produce one.
   */
  describe('charging for the change', () => {
    /*
     * Two lines meeting at one station, so the journey is RIDE then RIDE with
     * nothing between them — the shape hopsToLegs emits for a cross-platform
     * change and for a service break alike.
     */
    const connecting: TripPattern = {
      lineCode: 'C',
      stationIds: ['MRTJ-FTM', 'KCI-Y'],
      trips: [
        // Departs the very second the M train gets in at 06:09.
        { id: 'c-same-second', dayMask: ALL_DAYS, departuresS: [at(6, 9), at(6, 15)] },
        { id: 'c-catchable', dayMask: ALL_DAYS, departuresS: [at(6, 25), at(6, 35)] }
      ]
    }

    it('will not board a train leaving the second the rider steps off', () => {
      const legs = [ride('M', ['MRTJ-LBB', 'MRTJ-FTM']), ride('C', ['MRTJ-FTM', 'KCI-Y'])]
      const timings = resolveDepartures(legs, index(mrt, connecting), { departureS: at(5), dayMask: ALL_DAYS })

      expect(timings[0]?.arrivalS).toBe(at(6, 9))
      expect(timings[1]?.tripId).toBe('c-catchable')
    })

    /*
     * Boarding the first vehicle is not a change — the rider is already on the
     * platform — so the allowance must not be charged before it.
     */
    it('does not charge the first boarding', () => {
      const [timing] = resolveDepartures(
        [ride('M', ['MRTJ-LBB', 'MRTJ-FTM'])], index(mrt), { departureS: at(6), dayMask: ALL_DAYS }
      )
      expect(timing?.departureS).toBe(at(6))
    })

    /*
     * distanceM = 0 means UNMEASURED in this repo, never "no walk at all", so a
     * zero-distance transfer must still cost the in-station allowance.
     */
    it('floors an unmeasured transfer rather than crossing it instantly', () => {
      const legs = [
        ride('M', ['MRTJ-LBB', 'MRTJ-FTM']),
        walk('MRTJ-FTM', 'MRTJ-FTM', 0),
        ride('C', ['MRTJ-FTM', 'KCI-Y'])
      ]
      const timings = resolveDepartures(legs, index(mrt, connecting), { departureS: at(5), dayMask: ALL_DAYS })
      expect(timings[2]?.tripId).toBe('c-catchable')
    })

    /*
     * The pace is a per-rider input, and the only thing separating these two is
     * how fast they cross the station.
     */
    it('lets a brisk rider make a connection a slow one misses', () => {
      const tight: TripPattern = {
        lineCode: 'C',
        stationIds: ['KCI-X', 'KCI-Y'],
        // 06:19 + a 240m walk: 160s brisk lands 06:21:40, 267s slow lands 06:23:27.
        trips: [
          { id: 'tight', dayMask: ALL_DAYS, departuresS: [at(6, 22), at(6, 30)] },
          { id: 'next', dayMask: ALL_DAYS, departuresS: [at(6, 45), at(6, 55)] }
        ]
      }
      const legs = [
        ride('M', ['MRTJ-LBB', 'MRTJ-FTM', 'MRTJ-BLA']),
        walk('MRTJ-BLA', 'KCI-X'),
        ride('C', ['KCI-X', 'KCI-Y'])
      ]
      const brisk = resolveDepartures(legs, index(mrt, tight), { departureS: at(5), dayMask: ALL_DAYS, walking: 'BRISK' })
      const slow = resolveDepartures(legs, index(mrt, tight), { departureS: at(5), dayMask: ALL_DAYS, walking: 'SLOW' })

      expect(brisk[2]?.tripId).toBe('tight')
      expect(slow[2]?.tripId).toBe('next')
    })

    /*
     * However fast the rider, the doors still have to open and the platform
     * still has to clear.
     */
    it('never lets a change take less than a minute', () => {
      const justUnder: TripPattern = {
        lineCode: 'C',
        stationIds: ['MRTJ-FTM', 'KCI-Y'],
        trips: [
          // 30s after the 06:09 arrival: inside the floor at any pace.
          { id: 'too-soon', dayMask: ALL_DAYS, departuresS: [at(6, 9) + 30, at(6, 20)] },
          { id: 'after-floor', dayMask: ALL_DAYS, departuresS: [at(6, 12), at(6, 22)] }
        ]
      }
      const legs = [ride('M', ['MRTJ-LBB', 'MRTJ-FTM']), ride('C', ['MRTJ-FTM', 'KCI-Y'])]
      const timings = resolveDepartures(
        legs, index(mrt, justUnder), { departureS: at(5), dayMask: ALL_DAYS, walking: 'BRISK' }
      )
      expect(timings[1]?.tripId).toBe('after-floor')
    })
  })

  /*
   * Which train this is, as the feed signs it. The topology walk in apps/api
   * cannot tell two trains on one line apart; this can, and only where a trip
   * was actually resolved.
   */
  describe('reporting the boarded train', () => {
    const signed: TripPattern = {
      lineCode: 'C',
      stationIds: ['KCI-CUK', 'KCI-JNG'],
      trips: [
        { id: 'kpb', dayMask: ALL_DAYS, headsign: 'Kampung Bandan', departuresS: [at(6), at(6, 20)] },
        { id: 'ak', dayMask: ALL_DAYS, headsign: 'Angke', departuresS: [at(7), at(7, 20)] }
      ]
    }

    it('carries the headsign of the trip it actually boarded', () => {
      const legs = [ride('C', ['KCI-CUK', 'KCI-JNG'])]
      expect(resolveDepartures(legs, index(signed), { departureS: at(5), dayMask: ALL_DAYS })[0]?.headsign)
        .toBe('Kampung Bandan')
      // An hour later the same leg is a different train, signed differently.
      expect(resolveDepartures(legs, index(signed), { departureS: at(6, 30), dayMask: ALL_DAYS })[0]?.headsign)
        .toBe('Angke')
    })

    it('omits the headsign where the feed does not sign the trip', () => {
      const [timing] = resolveDepartures(
        [ride('M', ['MRTJ-LBB', 'MRTJ-FTM'])], index(mrt), { departureS: at(5), dayMask: ALL_DAYS }
      )
      expect(timing?.headsign).toBeUndefined()
    })
  })

  it('respects the day mask', () => {
    const weekdayOnly: TripPattern = {
      ...mrt,
      trips: [{ id: 'wd', dayMask: WD, departuresS: [at(6), at(6, 10), at(6, 20)] }]
    }
    const legs = [ride('M', ['MRTJ-LBB', 'MRTJ-FTM'])]
    expect(resolveDepartures(legs, index(weekdayOnly), { departureS: at(5), dayMask: WD })[0]).not.toBeNull()
    expect(resolveDepartures(legs, index(weekdayOnly), { departureS: at(5), dayMask: 0b010 })[0]).toBeNull()
  })

  /*
   * The two ways this file could ship a lie, both asserted rather than argued.
   */
  describe('refusing to invent a time', () => {
    it('leaves a leg untimed when no single trip covers its whole run', () => {
      // The pattern serves LBB and BLA but not as a contiguous run through FTM,
      // so a trip on it is not the vehicle this leg describes.
      const gapped: TripPattern = {
        lineCode: 'M',
        stationIds: ['MRTJ-LBB', 'MRTJ-BLA'],
        trips: [{ id: 'skip', dayMask: ALL_DAYS, departuresS: [at(6), at(6, 20)] }]
      }
      const [timing] = resolveDepartures(
        [ride('M', ['MRTJ-LBB', 'MRTJ-FTM', 'MRTJ-BLA'])], index(gapped),
        { departureS: at(5), dayMask: ALL_DAYS }
      )
      expect(timing).toBeNull()
    })

    it('leaves a leg untimed when its line has no timetable at all', () => {
      const [timing] = resolveDepartures(
        [ride('9C', ['TJ-A', 'TJ-B'])], index(mrt), { departureS: at(6), dayMask: ALL_DAYS }
      )
      expect(timing).toBeNull()
    })

    /*
     * The rule that makes a mixed journey honest. Once a leg is untimed the
     * rider does not know when they reach the next one, so a time there would
     * be guesswork dressed as a timetable.
     */
    it('stops timing every leg after an untimed one', () => {
      const legs = [ride('9C', ['TJ-A', 'MRTJ-LBB']), ride('M', ['MRTJ-LBB', 'MRTJ-FTM'])]
      const timings = resolveDepartures(legs, index(mrt), { departureS: at(5), dayMask: ALL_DAYS })

      expect(timings[0]).toBeNull()
      // M is fully timetabled, and still reports nothing: its start is unknown.
      expect(timings[1]).toBeNull()
    })

    it('reports nothing at all when no timetable was loaded', () => {
      const timings = resolveDepartures(
        [ride('M', ['MRTJ-LBB', 'MRTJ-FTM'])], index(), { departureS: at(6), dayMask: ALL_DAYS }
      )
      expect(timings).toEqual([null])
    })
  })

  /*
   * A journey that crosses midnight keeps monotonic seconds past DAY_S, so
   * "later" stays a plain numeric comparison. clockOf is what folds it back to
   * a wall clock for display.
   */
  describe('crossing midnight', () => {
    const overnight: TripPattern = {
      lineCode: 'B',
      stationIds: ['KCI-JAKK', 'KCI-CLT'],
      trips: [{ id: 'last', dayMask: ALL_DAYS, departuresS: [at(23, 48), at(24, 23)] }]
    }

    it('keeps the arrival past DAY_S rather than wrapping it', () => {
      const [timing] = resolveDepartures(
        [ride('B', ['KCI-JAKK', 'KCI-CLT'])], index(overnight),
        { departureS: at(23), dayMask: ALL_DAYS }
      )
      expect(timing?.arrivalS).toBe(at(24, 23))
      expect(timing!.arrivalS).toBeGreaterThan(timing!.departureS)
    })

    it('folds back to a wall clock only for display', () => {
      expect(clockOf(at(24, 23))).toBe(at(0, 23))
      expect(clockOf(at(6))).toBe(at(6))
    })
  })
})

describe('journeyArrivalS', () => {
  const legs = [ride('M', ['MRTJ-LBB', 'MRTJ-FTM']), walk('MRTJ-FTM', 'KCI-X'), ride('C', ['KCI-X', 'KCI-Y'])]

  it('reports the last ride leg\'s arrival when every ride is timed', () => {
    const timings = [
      { departureS: at(6), arrivalS: at(6, 9), tripId: 'a' },
      null,
      { departureS: at(6, 20), arrivalS: at(6, 40), tripId: 'b' }
    ]
    expect(journeyArrivalS(legs, timings)).toBe(at(6, 40))
  })

  /*
   * All-or-nothing. A total that skipped an untimed leg would read as more
   * certain than the legs it came from.
   */
  it('reports nothing when any ride leg is untimed', () => {
    const timings = [{ departureS: at(6), arrivalS: at(6, 9), tripId: 'a' }, null, null]
    expect(journeyArrivalS(legs, timings)).toBeNull()
  })
})
