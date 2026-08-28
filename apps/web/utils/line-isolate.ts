/*
 * Whether the rider has switched on line isolation: tapping a line to hold it
 * at full strength while the rest of the network fades.
 *
 * Experimental, and off by default. The feature is rail-only (BRT has no colour
 * discriminator yet, so its tracing cannot be trusted), which means a rider who
 * taps a busway and gets nothing has met a limit rather than a bug. Gating it
 * keeps that behind a deliberate opt-in until BRT lands.
 *
 * Shaped exactly like utils/fare-router.ts, including its conclusions.
 */

export type LineIsolate = 'off' | 'on'

export const LINE_ISOLATE_KEY = 'line-isolate'
export const DEFAULT_LINE_ISOLATE: LineIsolate = 'off'

/** `on` only; anything else is the default. */
export function parseLineIsolate(raw: string | null): LineIsolate {
  return raw === 'on' ? 'on' : DEFAULT_LINE_ISOLATE
}

export function readLineIsolate(): LineIsolate {
  try {
    return parseLineIsolate(localStorage.getItem(LINE_ISOLATE_KEY))
  } catch {
    // Storage throws in a partitioned or locked-down context, which is the
    // normal case inside the TransportForJakarta iframe. Off is the right answer
    // there: the embed keeps the map it has always had.
    return DEFAULT_LINE_ISOLATE
  }
}

export function writeLineIsolate(value: LineIsolate) {
  try {
    localStorage.setItem(LINE_ISOLATE_KEY, value)
  } catch {
    // See readLineIsolate.
  }
}

/*
 * Do not give this a URL representation, for the reason spelled out on
 * fare-router.ts: a `?` param makes a shared link a third opinion alongside
 * storage and the toggle, and the rules it then needs cost more than they buy.
 * That one was tried and removed. Storage is the only source.
 */
