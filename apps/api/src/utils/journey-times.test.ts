import { describe, expect, it } from 'vitest'
import type { FareJourney, TripResult } from '@commute/schemas'
import type { FareContext } from '@commute/constants'
import type { ResolveDeparturesOptions, RouteLeg, Tsundere } from '@commute/tsundere'
import { TJ_RUNTIMES } from 'db/data/runtimes.planner'
import { byArrival, retimeTrips, toRouteLegs } from './journey-times'
import { estimateTjLeg } from './observedRuntimes'
import { mergeConsecutiveWalks, stripWalkHops } from './merge-walks'

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

describe('retimeTrips keeps the doors on a walk', () => {
  const station = (id: string) => ({ id, name: id })
  const exit = (id: string) => ({ id, ref: id.split(':')[1]!, name: null })
  const ride = (from: string, to: string): FareJourney['legs'][number] => ({
    type: 'RIDE',
    line: 'KCI:C',
    operator: 'KCI',
    from: station(from),
    to: station(to),
    stationCount: 2,
    stops: [station(from), station(to)],
    headsign: null,
    distanceM: 5000
  })
  const route: FareJourney = {
    legs: [
      ride('KCI-BKS', 'KCI-SUD'),
      { type: 'TRANSFER', from: station('KCI-SUD'), to: station('MRTJ-DKA'), distanceM: 300, fromExit: exit('KCI-SUD:Utara'), toExit: exit('MRTJ-DKA:A') },
      ride('MRTJ-DKA', 'MRTJ-LBB')
    ],
    segments: [],
    totalFare: 3000,
    totalDistanceM: 10300,
    transferCount: 1,
    labels: [],
    boardings: 2,
    walkDistanceM: 300
  }
  const result = { from: station('KCI-BKS'), to: station('MRTJ-LBB'), journeys: [route] }
  const context = { paymentMethod: 'KMT', departureAt: new Date('2026-10-02T07:00:00+07:00') } as unknown as FareContext
  const timeLeg = (departureS: number, tripId: string) => ({ departureS, arrivalS: departureS + 600, stopsS: [departureS, departureS + 600], tripId })
  const timetabled = {
    // One service only: a search for anything after 07:10 finds nothing, so the
    // loop that gathers later boardings stops.
    timeJourney: (_legs: unknown, { departureS }: { departureS: number }) =>
      departureS <= 7 * 3600 + 600 ? [timeLeg(7 * 3600 + 600, 'T1'), null, timeLeg(7 * 3600 + 1800, 'T2')] : [null, null, null],
    journeyArrival: () => null
  } as unknown as Tsundere

  it('passes a timed journey\'s walk through with both exits', () => {
    const [row] = retimeTrips(result, timetabled, context).journeys
    expect(row!.legs[0]!.type === 'RIDE' && row!.legs[0]!.tripId).toBe('T1')
    expect(row!.legs[1]).toMatchObject({ type: 'TRANSFER', fromExit: { ref: 'Utara' }, toExit: { ref: 'A' } })
  })

  it('and so does a route the timetable never covers', () => {
    const untimed = { timeJourney: () => [null, null, null], journeyArrival: () => null } as unknown as Tsundere
    const [row] = retimeTrips(result, untimed, context).journeys
    expect(row!.legs[1]).toMatchObject({ fromExit: { ref: 'Utara' }, toExit: { ref: 'A' } })
  })

  it('survives stripWalkHops on the way out', () => {
    const [row] = stripWalkHops(retimeTrips(result, timetabled, context)).journeys
    expect(row!.legs[1]).toMatchObject({ fromExit: { ref: 'Utara' }, toExit: { ref: 'A' } })
  })
})

/*
 * Setiabudi to Dukuh Atas, which BK and CB both run. The search names BK; the
 * CB that leaves first must be offered under its own roundel, and still count
 * as the same route when the badges are handed out.
 */
