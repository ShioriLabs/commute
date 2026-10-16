import { describe, expect, it } from 'vitest'
import type { FareLegDeparture, FareResultLeg } from '@commute/schemas'
import type { FareJourney } from '@commute/schemas'
import { changeAt, journeyClockOf, leaveInLabel, resolveTimedLegs, retimeJourney } from './leg-departures'

const at = (hhmm: string) => `2026-10-16T${hhmm}:00+07:00`
const train = (tripId: string, dep: string, arr: string): FareLegDeparture => ({
  tripId,
  departureAt: at(dep),
  arrivalAt: at(arr),
  line: 'KCI:BK'
})

const ride = (upcomingDepartures: FareLegDeparture[]): FareResultLeg => ({
  type: 'RIDE',
  line: 'KCI:BK',
  operator: 'KCI',
  from: { id: 'A', name: 'A' },
  to: { id: 'B', name: 'B' },
  stationCount: 3,
  stops: [],
  headsign: null,
  distanceM: 1000,
  upcomingDepartures
})

const walk = (distanceM: number): FareResultLeg => ({
  type: 'TRANSFER',
  from: { id: 'B', name: 'B' },
  to: { id: 'B2', name: 'B2' },
  distanceM
})

// Depok → Manggarai (07.12 and later), then Manggarai → Bekasi.
const first = [train('a1', '07:12', '07:46'), train('a2', '07:20', '07:54'), train('a3', '07:28', '08:02'), train('a4', '07:36', '08:10')]
const second = [train('b1', '07:52', '08:14'), train('b2', '08:00', '08:22'), train('b3', '08:10', '08:32')]
const legs = [ride(first), ride(second)]

describe('resolveTimedLegs', () => {
  it('chooses the first train on every leg by default', () => {
    const timed = resolveTimedLegs(legs, {})
    expect(timed.map(leg => leg.chosen.tripId)).toEqual(['a1', 'b1'])
  })

  it('moves the later leg when an earlier pick lands after its train', () => {
    // a2 arrives 07.54, so b1 (07.52) is gone and b2 takes over.
    const timed = resolveTimedLegs(legs, { 0: 'a2' })
    expect(timed.map(leg => leg.chosen.tripId)).toEqual(['a2', 'b2'])
  })

  it('marks trains that can no longer be reached, rather than hiding them', () => {
    const second = resolveTimedLegs(legs, { 0: 'a2' })[1]!
    expect(second.options.map(option => [option.departure.tripId, option.blocked])).toEqual([['b1', 'MISSED'], ['b2', null], ['b3', null]])
  })

  it('keeps a pick on a later leg without touching the earlier one', () => {
    const timed = resolveTimedLegs(legs, { 1: 'b3' })
    expect(timed.map(leg => leg.chosen.tripId)).toEqual(['a1', 'b3'])
  })

  it('ignores a pick that no longer connects', () => {
    // b1 is picked but a3 arrives at 08.02, after it left.
    const timed = resolveTimedLegs(legs, { 0: 'a3', 1: 'b1' })
    expect(timed.map(leg => leg.chosen.tripId)).toEqual(['a3', 'b3'])
  })

  it('reports the gap to the next boarding for each option', () => {
    const [firstLeg] = resolveTimedLegs(legs, {})
    expect(firstLeg!.options.map(option => option.gapToNextS)).toEqual([360, 360, 480, null])
  })

  it('treats a change as at least a minute even with no walk leg', () => {
    // a4 arrives 08.10, b3 leaves 08.10: a zero-second change is not a change.
    const [firstLeg] = resolveTimedLegs(legs, {})
    expect(firstLeg!.options[3]!.gapToNextS).toBeNull()
    expect(firstLeg!.options[3]!.blocked).toBe('NO_ONWARD')
  })

  it('charges the transfer walk at average pace', () => {
    // 600 m at 1.2 m/s is 500 s, so a 07.46 arrival cannot make a 07.52 train.
    const withWalk = [ride(first), walk(600), ride(second)]
    const timed = resolveTimedLegs(withWalk, {})
    expect(timed[1]!.chosen.tripId).toBe('b2')
  })

  it('skips untimed legs and yields nothing for an untimed journey', () => {
    expect(resolveTimedLegs([ride([])], {})).toEqual([])
  })

  it('re-times nothing when no train can finish the journey', () => {
    // Only reachable from a body whose lists disagree with themselves; the
    // caller then keeps the journey exactly as the API sent it.
    const late = [ride([train('a1', '09:00', '09:30')]), ride([train('b1', '07:00', '07:20')])]
    expect(resolveTimedLegs(late, {})).toEqual([])
  })

  describe('with the engine\'s change allowance', () => {
    // 600 m between the rides: the fallback would demand 500 s at average pace.
    const withAllowance = (minChangeS: number) => [
      ride(first),
      walk(600),
      { ...(ride(second) as FareResultLeg & { type: 'RIDE' }), minChangeS }
    ]

    it('trusts the engine over its own fallback', () => {
      // A brisk rider: the engine allows 300 s, so the 07.52 is made from a 07.46 arrival.
      const timed = resolveTimedLegs(withAllowance(300), {})
      expect(timed[1]!.chosen.tripId).toBe('b1')
      expect(timed[1]!.options[0]!.blocked).toBeNull()
    })

    it('judges tight on the spare time beyond the allowance, not on the gap', () => {
      const [firstLeg] = resolveTimedLegs(withAllowance(300), {})
      // a1 → b1 is a 360 s gap: only 60 s to spare, so tight.
      expect(firstLeg!.options[0]).toMatchObject({ gapToNextS: 360, tight: true })
      // a3 → b3 is 480 s: 180 s to spare.
      expect(firstLeg!.options[2]).toMatchObject({ gapToNextS: 480, tight: false })
    })

    it('reports the same verdict for the change row in the timeline', () => {
      const allowed = withAllowance(300)
      expect(changeAt(allowed, resolveTimedLegs(allowed, {}), 1)).toEqual({ gapS: 360, tight: true })
    })
  })

  describe('a train nothing later connects from', () => {
    // b's list ends at 08.10, so a4 (in 08.10) has no onward train.
    it('is offered but cannot be picked, and says why', () => {
      const [firstLeg] = resolveTimedLegs(legs, {})
      expect(firstLeg!.options.map(option => option.blocked)).toEqual([null, null, null, 'NO_ONWARD'])
    })

    it('ignores a pick of it rather than splitting the journey in two', () => {
      const timed = resolveTimedLegs(legs, { 0: 'a4' })
      expect(timed.map(leg => leg.chosen.tripId)).toEqual(['a1', 'b1'])
    })

    it('looks past the next leg to the ones after it', () => {
      // c only runs early: b3 cannot finish, so neither can a3, which only connects to b3.
      const third = [train('c1', '08:20', '08:30'), train('c2', '08:30', '08:40')]
      const timed = resolveTimedLegs([ride(first), ride(second), ride(third)], {})
      expect(timed[1]!.options.map(option => option.blocked)).toEqual([null, null, 'NO_ONWARD'])
      expect(timed[0]!.options.map(option => option.blocked)).toEqual([null, null, 'NO_ONWARD', 'NO_ONWARD'])
    })
  })
})

