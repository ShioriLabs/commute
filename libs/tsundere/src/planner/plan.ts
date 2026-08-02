import type { RouteGraph, RouteLeg } from '../router'
import { Bag, type Label } from './bag'
import {
  DEFAULT_RANK_WEIGHTS,
  rankScore,
  type Criteria,
  type RankWeights
} from './criteria'
import { hopsToLegs, traceToHops, type Trace } from './materialise'

/**
 * Fare for a complete journey, or null when it cannot be priced.
 *
 * Deliberately takes materialised legs rather than anything internal, so the
 * caller passes a thin closure over fare logic this package knows nothing
 * about. Null means "unknown", which the dominance test treats as
 * incomparable — never as free.
 */
export type FareScorer = (legs: readonly RouteLeg[]) => number | null

export interface PlanOptions {
  /** Vehicle boardings allowed. Beyond four is not a journey anyone takes. */
  maxRounds?: number
  /** Labels kept per (stop, round). See Bag — this is a lossy but necessary cap. */
  maxBagSize?: number
  /** Journeys returned. */
  maxResults?: number
  weights?: RankWeights
  /** lineCode -> seconds between vehicles. Missing lines fall back to the default. */
  headwaysS?: Map<string, number>
  /** Used when a line has no headway data at all. */
  defaultHeadwayS?: number
  scoreFare?: FareScorer
}

export interface Journey {
  legs: RouteLeg[]
  criteria: Criteria
}

/*
 * Measured on the real network (372 stops, 1293 edges, 116 transfers), Node 22,
 * steady state after warm-up, 8 representative ODs:
 *
 *   maxRounds  maxBagSize   median    max   journeys   primary route
 *   4          8             15.1ms  31.0ms  up to 5   baseline
 *   4          4              7.1ms  12.9ms  up to 4   —
 *   4          2              3.8ms   6.0ms  up to 2   same as bag8 in 7 of 8
 *   3          8              3.9ms  15.3ms  up to 3   loses a 3-boarding OD
 *
 * maxBagSize 2 is the default because Cloudflare Workers' free tier allows
 * **10ms of CPU per request** and bag8 does not fit. The cost is real and worth
 * stating: TJ-H00003P -> TJ-H00061S drops from a 3-boarding journey to a
 * 4-boarding one, and fewer distinct alternatives survive to be returned.
 *
 * maxRounds stays at 4 — cutting it to 3 looks cheap but makes
 * MRTJ-LBB -> LRTJBDB-JTM unroutable entirely, because that journey genuinely
 * needs three boardings. Losing a route is worse than ranking one imperfectly.
 *
 * Raise maxBagSize when the caller can afford it: a paid Worker, a cached path,
 * or an offline batch. The engine is correct at any size; this default is a
 * budget, not a limit of the algorithm.
 */
const DEFAULTS = {
  maxRounds: 4,
  maxBagSize: 2,
  maxResults: 5,
  /*
   * Fifteen minutes, the median TJ headway. Only used for lines with no data;
   * generous enough that an unknown line is not silently preferred over a
   * measured one.
   */
  defaultHeadwayS: 900
} as const

/*
 * Expected wait for a rider arriving at a random time is half the headway.
 *
 * That uniform-arrival assumption is the whole time model. It is not a
 * timetable: this engine cannot say when the next vehicle comes, only how long
 * you tend to wait for one.
 */
function expectedWaitS(lineCode: string, headwaysS: Map<string, number> | undefined, fallback: number): number {
  return (headwaysS?.get(lineCode) ?? fallback) / 2
}

/**
 * Multi-criteria journey search.
 *
 * RAPTOR's round structure — round k is everything reachable with k vehicle
 * boardings — with a Pareto bag per (stop, round) instead of a single scalar
 * cost. Two things follow from that shape:
 *
 * 1. The line boarded is part of the label, so arriving at a stop on two
 *    different lines is two states. That is what findRoute could not express,
 *    and why its line-change penalty was applied against a predecessor a later
 *    relaxation might supersede.
 * 2. Journeys that trade one axis against another both survive, so the caller
 *    gets a genuine choice rather than one answer picked on the rider's behalf.
 *
 * Neither TRANSFER_PENALTY_M nor LINE_CHANGE_PENALTY_M applies here. Their own
 * comments say they proxy for the wait and hassle of changing vehicle, which
 * `boardings` and `waitS` now model outright — charging both would penalise a
 * transfer twice.
 */
