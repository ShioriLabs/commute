import type { GraphEdge, RouteGraph, RouteLeg } from '../router'
import { Bag, type Label } from './bag'
import {
  DEFAULT_RANK_WEIGHTS,
  effectiveWalkM,
  rankScore,
  type Criteria,
  type RankWeights
} from './criteria'
import { hopsToLegs, traceToHops, type Trace } from './materialise'

/*
 * In-station walking a transfer distance does not include.
 *
 * Transfers are surveyed gate to gate. The rider's walk starts at a train door
 * and ends at another: along the platform, up to the concourse, out through the
 * gate line, and the same again in reverse at the far end. On a KCI interchange
 * that is comfortably the larger half of the trip, and leaving it out made short
 * transfers look free next to riding the same distance.
 *
 * A flat allowance rather than anything per-station: the engine knows nothing
 * about platform layouts, and inventing a number per station would imply a
 * precision that does not exist. Two values, because the gate line is the part
 * that varies — a noTap transfer stays inside the paid zone and skips it (see
 * GraphEdge.noTap), so it pays for circulation only.
 */
export const GATED_TRANSFER_WALK_M = 250
export const PAID_ZONE_TRANSFER_WALK_M = 100

const concourseWalkFor = (edge: GraphEdge) =>
  (edge.noTap ? PAID_ZONE_TRANSFER_WALK_M : GATED_TRANSFER_WALK_M)

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

/*
 * What a journey uniquely wins.
 *
 * The result set is a Pareto front, so every member is best at *something* —
 * but only the axes a rider recognises are worth surfacing. These are the ones
 * a person would name out loud when choosing.
 */
export type JourneyLabel = 'FEWEST_CHANGES' | 'LEAST_WALKING' | 'CHEAPEST' | 'SHORTEST_WAIT'

export interface Journey {
  legs: RouteLeg[]
  criteria: Criteria
  /*
   * Labels this journey and no other in the result set earns.
   *
   * Empty is normal and correct: a journey that ties on every axis it might
   * have won has nothing to distinguish it, and inventing a label ("Balanced")
   * would claim a property the engine never measured. Uniqueness is the whole
   * point — two cards both reading "Cheapest" tell a rider nothing.
   */
  labels: JourneyLabel[]
}

/*
 * Measured on the real network (372 stops, 1293 edges, 116 transfers), Node 22,
 * steady state after warm-up, 8 representative ODs:
 *
 *   maxBagSize   median    max   journeys found
 *   4             2.0ms   6.2ms  1-4      <- default
 *
 * (Earlier, before the boardings bound below: bag4 was 4.2ms median / 6.7ms
 * max. The bound roughly halved it and cut the worst one-seat case — riding
 * LRT Jabodebek end to end — from 8.2ms to 2.0ms.)
 *
 * The budget is Cloudflare Workers' free tier: 10ms of CPU per request. bag4
 * sits comfortably inside it even at the worst OD, and returns up to four
 * distinct journeys — enough for "fastest / fewest changes / cheapest" to have
 * something to label. Past bag8 the extra width buys almost no new journeys,
 * because dedup collapses the near-identical ones anyway.
 *
 * These numbers are ~4x better than the first working version, from three
 * changes found by measuring rather than guessing: `dominates` built an array
 * of tuples per call (36.8% of samples, plus 19.3% in GC), Bag.insert rebuilt
 * its array with `filter` on every insert, and target pruning had no bound on
 * boardings so the search kept expanding long after the answer was known. The
 * algorithm never changed. If this needs to get faster again, profile first —
 * the shape of the cost has moved three times now, and each time the guess
 * would have been wrong.
 *
 * maxRounds stays at 4. Cutting it to 3 looks cheap but makes
 * MRTJ-LBB -> LRTJBDB-JTM unroutable entirely, because that journey genuinely
 * needs three boardings. Losing a route is worse than ranking one imperfectly.
 */