describe('journeyClockOf', () => {
  it('spans the first boarding to the last alighting', () => {
    expect(journeyClockOf(resolveTimedLegs(legs, { 0: 'a2' }))).toEqual({ departureAt: at('07:20'), arrivalAt: at('08:22') })
  })

  it('is null with nothing timed', () => {
    expect(journeyClockOf([])).toBeNull()
  })
})

const journeyOf = (): FareJourney => ({
  legs: [
    { ...(ride(first) as FareResultLeg & { type: 'RIDE' }), tripId: 'a1', departureAt: at('07:12'), arrivalAt: at('07:46'), stopTimes: [at('07:12')], lastService: true },
    { ...(ride(second) as FareResultLeg & { type: 'RIDE' }), tripId: 'b1', departureAt: at('07:52'), arrivalAt: at('08:14') }
  ],
  segments: [],
  totalFare: 6000,
  totalDistanceM: 1,
  transferCount: 1,
  labels: [],
  boardings: 2,
  walkDistanceM: 0,
  arrivalAt: at('08:14')
})

describe('retimeJourney', () => {
  it('returns the same object when nothing changed', () => {
    const base = journeyOf()
    expect(retimeJourney(base, resolveTimedLegs(base.legs, {}))).toBe(base)
  })

  it('moves every leg and the arrival, and drops what only the caught trip knew', () => {
    const base = journeyOf()
    const view = retimeJourney(base, resolveTimedLegs(base.legs, { 0: 'a2' }))
    const [firstLeg, secondLeg] = view.legs
    expect(firstLeg).toMatchObject({ tripId: 'a2', departureAt: at('07:20') })
    expect(firstLeg).not.toHaveProperty('stopTimes')
    expect(firstLeg).not.toHaveProperty('lastService')
    expect(secondLeg).toMatchObject({ tripId: 'b2' })
    expect(view.arrivalAt).toBe(at('08:22'))
  })

  it('drops the route-level later departures, which name the train just chosen', () => {
    const base = { ...journeyOf(), moreDepartures: [{ departureAt: at('12:00') }] }
    const view = retimeJourney(base, resolveTimedLegs(base.legs, { 0: 'a2' }))
    expect(view).not.toHaveProperty('moreDepartures')
  })

  it('does not mutate the journey it was given', () => {
    const base = journeyOf()
    retimeJourney(base, resolveTimedLegs(base.legs, { 0: 'a2' }))
    expect(base.arrivalAt).toBe(at('08:14'))
  })
})

describe('leaveInLabel', () => {
  const now = Date.parse(at('07:08'))
  it('counts down inside the hour', () => {
    expect(leaveInLabel(at('07:12'), now)).toBe('Berangkat 4 mnt lagi')
  })
  it('says now, and gone', () => {
    expect(leaveInLabel(at('07:08'), now)).toBe('Berangkat sekarang')
    expect(leaveInLabel(at('07:00'), now)).toBe('Sudah berangkat')
  })
  it('stays quiet when it is far off', () => {
    expect(leaveInLabel(at('09:00'), now)).toBeNull()
  })
})
