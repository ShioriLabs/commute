import type { Operator, FareContext } from '@commute/constants'
import type { Criteria, JourneyLabel, RouteLeg } from '@commute/tsundere'
import type { FareJourney, FareJourneyLabel, FareResultLeg, FareResultLineRef, FareResultStation, OperatorCode } from '@commute/schemas'
import { calculateTransferFare, resolveCorridorMerges, type CorridorMerge } from 'utils/fare'
import { summarizeFares, type FareSummary } from 'utils/fare-summary'
import { computeHeadsignCode } from 'utils/headsign'
import { findInterliningLineCodes, mergeInterlinedLegs } from 'utils/interlining'

/*
 * Turning one routed journey into the shape the API returns.
 *
 * Lifted out of routes/fares.ts unchanged in behaviour, for one reason: the
 * route now answers with several journeys instead of one, and running this per
 * journey inline would either duplicate ~130 lines or issue one station query
 * per journey. Splitting it in two — everything before the DB, everything
 * after — lets the caller collect station ids across every journey and resolve
 * them in a single batched lookup.
 *
 * Both halves are pure. That is deliberate: this is where all the fiddly
 * display logic lives (corridor folding, interlining, headsigns) and none of it
 * was testable while it sat inside a request handler.
 */

// Station ids are `${operator}-${topologyCode}`; the headsign walk works in
// topology codes, so the operator prefix is stripped and re-added around it.
interface HeadsignRef {
  terminusId: string
  viaId: string | null
}

interface LegLineMeta {
  interlined: boolean
  lines: { lineCode: string, headsign: HeadsignRef | null }[]
}

export interface JourneyPlan {
  /** Post-mergeInterlinedLegs, which is also what the fare was priced on. */
  legs: RouteLeg[]
  summary: FareSummary
  corridorMerges: Map<number, CorridorMerge>
  legLines: (LegLineMeta | null)[]
  /*
   * The engine's own numbers, when a planner produced this journey. Absent for
   * a findRoute result, which has no criteria vector — `boardings` and
   * `walkDistanceM` are then derived from the legs instead.
   */
  criteria: Criteria | null
  labels: JourneyLabel[]
  /**
   * Every station id this journey needs a name for — stops, plus each service
   * line's headsign terminus and via. The caller unions these across journeys
   * and fetches once, so under-reporting here surfaces as raw ids leaking into
   * the response rather than as a crash.
   */
  stationIds: string[]
}

/** Everything derivable from the legs alone. No I/O. */
export function planJourney(
  rawLegs: RouteLeg[],
  criteria: Criteria | null,
  labels: JourneyLabel[],
  context: FareContext
): JourneyPlan {
  // Collapse phantom line changes at interlined trunk nodes into one-seat legs.
  const legs = mergeInterlinedLegs(rawLegs)
  const summary = summarizeFares(legs, context)
  // Fold a surcharged corridor crossing + its chained free walk into one
  // display leg (adds the uncounted internal-peron walk). Fares/segments are
  // untouched — this is display + reported distance only.
  const corridorMerges = resolveCorridorMerges(legs, context)

  const headsignRef = (operator: string, headsign: { code: string, viaCode: string | null } | null): HeadsignRef | null =>
    headsign
      ? { terminusId: `${operator}-${headsign.code}`, viaId: headsign.viaCode ? `${operator}-${headsign.viaCode}` : null }
      : null

  // Per RIDE leg, the service line(s) that run it, each with its own headsign.
  // A leg on interlined track (the LRT Jabodebek DKA..CWG trunk) is served by
  // several lines in topology order; an ordinary leg carries just its own line.
  const legLines = legs.map((leg): LegLineMeta | null => {
    if (leg.type !== 'RIDE') return null
    const operator = leg.operator as Operator
    const codes = leg.stationIds.map(id => id.slice(operator.length + 1))
    const interlining = findInterliningLineCodes(operator, codes)
    const lineCodes = interlining.length >= 2 ? interlining : [leg.lineCode]
    return {
      interlined: interlining.length >= 2,
      lines: lineCodes.map(lineCode => ({
        lineCode,
        headsign: headsignRef(operator, computeHeadsignCode(operator, lineCode, codes))
      }))
    }
  })

  const stationIds = [...new Set([
    ...legs.flatMap(leg => leg.type === 'RIDE' ? leg.stationIds : [leg.fromStationId, leg.toStationId]),
    ...legLines.flatMap(meta => meta
      ? meta.lines.flatMap(l => l.headsign ? [l.headsign.terminusId, ...(l.headsign.viaId ? [l.headsign.viaId] : [])] : [])
      : [])
  ])]

  return { legs, summary, corridorMerges, legLines, criteria, labels, stationIds }
}

/** Resolves station ids to display references. */
export interface StationNamer {
  ref: (id: string) => FareResultStation
  known: (id: string | null) => id is string
}

/**
 * Build the name resolver from a fetched station list.
 *
 * A Map rather than `stations.find`, which is what this replaced: one linear
 * scan per stop, per headsign, per segment endpoint was fine for a single
 * journey and is thousands of comparisons across five.
 */
export function stationNamer(stations: { id: string, name: string }[]): StationNamer {
  const byId = new Map(stations.map(s => [s.id, s.name]))
  const ref = (id: string) => ({ id, name: byId.get(id) ?? id })
  const known = (id: string | null): id is string => id !== null && byId.has(id)
  return { ref, known }
}

