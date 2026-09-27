import { OPERATORS, PAYMENT_METHODS, type PaymentMethod } from '@commute/constants'
import type { OperatorCode } from '@commute/schemas'
import { isStaleDeparture, quantiseToSlot } from 'utils/departure-time'

// The fare search's persistent settings — what the criteria bar under the
// Dari/Ke fields edits.
//
// Two of these three genuinely change the number the API returns, and until now
// neither was reachable from the UI: `GET /fares/:from/:to` has always accepted
// `paymentMethod` and `at`, but use-fare-query built the URL with no query
// string at all. So every rider was quoted stored-value pricing regardless of
// what they actually tap with — on the Dukuh Atas corridor that is Rp 1 shown to
// someone who will be charged Rp 3.000.
//
// Persisted rather than session-only because these are properties of the rider,
// not of one search: the card in your wallet does not change between journeys.
// Deliberately not read during render — see readFareCriteria.

export interface FareCriteria {
  paymentMethod: PaymentMethod
  /**
   * When the rider is leaving. `'now'` follows the clock, which is what almost
   * everyone wants; anything else is an ISO instant they picked.
   *
   * This used to be a peak|offpeak bucket, for a cache reason that no longer
   * holds. The router has been schedule-aware since findRoutes took
   * `departureS` and `serviceHours`, so the engine could always honour a real
   * departure time — what blocked it was the KV key, which reduced `at` to the
   * same two buckets and served whichever body first warmed the window. That
   * key now carries a 20-minute slot (see the API's `departureSlot`), so a
   * picked time reaches the router and comes back as its own cached answer.
   *
   * Quantised to DEPARTURE_SLOT_MINUTES on the way out for exactly that reason:
   * an unrounded instant would key a fresh entry per minute and miss on nearly
   * every request. The picker only offers slot boundaries, so this is belt and
   * braces against a hand-edited URL.
   *
   * A stored instant goes stale — "08.40" means nothing tomorrow — so
   * parseFareCriteria resets a past one to `'now'` rather than pricing a
   * journey the rider cannot take.
   */
  fareTime: 'now' | string
  /**
   * Which networks the route may use.
   *
   * `'all'` is everything; `'rail'` drops TransJakarta. Unlike `operator` below
   * this genuinely changes the ROUTE rather than the picker, so it is sent to
   * the server and forms part of the cache key.
   *
   * An enum rather than a set of operators on purpose. TransJakarta is most of
   * the searchable network and the only way to reach LRT Jakarta, so rail-only
   * is one deliberate alternative product rather than one filter among many.
   * Only `/_internal/trips` honours it; `/fares` ignores it, because that
   * endpoint must keep answering the same thing for the embed and the OG card.
   */
  modes: 'all' | 'rail'
  /**
   * How much the rider minds walking.
   *
   * A preference, not a speed. The engine has no duration model at all, so this
   * cannot promise a journey takes longer at your pace — it only shifts which
   * tradeoffs win, so a 600m transfer stops beating an extra change. Copy must
   * say "I walk slowly", never a number of minutes.
   *
   * `AVOID` is steep rather than absolute: a short-walk option is still found
   * and offered, just ranked below the alternatives. Nothing here can make a
   * route disappear, which is why this is safe to default anyone into.
   */
  walking: WalkingPreference
  /** Restricts which stations the picker offers. `null` = every operator. */
  operator: OperatorCode | null
}

export const FARE_CRITERIA_KEY = 'fare-criteria'

/*
 * The four levels the engine ranks by. Re-declared rather than imported from
 * @commute/tsundere: the web app does not depend on the engine package, and the
 * set is a wire contract with the API either way.
 */
export type WalkingPreference = 'BRISK' | 'AVERAGE' | 'SLOW' | 'AVOID'
export const WALKING_PREFERENCES: WalkingPreference[] = ['BRISK', 'AVERAGE', 'SLOW', 'AVOID']

export const DEFAULT_FARE_CRITERIA: FareCriteria = {
  paymentMethod: 'STORED_VALUE',
  fareTime: 'now',
  modes: 'all',
  // AVERAGE is the engine's own default weighting, so the default rider sends
  // no param and gets exactly the ranking they got before this existed.
  walking: 'AVERAGE',
  operator: null
}

/**
 * Read a stored or URL-supplied departure back.
 *
 * Three ways to be unusable, all landing on `'now'`: not a string at all, not a
 * parseable instant, or an instant the clock has already passed. The last is
 * the one that matters in practice — criteria persist, so yesterday's 08.40
 * would otherwise come back tomorrow and price a train that has gone.
 */
function parseFareTime(raw: unknown): FareCriteria['fareTime'] {
  if (raw === 'now') return 'now'
  if (typeof raw !== 'string') return 'now'
  const at = new Date(raw)
  if (Number.isNaN(at.getTime())) return 'now'
  if (isStaleDeparture(raw)) return 'now'
  return quantiseToSlot(at).toISOString()
}

