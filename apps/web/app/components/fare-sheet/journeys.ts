import type { FareJourney, FareJourneyLabel, FareResult, TripResult } from '@commute/schemas'

// Bridges a fare answer to the list of alternatives it may or may not carry.
// Kept in a `.ts` so it is testable — vitest collects `.test.ts` only, so
// anything in a `.tsx` is uncoverable.

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

/**
 * The line a journey is boarded on and the line it is alighted from.
 *
 * A stop's own line list cannot answer this. Manggarai serves Lin
 * Soekarno-Hatta, Lin Bogor and Lin Cikarang, and display order leads with the
 * first — so a summary signed from the station showed an airport roundel over a
 * Cikarang ride. The journey knows which one the rider actually gets on, and
 * this is the only thing that does.
 *
 * Walking legs are skipped at both ends: a journey that opens with a transfer
 * has still been boarded, just one leg later.
 *
 * Null on either end means there is nothing to say yet — no answer, or an
 * answer with no ride in it — and the caller should fall back to the stop's own
 * lines rather than render a blank.
 */
export function boardingLineKeys(journey: FareJourney | null): { from: string | null, to: string | null } {
  const rides = journey?.legs.filter(leg => leg.type === 'RIDE') ?? []
  return {
    from: rides[0]?.line ?? null,
    to: rides[rides.length - 1]?.line ?? null
  }
}
