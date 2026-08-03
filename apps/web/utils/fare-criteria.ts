import { PAYMENT_METHODS, type PaymentMethod } from '@commute/constants'
import type { OperatorCode } from '@commute/schemas'

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
   * Which fare period to price for. `'now'` follows the clock, which is what
   * almost everyone wants; the explicit buckets are for "what will this cost me
   * tomorrow morning".
   *
   * Deliberately a bucket and not a timestamp. The server only ever reduces
   * `at` to peak/off-peak (`fareTimeBucket`), and the *router* is time-blind —
   * `findRoute` takes no context and runs before fares are summed. A datetime
   * picker would imply schedule-aware routing the app cannot do: pick 03:00 and
   * it would still route you onto a corridor that stops running at 22:00.
   */
  fareTime: 'now' | 'peak' | 'offpeak'
  /** Restricts which stations the picker offers. `null` = every operator. */
  operator: OperatorCode | null
}

export const FARE_CRITERIA_KEY = 'fare-criteria'

export const DEFAULT_FARE_CRITERIA: FareCriteria = {
  paymentMethod: 'STORED_VALUE',
  fareTime: 'now',
  operator: null
}

const FARE_TIMES = new Set<FareCriteria['fareTime']>(['now', 'peak', 'offpeak'])

/*
 * Representative instants for the explicit buckets, as local WIB offsets.
 *
 * The server buckets `at` down to peak/off-peak and keys its KV cache on the
 * bucket rather than the instant, so any time inside the window is equivalent.
 * A Monday is used because `fareTimeBucket` treats every weekend as off-peak —
 * a "peak" pick landing on a Saturday would silently price as off-peak.
 */
const PEAK_SAMPLE = '2026-08-03T08:00:00+07:00'
const OFFPEAK_SAMPLE = '2026-08-03T12:00:00+07:00'

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
  const fareTime = FARE_TIMES.has(record.fareTime as FareCriteria['fareTime'])
    ? record.fareTime as FareCriteria['fareTime']
    : DEFAULT_FARE_CRITERIA.fareTime
  // Not validated against the operator list: operators are data, and a stored
  // code for one that is temporarily absent should come back when it returns.
  // A stale code only ever over-filters the picker, which is visible and
  // recoverable; the "Semua" option is always there.
  const operator = typeof record.operator === 'string'
    ? record.operator as OperatorCode
    : null

  return { paymentMethod, fareTime, operator }
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
 * The query string for `GET /fares/:from/:to`.
 *
 * Defaults are omitted rather than spelled out, which is load-bearing twice
 * over: the SWR key for a default search stays byte-identical to the one this
 * app has always used, so nobody's warm cache misses on deploy; and share URLs
 * stay `?from=&to=` unless the sender actually changed something.
 *
 * `operator` is never included — it decides which stations the picker offers,
 * not how a chosen pair is priced, and sending it would imply the router filters
 * by operator, which it does not.
 */
export function fareQueryParams(criteria: FareCriteria): URLSearchParams {
  const params = new URLSearchParams()
  if (criteria.paymentMethod !== DEFAULT_FARE_CRITERIA.paymentMethod) {
    params.set('paymentMethod', criteria.paymentMethod)
  }
  if (criteria.fareTime === 'peak') params.set('at', PEAK_SAMPLE)
  if (criteria.fareTime === 'offpeak') params.set('at', OFFPEAK_SAMPLE)
  return params
}
