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