const LABELS: Record<JourneyLabel, FareJourneyLabel> = {
  FEWEST_CHANGES: 'FEWEST_CHANGES',
  LEAST_WALKING: 'LEAST_WALKING',
  CHEAPEST: 'CHEAPEST',
  SHORTEST_WAIT: 'SHORTEST_WAIT'
}

/** A plan plus resolved names becomes the wire shape. No I/O. */
export function assembleJourney(plan: JourneyPlan, namer: StationNamer, context: FareContext): FareJourney {
  const { legs, summary, corridorMerges, legLines } = plan
  const { ref: stationRef, known } = namer

  // A terminus missing from the DB would echo its raw id; omit instead.
  const headsignName = (h: HeadsignRef | null): string | null =>
    h && known(h.terminusId)
      ? (known(h.viaId) ? `${stationRef(h.terminusId).name} via ${stationRef(h.viaId).name}` : stationRef(h.terminusId).name)
      : null

  const resultLegs: FareResultLeg[] = legs.flatMap((leg, index): FareResultLeg[] => {
    if (leg.type === 'TRANSFER') {
      const merge = corridorMerges.get(index)
      if (merge?.kind === 'ABSORBED') return [] // folded into the anchor leg
      if (merge?.kind === 'MERGE_ANCHOR') {
        return [{
          type: 'TRANSFER',
          from: stationRef(merge.fromStationId),
          to: stationRef(merge.toStationId),
          distanceM: merge.distanceM,
          fare: merge.fare,
          corridorLabel: merge.corridor.label
        }]
      }
      const surcharge = calculateTransferFare(leg.fromStationId, leg.toStationId, context, {
        prev: legs[index - 1],
        next: legs[index + 1]
      })
      return [{
        type: 'TRANSFER',
        from: stationRef(leg.fromStationId),
        to: stationRef(leg.toStationId),
        distanceM: leg.distanceM,
        ...(surcharge ? { fare: surcharge.fare, corridorLabel: surcharge.corridor.label } : {})
      }]
    }
    const meta = legLines[index]!
    // Line keys; name and colour resolve against /operators like everywhere
    // else, so the leg no longer carries three denormalised line fields.
    const serviceLines: FareResultLineRef[] = meta.lines.map(l => ({
      line: `${leg.operator}:${l.lineCode}`,
      headsign: headsignName(l.headsign)
    }))
    // On interlined track the router's line pick is arbitrary; present the
    // first topology-ordered service line as the primary for a stable badge.
    const primary = serviceLines[0]!
    return [{
      type: 'RIDE',
      line: primary.line,
      // tsundere types this `string` on purpose — it derives the operator by
      // splitting a station id and must not know Jakarta's operator codes. The
      // ids it split came from our own graph, so the narrowing is sound here.
      // OperatorCode rather than Operator: the public shape excludes the `NUL`
      // unknown sentinel, and a leg that reached here has a real operator.
      operator: leg.operator as OperatorCode,
      from: stationRef(leg.fromStationId),
      to: stationRef(leg.toStationId),
      stationCount: leg.stationIds.length,
      stops: leg.stationIds.map(stationRef),
      headsign: primary.headsign,
      distanceM: leg.distanceM,
      ...(meta.interlined ? { serviceLines } : {})
    }]
  })

  // summary.totalDistanceM already counts both raw legs of each merge; the only
  // uncounted distance is the internal-peron walk baked into each anchor.
  const internalWalkExtra = [...corridorMerges.values()].reduce(
    (sum, m) => sum + (m.kind === 'MERGE_ANCHOR' ? (m.corridor.internalWalkM ?? 0) : 0),
    0
  )
  // Each merge folds two transfers into one visible interchange, so the
  // rider-facing count drops by one per absorbed leg.
  const absorbedCount = [...corridorMerges.values()].filter(m => m.kind === 'ABSORBED').length

  return {
    legs: resultLegs,
    // Nested from/to, matching every other station reference in the API,
    // instead of four flat fromStationId/fromName/toStationId/toName fields.
    // `distanceM` is dropped: only leg-level distance is ever rendered.
    segments: summary.segments.map(s => ({
      // Same narrowing as the ride legs above: summarizeFares carries the
      // operator through as a bare string.
      operator: s.operator as OperatorCode,
      from: stationRef(s.fromStationId),
      to: stationRef(s.toStationId),
      fare: s.fare
    })),
    totalFare: summary.totalFare,
    totalDistanceM: summary.totalDistanceM + internalWalkExtra,
    transferCount: summary.transferCount - absorbedCount,
    labels: plan.labels.map(l => LABELS[l]),
    /*
     * From the engine when a planner produced this journey, otherwise counted
     * off the legs. The two agree: the planner increments `boardings` exactly
     * when it boards a line, which is one per RIDE leg after interlined legs
     * have been merged, and walking is the sum of the transfer distances.
     */
    boardings: plan.criteria?.boardings ?? legs.filter(l => l.type === 'RIDE').length,
    walkDistanceM: plan.criteria?.walkDistanceM
      ?? legs.reduce((sum, l) => sum + (l.type === 'TRANSFER' ? l.distanceM : 0), 0)
  }
}
