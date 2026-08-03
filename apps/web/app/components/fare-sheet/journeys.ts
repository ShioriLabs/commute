import type { FareJourney, FareJourneyLabel, FareResult, TripResult } from '@commute/schemas'

/*
 * Bridging a fare answer to the list of alternatives it may or may not carry.
 *
 * Lives in a `.ts` rather than the component so it can be tested: the vitest
 * config collects `.test.ts` only, so anything in a `.tsx` is uncoverable.
 */

/**
 * The journeys to render, from either endpoint's answer.
 *
 * `/_internal/trips` returns a `journeys` array; `/fares` returns a single route
 * with the fields at the top level. Normalising here means the card list does
 * not care which surface it is on — and a body cached under either shape still
 * renders, which matters because SWR persists them to IndexedDB and the API's
 * KV holds them for 20 hours.
 */
export function journeysOf(result: FareResult | TripResult): FareJourney[] {
  if ('journeys' in result && result.journeys?.length) return result.journeys
  // Narrowed by elimination: only FareResult carries the flat fields.
  const single = result as FareResult
  return [{
    legs: single.legs,
    segments: single.segments,
    totalFare: single.totalFare,
    totalDistanceM: single.totalDistanceM,
    transferCount: single.transferCount,
    // A single route was never compared against anything, so it has won
    // nothing. Empty is the honest answer, and the card renders no badge.
    labels: [],
    /*
     * Neither figure exists in the /fares shape. `boardings` is recoverable —
     * interchanges plus the first boarding — but walking distance is not, and
     * guessing zero would render "jalan 0 m" over a journey that walks. The
     * card omits the figure instead; see walkDistanceOf.
     */
    boardings: single.transferCount + 1,
    walkDistanceM: -1
  }]
}

/**
 * A journey's walking distance, or null when the response could not say.
 *
 * Only ever null for a promoted legacy primary. Callers must render nothing
 * rather than a zero, which would claim a walk-free journey.
 */
export function walkDistanceOf(journey: FareJourney): number | null {
  return journey.walkDistanceM < 0 ? null : journey.walkDistanceM
}

/*
 * Badge order.
 *
 * The engine assigns labels in its own order (boardings, walking, wait, fare),
 * which puts price last — and price is what riders scan for first. A fixed order
 * also means two cards never disagree about which of their shared labels leads.
 */
const LABEL_ORDER: FareJourneyLabel[] = ['CHEAPEST', 'FEWEST_CHANGES', 'LEAST_WALKING', 'SHORTEST_WAIT']

export function sortJourneyLabels(labels: readonly FareJourneyLabel[]): FareJourneyLabel[] {
  return LABEL_ORDER.filter(label => labels.includes(label))
}
