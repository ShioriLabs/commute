import { makeEndpointGuard, serviceBreakKey, type GraphEdge, type RouteGraph, type RouteLeg } from '../router'
import { Bag, type Label } from './bag'
import {
  DEFAULT_RANK_WEIGHTS,
  DISTANCE_BUCKET_M,
  WAIT_BUCKET_S,
  bucket,
  effectiveWalkM,
  rankScore,
  type Criteria,
  type RankWeights
} from './criteria'
import type { PlanInstrument } from './instrument'
import { hopsToLegs, traceToHops, type Trace } from './materialise'

/*
 * In-station walking a transfer distance does not include. Transfers are
 * surveyed gate to gate, but the rider walks door to door — along the platform,
 * up to the concourse, through the gate line, and back down at the far end. On
 * a KCI interchange that is the larger half of the trip, and omitting it made
 * short transfers look free next to riding the same distance.
 *
 * Flat rather than per-station: the engine knows nothing about platform
 * layouts, so a number per station would imply precision that does not exist.
 * Two values because only the gate line varies — a noTap transfer stays inside
 * the paid zone and pays for circulation only.
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
  /**
   * Labels kept per (stop, round). Lossy but necessary — see Bag for what a full
   * one throws away, and the measured table above DEFAULTS for what width costs.
   */
  maxBagSize?: number
  /** Journeys returned. */
  maxResults?: number
  weights?: RankWeights
  /** lineCode -> seconds between vehicles. Missing lines fall back to the default. */
  headwaysS?: Map<string, number>
  /** Used when a line has no headway data at all. */
  defaultHeadwayS?: number
  scoreFare?: FareScorer
  /**
   * Counters describing what the search did. See PlanInstrument.
   *
   * Absent in production. It exists so the caps and heuristics below can be
   * argued about with numbers instead of adjectives.
   */
  instrument?: PlanInstrument
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
 * How often one stop may be re-queued inside a single round before the search
 * stops believing it.
 *
 * Not a quality setting. The worklist's termination argument assumes a bag only
 * ever improves, which stops being true when it is full and starts evicting —
 * see the re-queue site in `plan`. Generous enough that a legitimately
 * hard-to-relax stop is unaffected: the ODs that converge at all settle well
 * inside this, and the ones that do not were running forever.
 */
const MAX_SAME_ROUND_REVISITS = 32

/*
 * Measured 2026-09-05 on the real network: 300 seeded OD pairs, no scoreFare,
 * normalised by the findRoute control (median 0.11ms). Numbers from another
 * machine or another date are not comparable — the earlier table in this comment
 * outlived the code it described because it did not say when it was taken.
 *
 *   maxBagSize   median     p95      max   journeys/OD   gained   lost
 *   4             9.09ms  21.6ms   32.7ms      2.407          -      -
 *   6            15.17ms  39.4ms   48.7ms      2.857        121      5
 *   8            18.85ms  50.5ms   73.5ms      2.993        141      3   <- default
 *   12           26.20ms  82.2ms  155.3ms      3.133        157      3
 *
 * (gained/lost are pairs whose journey count moved against bag 4. No width
 * reintroduced a non-terminating pair: n=300 throughout. The bag-8 row is a
 * confirmation run with it set as the default rather than passed as a flag,
 * which is why it reads a little faster than the sweep that chose it — the
 * spread between those two runs is the machine, and the control column is how
 * you tell that from a real change.)
 *
 * The ceiling is no longer the platform. Workers Paid allows 30s of CPU per
 * request against the free tier's 10ms, and /trips answers are KV-cached for
 * 20h, so a cold search is amortised across a day of requests for that OD. What
 * bounds this now is rider-perceived latency, and 8 was chosen to land p95 in a
 * 50-75ms budget while still buying journeys — 4 -> 8 is +24% journeys per OD
 * for 141 pairs gaining against 3 losing.
 *
 * The previous note here claimed that "past bag8 the extra width buys almost no
 * new journeys". That is no longer true and was not wrong when written: it was
 * measured while dominance still compared across lines, which discarded most of
 * what a wider bag would have held. Since dominance became state-aware the width
 * is what decides how many of those states survive, and 12 does still buy more.
 * It is left on the table deliberately, because p95 82ms is past the budget.
 *
 * maxRounds stays at 4. Cutting it to 3 looks cheap but makes
 * MRTJ-LBB -> LRTJBDB-JTM unroutable entirely, because that journey genuinely
 * needs three boardings. Losing a route is worse than ranking one imperfectly.
 * Note it IS binding — 109 of the 300 pairs reach round 4 — so whether a fifth
 * boarding would earn its cost is an open measurement, not a settled question.
 *
 * If this needs to get faster, profile first. The shape of the cost has moved
 * three times, and each time the guess would have been wrong.
 */
