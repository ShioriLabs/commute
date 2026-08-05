import type { Line } from '@commute/schemas'

// Parse a TJ corridor code into sortable parts. Codes look like `6`, `6A`,
// `13E`, `L13E` (an express variant of 13 — the `L` is ignored for ordering, so
// it sorts within the 13-group), or non-numeric oddballs like `PRJ2`.
function parseTJCode(code: string): { num: number, suffix: string } {
  const m = code.match(/^L?(\d+)([A-Z]*)$/)
  if (!m) return { num: Number.POSITIVE_INFINITY, suffix: code } // PRJ2 etc. sort last
  return { num: Number(m[1]), suffix: m[2] ?? '' }
}

// Order TJ corridors by number (6 before 13), then by letter suffix (6, 6A, 6B).
// `L13E` sorts inside the 13-group; non-numeric codes go last.
export function compareTJLineCode(a: string, b: string): number {
  const pa = parseTJCode(a)
  const pb = parseTJCode(b)
  if (pa.num !== pb.num) return pa.num - pb.num
  if (pa.suffix !== pb.suffix) return pa.suffix.localeCompare(pb.suffix)
  return a.localeCompare(b) // stable tiebreak (e.g. `13E` vs `L13E`)
}

// Seasonal Pekan Raya Jakarta (PRJ) shuttles — only run during the fair, so we
// hide them from the corridor lists (data stays; this is display-only).
const HIDDEN_TJ_CODES = new Set(['PRJ2', 'PRJ3'])

// Return a new array of lines sorted for display. TJ uses corridor-number order
// and drops seasonal PRJ shuttles; other operators keep their given order.
export function sortLinesForDisplay(lines: readonly Line[], operator?: string): Line[] {
  if (operator !== 'TJ') return [...lines]
  return lines
    .filter(line => !HIDDEN_TJ_CODES.has(line.lineCode))
    .sort((a, b) => compareTJLineCode(a.lineCode, b.lineCode))
}

/*
 * Same ordering, for the operator-qualified line keys (`TJ:6A`) that responses
 * now carry. Sorting before resolution means a list still orders correctly while
 * the line dictionary is in flight.
 */
export function sortLineKeysForDisplay(keys: readonly string[], operator?: string): string[] {
  const normalized = normalizeLineKeys(keys, operator)
  if (operator !== 'TJ') return normalized
  return normalized
    .filter(key => !HIDDEN_TJ_CODES.has(codeOfKey(key)))
    .sort((a, b) => compareTJLineCode(codeOfKey(a), codeOfKey(b)))
}

/*
 * `/stations` used to carry whole Line objects and now carries bare keys
 * (`TJ:6A`), so a stale service-worker cache can hand this list either shape —
 * or, mid-deploy, an entry with no key at all. It is typed `string` per the
 * current schema, so nothing warns at compile time and `.split` threw on both
 * legacy shapes ("is not a function" on the object, "of undefined" on the gap).
 *
 * Re-key rather than merely tolerate: callers feed the result to the line
 * dictionary, which is keyed by `OP:CODE`, so a passed-through Line object
 * would sort safely and then silently resolve to nothing, blanking the
 * roundels. Entries too broken to re-key are dropped.
 */
function normalizeLineKeys(keys: readonly string[], operator?: string): string[] {
  return keys.flatMap((key) => {
    const raw: unknown = key
    if (typeof raw === 'string') return raw ? [raw] : []
    if (!raw || typeof raw !== 'object' || !('lineCode' in raw)) return []
    const code = String((raw as { lineCode: unknown }).lineCode)
    if (!code) return []
    // A legacy object may not name its operator; fall back to the list's.
    const owner = 'operator' in raw ? String((raw as { operator: unknown }).operator) : operator
    return [code.includes(':') || !owner ? code : `${owner}:${code}`]
  })
}

/** `TJ:6A` -> `6A`. Assumes an already-normalized key. */
function codeOfKey(key: string): string {
  return key.split(':')[1] ?? key
}