describe('retimeTrips on a shared trunk', () => {
  const station = (id: string) => ({ id, name: id })
  const lrt: FareJourney = {
    legs: [{
      type: 'RIDE',
      line: 'LRTJBDB:BK',
      operator: 'LRTJBDB',
      from: station('LRTJBDB-SET'),
      to: station('LRTJBDB-DKA'),
      stationCount: 2,
      stops: [station('LRTJBDB-SET'), station('LRTJBDB-DKA')],
      headsign: null,
      distanceM: 1500
    }],
    segments: [],
    totalFare: 5000,
    totalDistanceM: 1500,
    transferCount: 0,
    labels: [],
    boardings: 1,
    walkDistanceM: 0
  }
  // A genuinely different way: a walk first, then the same ride.
  const other: FareJourney = {
    ...lrt,
    totalFare: 9000,
    legs: [{ type: 'TRANSFER', from: station('LRTJBDB-SET'), to: station('LRTJBDB-SET'), distanceM: 100 } as FareJourney['legs'][number], ...lrt.legs]
  }
  const result = { from: station('LRTJBDB-SET'), to: station('LRTJBDB-DKA'), journeys: [lrt] }
  const context = { paymentMethod: 'KMT', departureAt: new Date('2026-10-05T18:40:00+07:00') } as unknown as FareContext

  const hhmm = (h: number, m: number) => h * 3600 + m * 60
  const trains = [
    { departureS: hhmm(18, 41), lineCode: 'BK', tripId: 'bk1' },
    { departureS: hhmm(18, 45), lineCode: 'CB', tripId: 'cb1' },
    { departureS: hhmm(18, 49), lineCode: 'BK', tripId: 'bk2' }
  ]
  const router = {
    timeJourney: (_legs: unknown, { departureS }: { departureS: number }) => {
      const train = trains.find(t => t.departureS >= departureS)
      return train ? [{ ...train, arrivalS: train.departureS + 180, stopsS: [train.departureS, train.departureS + 180] }] : [null]
    },
    journeyArrival: (_legs: unknown, timings: { arrivalS: number }[]) => timings[0]?.arrivalS ?? null
  } as unknown as Tsundere

  it('offers the route once, with its later trains as more departures', () => {
    const rows = retimeTrips(result, router, context).journeys
    expect(rows).toHaveLength(1)
    expect(rows[0]!.moreDepartures?.map(d => d.departureAt)).toEqual(['2026-10-05T18:45:00+07:00', '2026-10-05T18:49:00+07:00'])
    expect(rows[0]!.moreDepartures?.map(d => d.arrivalAt)).toEqual(['2026-10-05T18:48:00+07:00', '2026-10-05T18:52:00+07:00'])
  })

  it('offers the other line\'s train under its own line', () => {
    const late = { ...context, departureAt: new Date('2026-10-05T18:42:00+07:00') }
    const [row] = retimeTrips(result, router, late).journeys
    expect(row!.legs[0]!.type === 'RIDE' && row!.legs[0]!.line).toBe('LRTJBDB:CB')
  })

  it('still awards each badge once across two routes', () => {
    const rows = retimeTrips({ ...result, journeys: [lrt, other] }, router, context).journeys
    expect(rows).toHaveLength(2)
    expect(rows.filter(j => j.labels.includes('CHEAPEST'))).toHaveLength(1)
  })
})

/*
 * Which of a route's boardings become the card and which ride along. A stub
 * router over a fixed list of trains, so each rule is asserted against times
 * that make it visible.
 */