/**
 * Parse stored criteria, falling back per field rather than wholesale.
 *
 * Split from `readFareCriteria` so the parsing is testable without stubbing
 * globals. Per-field is deliberate and mirrors the server's `parseFareContext`:
 * one unrecognised value — a payment method removed from the constants, an
 * operator that no longer exists — should not silently reset the rider's other
 * choices.
 */
export function parseFareCriteria(raw: string | null): FareCriteria {
  if (!raw) return DEFAULT_FARE_CRITERIA

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_FARE_CRITERIA
  }
  // Covers null, arrays and primitives — JSON.parse succeeds on all of them.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return DEFAULT_FARE_CRITERIA
  }

  const record = parsed as Record<string, unknown>
  const paymentMethod = typeof record.paymentMethod === 'string' && record.paymentMethod in PAYMENT_METHODS
    ? record.paymentMethod as PaymentMethod
    : DEFAULT_FARE_CRITERIA.paymentMethod
  const fareTime = parseFareTime(record.fareTime)
  // Not validated against the operator list: operators are data, and a stored
  // code for one that is temporarily absent should come back when it returns.
  // A stale code only ever over-filters the picker, which is visible and
  // recoverable; the "Semua" option is always there.
  const modes = record.modes === 'rail' ? 'rail' : DEFAULT_FARE_CRITERIA.modes
  const walking = WALKING_PREFERENCES.includes(record.walking as WalkingPreference)
    ? record.walking as WalkingPreference
    : DEFAULT_FARE_CRITERIA.walking
  const operator = typeof record.operator === 'string'
    ? record.operator as OperatorCode
    : null

  return { paymentMethod, fareTime, modes, walking, operator }
}

/**
 * Read persisted criteria.
 *
 * Call this AFTER mount, never as a `useState` initializer — first paint must
 * not depend on storage. Same rule as readSearchMode.
 */
export function readFareCriteria(): FareCriteria {
  try {
    return parseFareCriteria(localStorage.getItem(FARE_CRITERIA_KEY))
  } catch {
    // Storage throws outright in a partitioned or locked-down context. Not a
    // reason to take the fare page down — price at the defaults.
    return DEFAULT_FARE_CRITERIA
  }
}

export function writeFareCriteria(criteria: FareCriteria) {
  try {
    localStorage.setItem(FARE_CRITERIA_KEY, JSON.stringify(criteria))
  } catch {
    // See readFareCriteria.
  }
}

/**
 * Strip the parts of `criteria` that came from the URL rather than from the
 * rider, ready to persist.
 *
 * A `?operator=` link scopes the picker for that visit only: FDTJ sends riders
 * to an operator-specific fare calculator, and arriving through it must not
 * silently rewrite the filter they set for themselves. Without this, any later
 * criteria change persists the whole object — so tweaking the payment method on
 * an FDTJ link would leave TJ scoping stuck on their own next visit to /fare.
 *
 * Only the *inherited* value is dropped. Overriding the URL's operator by hand,
 * or clearing it to "Semua", is the rider's own choice and persists like
 * anything else — hence the comparison against what the URL supplied rather
 * than a blanket refusal to store an operator.
 *
 * `paymentMethod` is deliberately not stripped: it is already never written
 * back to the URL, and a rider who changes it has expressed a real preference.
 */
export function criteriaToPersist(
  criteria: FareCriteria,
  fromUrl: Partial<FareCriteria> | undefined
): FareCriteria {
  const inherited = fromUrl?.operator
  if (inherited && criteria.operator === inherited) {
    return { ...criteria, operator: DEFAULT_FARE_CRITERIA.operator }
  }
  return criteria
}

/**
 * The query string for `GET /fares/:from/:to`.
 *
 * Defaults are omitted rather than spelled out, which is load-bearing twice
 * over: the SWR key for a default search stays byte-identical to the one this
 * app has always used, so nobody's warm cache misses on deploy; and share URLs
 * stay `?from=&to=` unless the sender actually changed something.
 *
 * `operator` is never included — it decides which stations the picker offers,
 * not how a chosen pair is priced, and sending it would imply the router filters
 * by operator, which it does not. `modes` IS included, and the two are not the
 * same thing: it excludes lines from the search rather than stations from the
 * picker, so the answer genuinely differs.
 */