const DEFAULTS = {
  maxRounds: 4,
  maxBagSize: 8,
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
 *    different lines is two states — and the bag's dominance test compares only
 *    within a state, or a line that shadows another for part of its run deletes
 *    the one-seat rides that had to stay aboard.
 * 2. Journeys that trade one axis against another both survive, so the caller
 *    gets a genuine choice rather than one answer picked on the rider's behalf.
 *
 * Neither TRANSFER_PENALTY_M nor LINE_CHANGE_PENALTY_M applies here. They proxy
 * for the wait and hassle of changing vehicle, which `boardings` and `waitS`
 * model outright — charging both penalises a transfer twice. The concourse
 * allowance is not a third copy: it is walking distance the survey did not
 * measure, and it applies whether or not a vehicle change happens.
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
    scoreFare,
    instrument
  } = options

  const { adjacency, restrictions, serviceBreaks } = graph
  if (!adjacency.has(fromStationId) || !adjacency.has(toStationId)) return []

  // Same endpoint rules as findRoute — literally the same guard, so the two
  // engines cannot drift. They constrain only this trip's own origin and
  // destination, never a stop passed through mid-journey.
  const isForbiddenHop = makeEndpointGuard(restrictions, fromStationId, toStationId)

  const bagFor = new Map<string, Bag<Trace | null>>()
  const bagKey = (stop: string, round: number) => `${round}:${stop}`
  const getBag = (stop: string, round: number): Bag<Trace | null> => {
    const key = bagKey(stop, round)
    let bag = bagFor.get(key)
    if (!bag) {
      bag = new Bag<Trace | null>({ maxSize: maxBagSize, weights, instrument })
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

  // The one bag that is a result set rather than a state: the journey is over,
  // so the line the rider arrived on decides nothing further and two labels here
  // are two finished journeys, comparable outright.
  const destinationBag = new Bag<Trace | null>({ maxSize: maxBagSize, weights, comparesAcrossLines: true, instrument })
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
    if (instrument && round > instrument.roundsUsed) instrument.roundsUsed = round
    const pending = [...frontier]
    const queued = new Set(pending)
    const nextFrontier = new Set<string>()
    // Per round: a stop that keeps being re-queued is cycling, not converging.
    const revisits = new Map<string, number>()

    /*
     * Advanced with a cursor rather than `pending.shift()`, which is O(n) per
     * pop and made draining a round quadratic in its own frontier — worst
     * exactly where it hurts most, on the long ODs whose frontier is biggest.
     * The array is only appended to, so entries behind `head` are spent rather
     * than leaked; it is discarded at the end of the round either way.
     */
    let head = 0
    while (head < pending.length) {
      const stop = pending[head++]!
      queued.delete(stop)

      for (const label of [...getBag(stop, round).labels()]) {
        if (instrument) instrument.labelsExpanded++
        for (const edge of adjacency.get(stop) ?? []) {
          if (instrument) instrument.adjacencyLookups++
          if (isForbiddenHop(stop, edge.to)) continue

          const isWalk = edge.lineCode === null
          /*
           * Staying on the line is normally free. It is not when the turn is a
           * service break: same line code, different train, because the loop
           * closes here (see ServiceBreak). Charging it a boarding is what stops
           * a ride through the junction from dominating the real one-seat ride
           * the long way round.
           *
           * The previous stop comes off the trace's last hop, which is already
           * the hop into this stop — no extra state on the label.
           */
          const sameLine = !isWalk && edge.lineCode === label.incomingLine
          const brokenTurn = sameLine
            && serviceBreaks.size > 0
            && label.trace !== null
            && serviceBreaks.has(serviceBreakKey(edge.lineCode!, label.trace.hop.from, stop, edge.to))
          const boarding = !isWalk && (!sameLine || brokenTurn)
          if (boarding && round === maxRounds) {
            if (instrument) instrument.roundBudgetPrunes++
            continue
          }

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
          if (criteria.boardings > bestCompletedBoardings + 1) {
            if (instrument) instrument.boardingsBoundPrunes++
            continue
          }
          if (destinationBag.isDominated(criteria)) {
            if (instrument) instrument.targetPrunes++
            continue
          }

          const next: Label<Trace | null> = {
            criteria,
            // A walk resets the boarded line, which is what makes boarding
            // after a transfer free — matching findRoute.
            incomingLine: isWalk ? null : edge.lineCode,
            trace: { hop: { from: stop, to: edge.to, edge, breaksService: brokenTurn }, previous: label.trace }
          }

          if (edge.to === toStationId) {
            if (instrument) instrument.destinationInserts++
            destinationBag.insert(next)
            if (criteria.boardings < bestCompletedBoardings) bestCompletedBoardings = criteria.boardings
            continue
          }

          if (boarding) {
            if (getBag(edge.to, round + 1).insert(next)) nextFrontier.add(edge.to)
          } else if (getBag(edge.to, round).insert(next) && !queued.has(edge.to)) {
            /*
             * Cap how often one stop may be re-queued within a round.
             *
             * The worklist terminates only if `insert` returning true means the
             * bag strictly improved, so acceptances are finite. That holds while
             * a bag has room and fails once it is full: a label can be accepted
             * (re-queueing this stop), be evicted by the next arrival, and then
             * a variant of it arrives and is accepted again. Nothing stops a bag
             * revisiting a state it already held, and each revisit re-queues.
             *
             * Measured on TJ-H00002P -> TJ-H00262P (Pisangan -> Warung Jati):
             * about two acceptances per expansion with 60% of accepted labels
             * later evicted. At maxBagSize 3 that churn still settles, in 29ms.
             * At 4 it does not settle at all — one extra label per bag is the
             * difference between finishing and running forever.
             *
             * The cap is a safety net, not a tuning knob: it only binds once
             * monotonicity has already failed, which is why it is generous. A
             * stop that has been re-expanded this many times in a single round
             * is cycling, and the labels it would go on to accept are variants
             * of ones it has already held.
             */
            const seen = (revisits.get(edge.to) ?? 0) + 1
            if (seen <= MAX_SAME_ROUND_REVISITS) {
              revisits.set(edge.to, seen)
              queued.add(edge.to)
              pending.push(edge.to)
            }
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
 * The stops a journey visits and which of them it walks between, flattened.
 *
 * Deliberately blind to where the ride was split as well as to which line served
 * it. On a corridor several lines share, a journey can change vehicle at any of
 * the shared stops and come out with the identical stop list — six renderings of
 * one trip, and a rider cannot tell them apart. Walks keep a marker of their own
 * so a footpath between two stops never reads as a ride between them.
 */
function journeyPath(legs: readonly RouteLeg[]): string {
  const path: string[] = []
  const push = (id: string) => {
    if (path[path.length - 1] !== id) path.push(id)
  }
  for (const leg of legs) {
    if (leg.type === 'RIDE') {
      for (const id of leg.stationIds) push(id)
    } else {
      push(leg.fromStationId)
      path.push('~')
      path.push(leg.toStationId)
    }
  }
  return path.join('>')
}

/*
 * Order the front, and drop journeys that are the same trip wearing a different
 * line code — or the same trip boarded twice where one vehicle would do.
 *
 * TJ's overlapping corridors (13 / 13E / L13E share a trunk) otherwise fill the
 * result set with five renderings of one journey — the same shape the old
 * router's LINE_CHANGE_PENALTY_M existed to suppress. Sorted before deduping, so
 * the survivor of each path is the best-ranked way of riding it: given the
 * choice between staying aboard and changing vehicle for the same stops, that is
 * the one-seat ride.
 */
function rank(journeys: Journey[], weights: RankWeights): Journey[] {
  const seen = new Set<string>()
  const unique: Journey[] = []
  for (const journey of [...journeys].sort((a, b) => rankScore(a.criteria, weights) - rankScore(b.criteria, weights))) {
    const path = journeyPath(journey.legs)
    if (seen.has(path)) continue
    seen.add(path)
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

  const assign = (index: number, label: JourneyLabel) => {
    if (index >= 0) journeys[index]!.labels.push(label)
  }

  assign(winner(journeys.map(j => j.criteria.boardings)), 'FEWEST_CHANGES')
  // Effective walking, not the measured figure, so the badge agrees with what
  // dominance decided — and with what the rider's legs will report.
  assign(winner(journeys.map(j => bucket(effectiveWalkM(j.criteria), DISTANCE_BUCKET_M))), 'LEAST_WALKING')
  assign(winner(journeys.map(j => bucket(j.criteria.waitS, WAIT_BUCKET_S))), 'SHORTEST_WAIT')
  assign(winner(journeys.map(j => j.criteria.fare)), 'CHEAPEST')

  return journeys
}
