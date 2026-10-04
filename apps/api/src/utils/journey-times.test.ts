import { describe, expect, it } from 'vitest'
import type { FareJourney } from '@commute/schemas'
import type { FareContext } from '@commute/constants'
import type { Tsundere } from '@commute/tsundere'
import { byArrival, retimeTrips } from './journey-times'

/*
 * Only the fields the ordering reads. A real FareJourney carries legs, fares
 * and labels too, and none of them decide where a card lands.
 */
const journey = (id: string, arrivalAt?: string): FareJourney =>
  ({ id, ...(arrivalAt ? { arrivalAt } : {}) } as unknown as FareJourney)

const idsOf = (journeys: FareJourney[]) => journeys.map(j => (j as unknown as { id: string }).id)

const at = (hhmm: string) => `2026-09-07T${hhmm}:00+07:00`

describe('byArrival', () => {
  it('puts the earliest arrival first', () => {
    const sorted = byArrival([journey('late', at('09:10')), journey('early', at('09:00'))])
    expect(idsOf(sorted)).toEqual(['early', 'late'])
  })

  /*
   * The measured case this exists for: MRTJ-STB -> KCI-CSK returns two journeys
   * on the same lines leaving at the same minute, and the one arriving ten
   * minutes earlier was ranked second because the engine cannot see arrivals.
   */
  it('reorders two journeys that differ only in arrival', () => {
    const sorted = byArrival([journey('0910', at('09:10')), journey('0900', at('09:00'))])
    expect(idsOf(sorted)[0]).toBe('0900')
  })

  /*
   * A mixed list is the normal case, not the exception: a TransJakarta route has
   * no arrival to sort on while the rail route beside it does. Timed rows sort
   * among themselves and untimed ones keep the engine's ranking behind them, so
   * neither half's position is decided by the other half's rule.
   */
  it('sorts the timed rows and keeps the untimed ones behind, in engine order', () => {
    const sorted = byArrival([
      journey('late', at('09:10')), journey('u1'), journey('early', at('09:00')), journey('u2')
    ])
    expect(idsOf(sorted)).toEqual(['early', 'late', 'u1', 'u2'])
  })

  it('leaves the list alone when only one row is timed', () => {
    const sorted = byArrival([journey('u1'), journey('only', at('09:00'))])
    expect(idsOf(sorted)).toEqual(['u1', 'only'])
  })

  it('keeps the engine order when nothing is timed at all', () => {
    const sorted = byArrival([journey('a'), journey('b')])
    expect(idsOf(sorted)).toEqual(['a', 'b'])
  })

  /*
   * Stable on a tie, so journeys arriving the same minute keep the engine's
   * ranking between them — still the better tie-break, and it keeps the order
   * deterministic for the `selectedIndex` the map holds across a render.
   */
  it('leaves equal arrivals in the engine order', () => {
    const sorted = byArrival([journey('first', at('09:00')), journey('second', at('09:00'))])
    expect(idsOf(sorted)).toEqual(['first', 'second'])
  })

  it('does not disturb a single journey', () => {
    expect(idsOf(byArrival([journey('only', at('09:00'))]))).toEqual(['only'])
  })
})

describe('retimeTrips after the last train', () => {
  const station = (id: string) => ({ id, name: id })
  const route: FareJourney = {
    legs: [{
      type: 'RIDE',
      line: 'KCI:C',
      operator: 'KCI',
      from: station('KCI-BKS'),
      to: station('KCI-SUD'),
      stationCount: 2,
      stops: [station('KCI-BKS'), station('KCI-SUD')],
      headsign: null,
      distanceM: 20000
    }],
    segments: [],
    totalFare: 3000,
    totalDistanceM: 20000,
    transferCount: 0,
    labels: [],
    boardings: 1,
    walkDistanceM: 0
  }
  const result = { from: station('KCI-BKS'), to: station('KCI-SUD'), journeys: [route] }
  const context = { paymentMethod: 'KMT', departureAt: new Date('2026-10-01T23:30:00+07:00') } as unknown as FareContext

  // One train a day at 04:05; nothing after it.
  const timetabled = {
    timeJourney: (_legs: unknown, { departureS }: { departureS: number }) =>
      departureS <= 4 * 3600 + 300 ? [{ departureS: 4 * 3600 + 300, arrivalS: 5 * 3600, stopsS: [4 * 3600 + 300, 5 * 3600], tripId: 'T1' }] : [null],
    journeyArrival: () => null
  } as unknown as Tsundere
  const untimetabled = { timeJourney: () => [null], journeyArrival: () => null } as unknown as Tsundere

  it('says when a timetabled route starts again', () => {
    const [row] = retimeTrips(result, timetabled, context).journeys
    expect(row!.resumesAt).toBe('2026-10-02T04:05:00+07:00')
    expect(row!.legs[0]!.type === 'RIDE' && row!.legs[0]!.departureAt).toBeUndefined()
  })

  it('leaves a route the timetable never covers as one untimed row', () => {
    const rows = retimeTrips(result, untimetabled, context).journeys
    expect(rows).toHaveLength(1)
    expect(rows[0]!.resumesAt).toBeUndefined()
  })

  // After midnight the morning's first train is simply the next departure, so
  // it comes back as an ordinary timed row rather than a "starts again".
  it('offers the morning train as a departure when asked after midnight', () => {
    const late = { ...context, departureAt: new Date('2026-10-02T01:30:00+07:00') }
    const [row] = retimeTrips(result, timetabled, late).journeys
    expect(row!.resumesAt).toBeUndefined()
    expect(row!.legs[0]!.type === 'RIDE' && row!.legs[0]!.departureAt).toBe('2026-10-02T04:05:00+07:00')
  })

  it('stamps every stop and the trip boarded on a timed leg', () => {
    const late = { ...context, departureAt: new Date('2026-10-02T01:30:00+07:00') }
    const leg = retimeTrips(result, timetabled, late).journeys[0]!.legs[0]!
    if (leg.type !== 'RIDE') throw new Error('expected a ride')
    expect(leg.stopTimes).toEqual(['2026-10-02T04:05:00+07:00', '2026-10-02T05:00:00+07:00'])
    expect(leg.stopTimes![0]).toBe(leg.departureAt)
    expect(leg.stopTimes!.at(-1)).toBe(leg.arrivalAt)
    expect(leg.tripId).toBe('T1')
  })

  it('stamps neither on an untimed leg', () => {
    const leg = retimeTrips(result, untimetabled, context).journeys[0]!.legs[0]!
    if (leg.type !== 'RIDE') throw new Error('expected a ride')
    expect(leg.stopTimes).toBeUndefined()
    expect(leg.tripId).toBeUndefined()
  })
})