export function fareQueryParams(criteria: FareCriteria): URLSearchParams {
  const params = new URLSearchParams()
  if (criteria.paymentMethod !== DEFAULT_FARE_CRITERIA.paymentMethod) {
    params.set('paymentMethod', criteria.paymentMethod)
  }
  /*
   * A picked departure goes out as the instant itself; `'now'` goes out as
   * silence. That silence is load-bearing — it is what keeps the default
   * rider's SWR key and share URL byte-identical to the one they have always
   * had, so nobody's warm cache misses because a picker was added.
   *
   * Already quantised by parseFareTime and by the picker, which only offers
   * slot boundaries. Sent unrounded it would still work, just key a colder
   * entry per minute: see the API's departureSlot.
   */
  if (criteria.fareTime !== 'now') params.set('at', criteria.fareTime)
  /*
   * Sent, unlike `operator`, because it changes the route rather than the
   * picker. Only `/_internal/trips` reads it — `/fares` ignores an unknown
   * param, so a standard-router request is unaffected either way.
   */
  if (criteria.modes !== DEFAULT_FARE_CRITERIA.modes) params.set('modes', criteria.modes)
  // Reorders the result; never removes one. Sent for the same reason as modes —
  // it changes the answer, so it has to reach the server and the cache key.
  if (criteria.walking !== DEFAULT_FARE_CRITERIA.walking) params.set('walking', criteria.walking)
  return params
}

/**
 * Criteria named by an incoming `/fare` URL, which beat stored preferences for
 * that visit only. `undefined` when the URL says nothing, so storage keeps its
 * say — an empty object would read as "the rider chose the defaults".
 *
 * Deliberately NOT the inverse of `fareQueryParams`, and the asymmetry is the
 * point:
 *
 * - `paymentMethod` round-trips. It changes the number, so a shared link must
 *   reproduce what the sender saw.
 * - `modes` round-trips too, and for the stronger version of that reason: it
 *   changes which lines the route may use at all, so a rail-only link that came
 *   back through a busway would show a different journey than the one sent.
 * - `operator` is read here but never written back. It scopes which stations
 *   the picker offers, which is a property of where you *entered* the app, not
 *   of the journey — FDTJ links riders straight to an operator-specific fare
 *   calculator via `/fare?operator=TJ`. Because `fareQueryParams` omits it, the
 *   param falls off the address bar as soon as the rider touches anything, and
 *   their own shares go out unscoped. That is correct: inheriting a stranger's
 *   filter would hide stations from them for no reason they could see.
 * - `at` is not read back into a bucket. The instants above are samples, not
 *   the rider's choice, so reversing them would invent a specificity the UI
 *   does not offer.
 *
 * Unknown values fall through per-field rather than wholesale, mirroring
 * `parseFareCriteria`. Unlike that function, a bogus operator is dropped rather
 * than trusted: stored codes are the rider's own and may be temporarily absent,
 * but a URL is typo- and stranger-facing, and scoping to a code no station
 * carries leaves the picker empty with nothing to click.
 */
export function readCriteriaFromUrl(params: URLSearchParams): Partial<FareCriteria> | undefined {
  const criteria: Partial<FareCriteria> = {}

  const paymentMethod = params.get('paymentMethod')
  if (paymentMethod && paymentMethod in PAYMENT_METHODS) {
    criteria.paymentMethod = paymentMethod as PaymentMethod
  }

  /*
   * `modes` round-trips, where `operator` below does not.
   *
   * The asymmetry follows what each one does. An inherited operator hides
   * stations from a recipient for a reason they cannot see, so it is read for
   * the visit and never persisted. `modes` changes the ROUTE, so a shared
   * rail-only link that quietly came back through a busway would show the
   * recipient a different journey than the one the sender meant to send.
   */
  if (params.get('modes') === 'rail') criteria.modes = 'rail'

  /*
   * `at` now round-trips, where the peak/off-peak buckets deliberately did not.
   *
   * The old reasoning was that the instants in the URL were representative
   * samples rather than anything the rider chose, so reading them back would
   * invent a specificity the UI did not offer. With a real picker that inverts:
   * the instant IS the rider's choice, and a shared "leaving 08.40 tomorrow"
   * link that came back as "now" would show the recipient a different journey
   * than the sender was looking at.
   *
   * Through parseFareTime like stored criteria, so a stale or malformed `at`
   * degrades to `'now'` rather than pricing a departure that has passed.
   */
  const at = params.get('at')
  if (at) {
    const fareTime = parseFareTime(at)
    if (fareTime !== 'now') criteria.fareTime = fareTime
  }

  // Round-trips for the same reason modes does: a shared link should reproduce
  // the ordering the sender was looking at.
  const walking = params.get('walking')
  if (walking && WALKING_PREFERENCES.includes(walking as WalkingPreference)) {
    criteria.walking = walking as WalkingPreference
  }

  // `NUL` is excluded for the same reason a typo is: it is an internal
  // placeholder that never labels a real station, so scoping to it would empty
  // the picker.
  const operator = params.get('operator')
  if (operator && operator !== 'NUL' && operator in OPERATORS) {
    criteria.operator = operator as OperatorCode
  }

  return Object.keys(criteria).length > 0 ? criteria : undefined
}