describe('retimeTrips grouping boardings', () => {
  const station = (id: string) => ({ id, name: id })
  const route: FareJourney = {
    legs: [{
      type: 'RIDE',
      line: 'KCI:C',
      operator: 'KCI',
      from: station('KCI-CUK'),
      to: station('KCI-SUD'),
      stationCount: 2,
      stops: [station('KCI-CUK'), station('KCI-SUD')],
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
  const result = { from: station('KCI-CUK'), to: station('KCI-SUD'), journeys: [route] }
  const context = { paymentMethod: 'KMT', departureAt: new Date('2026-10-05T08:00:00+07:00') } as unknown as FareContext
  const hhmm = (h: number, m: number) => h * 3600 + m * 60
  const stampAt = (h: number, m: number) => `2026-10-05T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`

  type Train = { departureS: number, arrivalS: number | null, tripId: string }
  const routerOver = (trains: Train[]) => ({
    timeJourney: (_legs: unknown, { departureS }: { departureS: number }) => {
      const train = trains.find(t => t.departureS >= departureS)
      if (!train) return [null]
      const arrivalS = train.arrivalS ?? train.departureS + 600
      return [{
        ...train,
        arrivalS,
        lineCode: 'C',
        stopsS: [train.departureS, arrivalS],
        upcoming: trains.filter(t => t.departureS >= train.departureS).slice(0, 4)
          .map(t => ({ departureS: t.departureS, arrivalS: t.arrivalS ?? t.departureS + 600, tripId: t.tripId, lineCode: 'C' }))
      }]
    },
    journeyArrival: (_legs: unknown, timings: Train[]) => (trains.length && timings[0] ? (trains.find(t => t.tripId === timings[0]!.tripId)!.arrivalS) : null)
  } as unknown as Tsundere)

  const every10 = (count: number): Train[] => Array.from({ length: count }, (_, i) =>
    ({ departureS: hhmm(8, 5 + i * 10), arrivalS: hhmm(8, 50 + i * 10), tripId: `t${i}` }))

  it('keeps only the boardings inside the hour', () => {
    // 08.05 … 09.05: the 09.05 is past the hour and stays off the card.
    const [row] = retimeTrips(result, routerOver(every10(7)), context).journeys
    expect(row!.legs[0]!.type === 'RIDE' && row!.legs[0]!.departureAt).toBe(stampAt(8, 5))
    expect(row!.moreDepartures?.map(d => d.departureAt)).toEqual([stampAt(8, 15), stampAt(8, 25), stampAt(8, 35), stampAt(8, 45), stampAt(8, 55)])
  })

  it('caps how many ride along on a frequent line', () => {
    const frequent = Array.from({ length: 30 }, (_, i) =>
      ({ departureS: hhmm(8, 1 + i * 2), arrivalS: hhmm(8, 30 + i * 2), tripId: `f${i}` }))
    const [row] = retimeTrips(result, routerOver(frequent), context).journeys
    expect(row!.moreDepartures).toHaveLength(8)
  })

  it('offers the first boarding even when it is more than an hour off', () => {
    const sparse = [{ departureS: hhmm(9, 30), arrivalS: hhmm(10, 15), tripId: 's1' }, { departureS: hhmm(9, 40), arrivalS: hhmm(10, 25), tripId: 's2' }]
    const [row] = retimeTrips(result, routerOver(sparse), context).journeys
    expect(row!.legs[0]!.type === 'RIDE' && row!.legs[0]!.departureAt).toBe(stampAt(9, 30))
    expect(row!.moreDepartures).toBeUndefined()
  })

  /*
   * The 08.11 and the 08.22 that both reach Rasuna Said at 08.56: the earlier
   * one is only a longer wait, so the later one is the card.
   */
  it('drops a boarding that only means a longer wait', () => {
    const trains = [
      { departureS: hhmm(8, 11), arrivalS: hhmm(8, 56), tripId: 'slow' },
      { departureS: hhmm(8, 22), arrivalS: hhmm(8, 56), tripId: 'fast' },
      { departureS: hhmm(8, 33), arrivalS: hhmm(9, 10), tripId: 'next' }
    ]
    const [row] = retimeTrips(result, routerOver(trains), context).journeys
    expect(row!.legs[0]!.type === 'RIDE' && row!.legs[0]!.tripId).toBe('fast')
    expect(row!.moreDepartures?.map(d => d.departureAt)).toEqual([stampAt(8, 33)])
  })

  it('keeps every boarding when no arrival is known', () => {
    const untimedArrivals = every10(3).map(t => ({ ...t, arrivalS: null }))
    const router = { ...routerOver(untimedArrivals), journeyArrival: () => null } as unknown as Tsundere
    const [row] = retimeTrips(result, router, context).journeys
    expect(row!.arrivalAt).toBeUndefined()
    expect(row!.moreDepartures).toEqual([{ departureAt: stampAt(8, 15) }, { departureAt: stampAt(8, 25) }])
  })

  it('lists the trains under the leg, the caught one first', () => {
    const [row] = retimeTrips(result, routerOver(every10(5)), context).journeys
    const leg = row!.legs[0]!
    if (leg.type !== 'RIDE') throw new Error('expected a ride')
    expect(leg.upcomingDepartures).toHaveLength(4)
    expect(leg.upcomingDepartures![0]).toEqual({
      departureAt: leg.departureAt,
      arrivalAt: leg.arrivalAt,
      tripId: leg.tripId,
      line: 'KCI:C'
    })
  })

  it('carries neither list on a route the timetable never covers', () => {
    const untimetabled = { timeJourney: () => [null], journeyArrival: () => null } as unknown as Tsundere
    const [row] = retimeTrips(result, untimetabled, context).journeys
    const leg = row!.legs[0]!
    expect(row!.moreDepartures).toBeUndefined()
    expect(leg.type === 'RIDE' && leg.upcomingDepartures).toBeUndefined()
  })
})

describe('toRouteLegs', () => {
  const station = (id: string) => ({ id, name: id })
  const walk = (from: string, to: string, distanceM: number) => ({ type: 'TRANSFER' as const, from: station(from), to: station(to), distanceM })
  const ride = {
    type: 'RIDE' as const,
    line: 'KCI:C',
    operator: 'KCI' as const,
    from: station('KCI-MRI'),
    to: station('KCI-SUD'),
    stationCount: 2,
    stops: [station('KCI-MRI'), station('KCI-SUD')],
    headsign: null,
    distanceM: 1000
  }

  /*
   * A merged walk is shown as one row but timed as its hops, so each still
   * pays the engine's change floor. Timed as one, an unmeasured hop plus a
   * 300 m one cost 250 s where the two hops cost 459 s.
   */
  it('times a merged walk as the hops it was made of', () => {
    const { legs } = mergeConsecutiveWalks([walk('A', 'B', 0), walk('B', 'KCI-MRI', 300), ride])
    const route = toRouteLegs(legs)
    expect(route.legs.map(leg => [leg.type, leg.distanceM])).toEqual([['TRANSFER', 0], ['TRANSFER', 300], ['RIDE', 1000]])
  })

  it('maps each wire leg to where it landed among the engine legs', () => {
    const { legs } = mergeConsecutiveWalks([walk('A', 'B', 0), walk('B', 'KCI-MRI', 300), ride])
    expect(toRouteLegs(legs).engineIndexOf).toEqual([0, 2])
  })

  it('maps one to one when nothing was merged', () => {
    const route = toRouteLegs([walk('A', 'KCI-MRI', 90), ride])
    expect(route.legs).toHaveLength(2)
    expect(route.engineIndexOf).toEqual([0, 1])
  })
})

describe('TransJakarta estimates', () => {
  // A real line-direction from the generated table, so estimateTjLeg runs on real data.
  const [lineDir, tjLine] = Object.entries(TJ_RUNTIMES).find(([, l]) => l.WD[3] && l.WD[3].s.slice(1, 4).every(s => s > 0))!
  const code = lineDir.slice(0, lineDir.lastIndexOf('@'))
  const stops = tjLine.stops.slice(1, 4)
  const tjJourney = (id: string): FareJourney => ({
    id,
    legs: [{
      type: 'RIDE',
      line: `TJ:${code}`,
      operator: 'TJ',
      from: { id: stops[0]! },
      to: { id: stops.at(-1)! },
      stops: stops.map(s => ({ id: s })),
      distanceM: 2000
    }],
    labels: [],
    boardings: 1,
    walkDistanceM: 0,
    totalFare: 3500
  } as unknown as FareJourney)
  const railJourney = (id: string, arrivalAt: string) => ({ ...journey(id, arrivalAt), legs: [], labels: [] } as unknown as FareJourney)

  /*
   * A stand-in engine that times nothing (TransJakarta has no timetable) and
   * estimates through the real hook, so the estimate is estimateTjLeg's.
   */
  const engine = {
    timeJourney: (legs: unknown[]) => legs.map(() => null),
    journeyArrival: () => null,
    estimateJourney: (legs: RouteLeg[], options: ResolveDeparturesOptions) => {
      const leg = legs[0]!
      if (leg.type !== 'RIDE') return null
      const e = options.estimateUntimed!(leg, options.departureS)
      return e ? { arrivalS: options.departureS + e.waitS + e.rideS, rideS: [e.rideS] } : null
    }
  } as unknown as Tsundere
  const context = { paymentMethod: 'KMT', departureAt: new Date(at('12:00')) } as unknown as FareContext
  const inputs = { day: 'WD' as const, headways: new Map([[code, 600]]), serviceHours: new Map() }
  const station = (id: string) => ({ id, name: id })
  const result = (...journeys: FareJourney[]) => ({ from: station('A'), to: station('B'), journeys }) as unknown as TripResult

  it('puts an estimate on the journey and never a time on its legs', () => {
    const [row] = retimeTrips(result(tjJourney('tj')), engine, context, undefined, { mode: 'fields', ...inputs }).journeys
    const expected = estimateTjLeg(toRouteLegs(row!.legs).legs[0] as never, 12 * 3600, inputs)!
    expect(row!.estimate).toEqual({ durationS: expected.waitS + expected.rideS, fromS: 0, rideS: [expected.rideS] })
    expect(row!.arrivalAt).toBeUndefined()
    const leg = row!.legs[0]!
    expect(leg.type === 'RIDE' && (leg.departureAt ?? leg.arrivalAt ?? leg.stopTimes)).toBeUndefined()
  })

  it('counts from the first boarding when a timed ride opens the journey', () => {
    const train = { type: 'RIDE', line: 'KCI:B', operator: 'KCI', from: { id: 'KCI-A' }, to: { id: 'KCI-B' }, stops: [{ id: 'KCI-A' }, { id: 'KCI-B' }], distanceM: 5000, departureAt: at('12:08') }
    const tj = tjJourney('mixed')
    const mixed = { ...tj, legs: [train, ...tj.legs] } as unknown as FareJourney
    // The train boards at 12:08 and the journey is estimated to land at 12:50.
    const fixed = { ...engine, estimateJourney: () => ({ arrivalS: 12 * 3600 + 50 * 60, rideS: [null, 900] }) } as unknown as Tsundere
    const [row] = retimeTrips(result(mixed), fixed, context, undefined, { mode: 'fields', ...inputs }).journeys
    expect(row!.estimate).toEqual({ durationS: 50 * 60, fromS: 8 * 60, rideS: [null, 900] })
  })

  it('adds nothing with the switch off, or without estimate options at all', () => {
    expect(retimeTrips(result(tjJourney('tj')), engine, context, undefined, { mode: 'off', ...inputs }).journeys[0]!.estimate).toBeUndefined()
    expect(retimeTrips(result(tjJourney('tj')), engine, context).journeys[0]!.estimate).toBeUndefined()
  })

  it('keeps the old order in fields mode, and sorts by estimated arrival in sort mode', () => {
    // A train arriving at 14:00 against a bus journey estimated well before it.
    const rows = [railJourney('rail', at('14:00')), railJourney('rail2', at('15:00')), tjJourney('tj')]
    const fields = retimeTrips(result(...rows), engine, context, undefined, { mode: 'fields', ...inputs }).journeys
    expect(idsOf(fields)).toEqual(['rail', 'rail2', 'tj'])
    const sorted = retimeTrips(result(...rows), engine, context, undefined, { mode: 'sort', ...inputs }).journeys
    expect(idsOf(sorted)).toEqual(['tj', 'rail', 'rail2'])
  })

  it('keeps the engine order between estimates closer than the margin', () => {
    // Two bus routes estimated alike, behind them a train: the buses keep their engine order.
    const rows = [tjJourney('tj-a'), tjJourney('tj-b'), railJourney('rail', at('18:00'))]
    const sorted = retimeTrips(result(...rows), engine, context, undefined, { mode: 'sort', ...inputs }).journeys
    expect(idsOf(sorted)).toEqual(['tj-a', 'tj-b', 'rail'])
  })

  it('leaves a journey it cannot estimate in the untimed tail even in sort mode', () => {
    const closed = { ...inputs, serviceHours: new Map([[code, [0, 3600] as [number, number]]]) }
    const rows = [tjJourney('tj'), railJourney('rail', at('14:00')), railJourney('rail2', at('15:00'))]
    const sorted = retimeTrips(result(...rows), engine, context, undefined, { mode: 'sort', ...closed }).journeys
    expect(idsOf(sorted)).toEqual(['rail', 'rail2', 'tj'])
    expect(sorted[2]!.estimate).toBeUndefined()
  })
})

describe('byArrival with estimated arrivals', () => {
  const estimates = (byId: Record<string, string>) => (j: FareJourney) => {
    const hhmm = byId[(j as unknown as { id: string }).id]
    return hhmm ? Date.parse(at(hhmm)) : undefined
  }

  it('sorts estimated rows among the timed ones on one rule', () => {
    const sorted = byArrival(
      [journey('late', at('09:10')), journey('est'), journey('u'), journey('early', at('09:00'))],
      estimates({ est: '09:05' })
    )
    expect(idsOf(sorted)).toEqual(['early', 'est', 'late', 'u'])
  })

  /*
   * Sudirman -> Karet Kuningan at 12:00: the engine ranked walk 560 m + 13E
   * first (~12:22), then LRT + 4D (~12:18), then Galunggung + 6 (~12:17).
   * Both of the others beat 13E by the margin; a minute between them is not
   * enough to overrule the engine.
   */
  it('lets an estimate overtake the engine\'s order only by the margin', () => {
    const sorted = byArrival(
      [journey('13E'), journey('lrt'), journey('6')],
      estimates({ '13E': '12:22', 'lrt': '12:18', '6': '12:17' })
    )
    expect(idsOf(sorted)).toEqual(['lrt', '6', '13E'])
  })

  it('needs the margin against a timetabled arrival too, either way round', () => {
    const train = journey('train', at('12:20'))
    expect(idsOf(byArrival([train, journey('bus')], estimates({ bus: '12:18' })))).toEqual(['train', 'bus'])
    expect(idsOf(byArrival([train, journey('bus')], estimates({ bus: '12:16' })))).toEqual(['bus', 'train'])
    expect(idsOf(byArrival([journey('bus'), train], estimates({ bus: '12:22' })))).toEqual(['bus', 'train'])
  })

  // An estimate between two trains must not let the later train past the earlier.
  it('never puts a train above an earlier train, whatever the estimates between them', () => {
    const sorted = byArrival(
      [journey('t2', at('12:21')), journey('est'), journey('t1', at('12:20'))],
      estimates({ est: '12:19' })
    )
    expect(idsOf(sorted)).toEqual(['est', 't1', 't2'])
  })

  // The documented consequence of measuring the margin against the earliest
  // remaining journey: the pairwise preferences here form a cycle.
  it('measures the margin against the earliest remaining journey', () => {
    const sorted = byArrival([journey('A'), journey('B'), journey('C')], estimates({ A: '12:20', B: '12:18', C: '12:16' }))
    expect(idsOf(sorted)).toEqual(['B', 'C', 'A'])
  })

  it('still sorts timetabled arrivals exactly, minute for minute', () => {
    const sorted = byArrival(
      [journey('b', at('12:21')), journey('a', at('12:20')), journey('est')],
      estimates({ est: '13:00' })
    )
    expect(idsOf(sorted)).toEqual(['a', 'b', 'est'])
  })
})