const DEFAULTS = {
  maxRounds: 4,
  maxBagSize: 4,
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
 * transfer twice. The concourse allowance below is not a third copy of that: it
 * is walking distance the survey did not measure, and it applies to a walk
 * whether or not a vehicle change happens at either end of it.
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
    criteria: { boardings: 0, rideDistanceM: 0, walkDistanceM: 0, concourseWalkM: 0, waitS: 0, fare: null },
    incomingLine: null,
    trace: null
  }
  getBag(fromStationId, 0).insert(origin)

  const destinationBag = new Bag<Trace | null>({ maxSize: maxBagSize, weights })
  // Fewest boardings of any completed journey, for the bound above.
  let bestCompletedBoardings = Infinity

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

          /*
           * The criteria object is the other allocation hot spot: one per edge
           * examined, most of them discarded immediately by the dominance check
           * below. Profiling put ~19% of samples in GC. Nothing clever is
           * needed — the boardings check above already rejects the cheapest
           * case before this allocates, which is why it is hoisted.
           */
          const criteria: Criteria = {
            boardings: label.criteria.boardings + (boarding ? 1 : 0),
            rideDistanceM: label.criteria.rideDistanceM + (isWalk ? 0 : edge.distanceM),
            walkDistanceM: label.criteria.walkDistanceM + (isWalk ? edge.distanceM : 0),
            concourseWalkM: label.criteria.concourseWalkM + (isWalk ? concourseWalkFor(edge) : 0),
            waitS: label.criteria.waitS + (boarding ? expectedWaitS(edge.lineCode!, headwaysS, defaultHeadwayS) : 0),
            fare: null
          }

          /*
           * Target pruning.
           *
           * The dominance check alone is weak here: a partial label has spent
           * less distance than any *finished* journey, so it almost never looks
           * dominated, and the search keeps expanding long after the answer is
           * known. Measured on LRTJBDB-DKA -> LRTJBDB-JTM, a plain one-seat
           * ride: round 1 finds the b1 answer in 206 adjacency lookups, and
           * rounds 2-4 spend another 4232 to add one alternative.
           *
           * Boardings give a bound the other criteria cannot: they only ever
           * increase, so a label already far past the best completed journey
           * can never catch it, no matter what it does next.
           *
           * The slack matters. Pruning at `> bestCompleted` is sound for the
           * PRIMARY route but strips the alternatives this engine exists to
           * produce — measured, it cut most ODs from 2-5 journeys to 1, because
           * a same-boardings label that would have become a genuinely different
           * option gets cut before it finishes. One boarding of slack keeps
           * those and still collapses the runaway case: LRTJBDB-DKA ->
           * LRTJBDB-JTM went from 4438 adjacency lookups to a fraction of that.
           */
          if (criteria.boardings > bestCompletedBoardings + 1) continue
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
            if (criteria.boardings < bestCompletedBoardings) bestCompletedBoardings = criteria.boardings
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
      criteria: { ...label.criteria, fare: scoreFare ? scoreFare(legs) : null },
      labels: []
    }
  })

  return labelJourneys(rank(journeys, weights).slice(0, maxResults))
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

/*
 * Tag each journey with the axes it uniquely wins.
 *
 * Applied AFTER the maxResults cut, deliberately: a label has to describe the
 * set the rider is actually looking at. Labelling first and then trimming can
 * leave "Cheapest" on a card that is no longer the cheapest thing on screen.
 *
 * Quantised the same way `dominates` quantises, so a label means the same thing
 * the search meant. Without it a 30m walking difference reads as a win on
 * "least walking", which is noise a rider cannot act on and, worse, is a
 * *different* answer than the one dominance already gave.
 *
 * Fare is compared only among journeys that have one. An unpriced journey
 * cannot win CHEAPEST and cannot block another from winning it — same rule as
 * the dominance test, where unknown means incomparable rather than best or
 * worst.
 */
function labelJourneys(journeys: Journey[]): Journey[] {
  /*
   * A label is a comparison, so it needs something to compare against. A lone
   * journey is not "the one with fewest changes" — it is the only way to get
   * there, and badging it invites the rider to look for the alternative it
   * implies.
   */
  if (journeys.length < 2) return journeys

  /*
   * Index of the single lowest value, or -1 if nothing wins outright.
   *
   * Nulls are skipped rather than treated as high or low — an unknown fare is
   * incomparable, exactly as in `dominates`.
   */
  const winner = (values: (number | null)[]): number => {
    let bestIndex = -1
    let best = Infinity
    let tied = false
    for (let i = 0; i < values.length; i++) {
      const value = values[i]
      if (value === null || value === undefined) continue
      if (value < best) {
        best = value
        bestIndex = i
        tied = false
      } else if (value === best) {
        tied = true
      }
    }
    // A tie is not a win. Two journeys sharing the lowest fare means neither is
    // "the cheapest one", and saying so on both would be a lie by repetition.
    return tied ? -1 : bestIndex
  }

  const bucket = (value: number, size: number) => Math.round(value / size)

  const assign = (index: number, label: JourneyLabel) => {
    if (index >= 0) journeys[index]!.labels.push(label)
  }

  assign(winner(journeys.map(j => j.criteria.boardings)), 'FEWEST_CHANGES')
  // Effective walking, not the measured figure, so the badge agrees with what
  // dominance decided — and with what the rider's legs will report.
  assign(winner(journeys.map(j => bucket(effectiveWalkM(j.criteria), 100))), 'LEAST_WALKING')
  assign(winner(journeys.map(j => bucket(j.criteria.waitS, 60))), 'SHORTEST_WAIT')
  assign(winner(journeys.map(j => j.criteria.fare)), 'CHEAPEST')

  return journeys
}
