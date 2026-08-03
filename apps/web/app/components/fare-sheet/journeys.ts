import type { FareJourney, FareJourneyLabel, FareResult } from '@commute/schemas'

/*
 * Bridging a fare answer to the list of alternatives it may or may not carry.
 *
 * Lives in a `.ts` rather than the component so it can be tested: the vitest
 * config collects `.test.ts` only, so anything in a `.tsx` is uncoverable.
 */

/**
 * The journeys to render, given any fare answer.
 *
 * `journeys` is absent from two real sources: a response cached before the field
 * shipped (the API's KV holds bodies for 20 hours, and the app's own IDB cache
 * longer), and a deployed web build talking to an API that has not caught up.
 * Both must render, so the primary is promoted to a one-item list rather than
 * the page failing on a missing array.
 */
export function journeysOf(result: FareResult): FareJourney[] {
  if (result.journeys?.length) return result.journeys
  return [{
    legs: result.legs,
    segments: result.segments,
    totalFare: result.totalFare,
    totalDistanceM: result.totalDistanceM,
    transferCount: result.transferCount,
    // A promoted primary was never compared against anything, so it has won
    // nothing. Empty is the honest answer, and the card renders no badge.
    labels: [],
    // Neither figure exists in the old shape. boardings is recoverable —
    // interchanges plus the first boarding — but walking distance is not, and
    // guessing zero would render "0 m jalan kaki" over a journey that walks.
    // The card omits the figure instead; see walkDistanceOf.
    boardings: result.transferCount + 1,
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