export function plan(
  graph: RouteGraph,
  fromStationId: string,
  toStationId: string,
  options: PlanOptions = {}
): Journey[] {
  const {
    maxRounds = DEFAULTS.maxRounds,
    maxBagSize = DEFAULTS.maxBagSize,
    maxResults = DEFAULTS.maxResults,
    weights = DEFAULT_RANK_WEIGHTS,
    headwaysS,
    defaultHeadwayS = DEFAULTS.defaultHeadwayS,
    scoreFare
  } = options

  const { adjacency, restrictions } = graph
  if (!adjacency.has(fromStationId) || !adjacency.has(toStationId)) return []

  // Same endpoint rules as findRoute: they constrain only this trip's own
  // origin and destination, never a stop passed through mid-journey.
  const originRestriction = restrictions.get(fromStationId)
  const destRestriction = restrictions.get(toStationId)

  const bagFor = new Map<string, Bag<Trace | null>>()
  const bagKey = (stop: string, round: number) => `${round}:${stop}`
  const getBag = (stop: string, round: number): Bag<Trace | null> => {
    const key = bagKey(stop, round)
    let bag = bagFor.get(key)
    if (!bag) {
      bag = new Bag<Trace | null>({ maxSize: maxBagSize, weights })
      bagFor.set(key, bag)
    }
    return bag
  }

  const origin: Label<Trace | null> = {
    criteria: { boardings: 0, rideDistanceM: 0, walkDistanceM: 0, waitS: 0, fare: null },
    incomingLine: null,
    trace: null
  }
  getBag(fromStationId, 0).insert(origin)

  const destinationBag = new Bag<Trace | null>({ maxSize: maxBagSize, weights })

  /*
   * One pass per boarding.
   *
   * Round k holds everything reachable having boarded k times. Within a round a
   * label may ride on along its current line and may walk, both for free — a
   * trip is ridden to any stop downstream of where you got on, and a footpath
   * does not board anything. Only boarding a different line opens the next
   * round.
   *
   * The queue is what makes "within a round" work: relaxing a stop can improve
   * another stop in the SAME round, which then has to be revisited. Reading and
   * writing the same round's bag while iterating is why this is a worklist and
   * not a for-loop over a frontier set.
   */
  let frontier: string[] = [fromStationId]

  for (let round = 0; round <= maxRounds && frontier.length > 0; round++) {
    const pending = [...frontier]
    const queued = new Set(pending)
    const nextFrontier = new Set<string>()

    while (pending.length > 0) {
      const stop = pending.shift()!
      queued.delete(stop)

      for (const label of [...getBag(stop, round).labels()]) {
        for (const edge of adjacency.get(stop) ?? []) {
          if (stop === fromStationId && originRestriction && edge.to === originRestriction.forbiddenNeighborId) continue
          if (edge.to === toStationId && destRestriction && stop === destRestriction.forbiddenNeighborId) continue

          const isWalk = edge.lineCode === null
          const boarding = !isWalk && edge.lineCode !== label.incomingLine
          if (boarding && round === maxRounds) continue

          const criteria: Criteria = {
            boardings: label.criteria.boardings + (boarding ? 1 : 0),
            rideDistanceM: label.criteria.rideDistanceM + (isWalk ? 0 : edge.distanceM),
            walkDistanceM: label.criteria.walkDistanceM + (isWalk ? edge.distanceM : 0),
            waitS: label.criteria.waitS + (boarding ? expectedWaitS(edge.lineCode!, headwaysS, defaultHeadwayS) : 0),
            fare: null
          }

          // Target pruning: a label already beaten by a completed journey cannot
          // lead to a better one.
          if (destinationBag.isDominated(criteria)) continue

          const next: Label<Trace | null> = {
            criteria,
            // A walk resets the boarded line, which is what makes boarding
            // after a transfer free — matching findRoute.
            incomingLine: isWalk ? null : edge.lineCode,
            trace: { hop: { from: stop, to: edge.to, edge }, previous: label.trace }
          }

          if (edge.to === toStationId) {
            destinationBag.insert(next)
            continue
          }

          if (boarding) {
            if (getBag(edge.to, round + 1).insert(next)) nextFrontier.add(edge.to)
          } else if (getBag(edge.to, round).insert(next) && !queued.has(edge.to)) {
            queued.add(edge.to)
            pending.push(edge.to)
          }
        }
      }
    }

    frontier = [...nextFrontier]
  }

  // Fares are priced once per surviving journey, never per label. They are not
  // additive per edge — progressive on KCI, capped on LRTJBDB, an OD matrix on
  // MRTJ, journey-capped under JakLingko — so a partial journey's fare says
  // nothing about the whole. That also means fare never prunes the search: the
  // result is the cheapest among journeys competitive on the other axes, not
  // the globally cheapest.
  const journeys: Journey[] = destinationBag.labels().map((label) => {
    const legs = hopsToLegs(traceToHops(label.trace))
    return {
      legs,
      criteria: { ...label.criteria, fare: scoreFare ? scoreFare(legs) : null }
    }
  })

  return rank(journeys, weights).slice(0, maxResults)
}

/*
 * Order the front, and drop journeys that are the same trip wearing a different
 * line code.
 *
 * TJ's overlapping corridors (13 / 13E / L13E share a trunk) otherwise fill the
 * result set with five renderings of one journey — the same shape the old
 * router's LINE_CHANGE_PENALTY_M existed to suppress.
 */
function rank(journeys: Journey[], weights: RankWeights): Journey[] {
  const seen = new Set<string>()
  const unique: Journey[] = []
  for (const journey of [...journeys].sort((a, b) => rankScore(a.criteria, weights) - rankScore(b.criteria, weights))) {
    // Shape = the stops visited and where the walks fall, ignoring which line
    // served each ride.
    const shape = journey.legs
      .map(leg => (leg.type === 'RIDE' ? `R:${leg.stationIds.join('>')}` : `W:${leg.fromStationId}>${leg.toStationId}`))
      .join('|')
    if (seen.has(shape)) continue
    seen.add(shape)
    unique.push(journey)
  }
  return unique
}
