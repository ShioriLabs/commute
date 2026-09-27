import type { FareJourney } from '@commute/schemas'

/*
 * A shareable name for one ROUTE, so a link can reopen the journey a rider was
 * actually looking at rather than just the pair of stations.
 *
 * The index cannot do this job. `retimeTrips` in apps/api expands each route
 * into up to three boardings, re-sorts the whole list by arrival, and does both
 * as a function of the request clock — so "option 3" names a different journey
 * a minute later, and both selection resets in this app say as much.
 *
 * So the key names the route SHAPE: which line, boarded where, left where, in
 * order. That is stable across re-timing by construction, which gives the
 * sharing rule its meaning — the link says "this way of getting there", and the
 * recipient's own request supplies the departures. Sending someone a train that
 * has already left would be worse than sending them the route and letting their
 * clock fill it in.
 *
 * Deliberately NOT a hash. A digest of the same facts would be shorter by a few
 * characters and unreadable, and this is a string that ends up in a URL people
 * paste to each other — a route that is legible when something goes wrong is
 * worth more here than the bytes.
 *
 * apps/api computes an equivalent grouping for its own purposes (`routeKey` in
 * utils/journey-times.ts, which decides which rows share a badge). The two are
 * intentionally separate: that one never leaves the server and can change shape
 * freely, while this one is a URL a rider may keep. If you change what makes
 * two journeys "the same route", change both.
 */

/*
 * Separators picked to survive a URL untouched.
 *
 * `.` `-` `~` and `_` are all unreserved in RFC 3986, so the key needs no
 * percent-encoding and stays readable in an address bar and in a chat preview.
 * `~` between legs and `.` after the line code are not arbitrary: they cannot
 * appear inside a line code or a station id, which is what keeps parsing
 * unambiguous without escaping.
 */
const LEG = '~'
const CODE = '.'
const STOP = '-'
/** A transfer, which is a step of the route even though nothing is ridden. */
const WALK = '_'

/*
 * Station ids are `OPERATOR-CODE` and the operator is recoverable from the line
 * key that precedes it, so the prefix is dropped: `KCI:C` + `CUK` says as much
 * as `KCI:C` + `KCI-CUK` in half the characters. TJ halte ids (`H00283P`) are
 * the long part and cannot be shortened, which sets the realistic ceiling — the
 * worst route measured against the live API is 56 characters.
 */
const bare = (stationId: string) => stationId.slice(stationId.indexOf('-') + 1)

/**
 * The route key for one journey.
 *
 * Transfers are included rather than skipped. Two journeys can ride the same
 * lines between the same stops and reach them by different interchanges, and
 * collapsing those into one key would make a shared link ambiguous between two
 * genuinely different walks.
 */
export function journeyKey(journey: FareJourney): string {
  return journey.legs
    .map(leg => (leg.type === 'RIDE'
      // The line key is `OPERATOR:CODE`; the operator is already implied by the
      // station ids it sits beside, so only the code is carried.
      ? `${leg.line.slice(leg.line.indexOf(':') + 1)}${CODE}${bare(leg.from.id)}${STOP}${bare(leg.to.id)}`
      : `${WALK}${bare(leg.to.id)}`))
    .join(LEG)
}

/**
 * Which journey a shared key names, or `null` when none of them does.
 *
 * Null is an ordinary outcome, not an error. A route can legitimately vanish
 * between the sender's request and the recipient's — a different service day, a
 * `modes` filter the recipient has set, a corridor that has since closed — and
 * the honest response is to show them what does run rather than an error about
 * a journey they never asked for by name. Callers fall back to the first row.
 */
export function findJourneyByKey(journeys: FareJourney[], key: string | null): number | null {
  if (!key) return null
  const index = journeys.findIndex(journey => journeyKey(journey) === key)
  return index >= 0 ? index : null
}
