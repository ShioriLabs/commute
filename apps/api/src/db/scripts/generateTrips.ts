import { execFileSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'
import { DAY_S } from '@commute/tsundere'
import { TOPOLOGY } from '../data/topology'

/*
 * Trip generator: WHEN each vehicle runs, as opposed to how often one comes.
 *
 * The third sibling of generateHeadways.ts and generateServiceHours.ts, and the
 * groundwork for timetable-driven routing. Those two answer "you wait ~8 minutes
 * for a 9C" and "there is no point waiting at all at 03:00"; this one is meant to
 * answer "the next one leaves at 07:14", which neither can.
 *
 * Nothing reads its output yet. That is deliberate — see docs/go-mode.md. The
 * search in @commute/tsundere stays headway-based until this layer is proven, so
 * this script's real job is VALIDATION, not extraction.
 *
 * Re-run: pnpm --filter api generate:trips
 *
 * ── Why this is not just "SELECT * FROM schedules ORDER BY estimatedDeparture"
 *
 * `schedules` is a GTFS stop_times table in disguise, but it was populated by
 * five different syncers and its columns do not mean the same thing in each.
 * Four traps, all measured on the 2026-09-06 local snapshot:
 *
 *   1. `estimatedArrival` means two different things. For all 1370 multi-stop
 *      KCI trips it is CONSTANT across every row — it is the arrival at the
 *      terminus, not at this stop. For MRTJ/LRTJBDB/APCGK it varies per stop and
 *      is a real arrival, with arrival <= departure on 100% of rows. Reading the
 *      column uniformly gives wrong in-vehicle times for KCI and only KCI.
 *
 *   2. There is no stopSequence column, so order has to come from the clock —
 *      and that is wrong for the 21 KCI trips that cross midnight, where a
 *      22:48 -> 00:05 trip sorts its 00:05 row first and reverses the journey.
 *      The column is TIME, so GTFS's >24:00:00 convention cannot be stored.
 *
 *   3. 22% of KCI trips have gaps — a hop between two consecutive rows that no
 *      edge serves, because intermediate stop rows are missing from the feed.
 *      Non-KCI has none: every hop matches an edge with the same lineCode.
 *
 *   4. LRTJ cannot chain at all. Its tripNumber is a per-station synthetic key
 *      (`${stationId}-${time}-PGD-BOUND`), so a "trip" there is one row — a
 *      departure board, not a trip.
 *
 * A generator that silently swallowed those would emit a plausible-looking
 * timetable that is wrong in ways nobody would notice until a rider missed a
 * train. So every trip is validated against the routing graph and REJECTED with
 * a reason rather than repaired by guesswork, and the run prints the full
 * accounting.
 */

const OUT_PATH = `${__dirname}/../data/trips.ts`

/*
 * Trips are ordered by a repaired sequence, and a stop past midnight carries
 * `+DAY_S`. Wrapping is detected as a large backwards jump between consecutive
 * departures rather than any jump: real dwell and clock granularity produce
 * small negatives on their own, and a trip is only ever allowed to wrap once.
 *
 * Six hours is comfortably wider than any legitimate backwards step and far
 * narrower than the ~22h gap a genuine wrap produces.
 */
const WRAP_THRESHOLD_S = 6 * 3600

/*
 * The lineCodes the router may traverse. Mirrors ROUTABLE_LINE_CODES in
 * db/repositories/edges.ts, including the 'A' exclusion — a line scoped into one
 * generator and out of the other carries a timetable the router can never read,
 * which is the drift generateServiceHours.ts already warns about.
 */
const ROUTABLE_LINE_CODES = new Set([...new Set(TOPOLOGY.map(t => t.lineCode))].filter(code => code !== 'A'))

/*
 * Operators whose `estimatedArrival` is a real per-stop arrival.
 *
 * Everything else gets departure-only timing. This is a whitelist rather than a
 * "KCI is special" exclusion on purpose: a new operator whose semantics nobody
 * has checked should default to the conservative reading, not inherit a
 * per-stop arrival it may not have.
 */
const PER_STOP_ARRIVAL_OPERATORS = new Set(['MRTJ', 'LRTJBDB', 'APCGK'])

/*
 * Stations that still carry schedule rows but are gone from the routing graph.
 *
 * KCI-KAT (Karet) is retired from `edges` while its rows remain; see the Karet
 * retirement work. These are TRIMMED from a trip rather than rejecting it: a
 * train that no longer calls at Karet still serves every other stop on its run,
 * and measured on the 2026-09-06 snapshot 260 of the 264 affected trips have a
 * direct edge between the stops either side, so trimming reconnects them
 * cleanly. The four that do not fall through to the ordinary chain-gap check.
 *
 * Named explicitly rather than dropping any station missing from `edges`,
 * because those two cases want opposite treatment — a knowingly retired stop is
 * stale data to skip past, an unknown one is a gap we must not paper over.
 */
const RETIRED_STATIONS = new Set(['KCI-KAT'])

/** Placeholder written by the KCI syncer when it cannot resolve a line. */
const UNRESOLVED_LINE = 'NUL'

// ── local D1 access ──────────────────────────────────────────────────────────

/*
 * Read the local D1 file directly rather than through `wrangler d1 execute`,
 * which hangs on tables this size. Same approach, and the same reasoning, as
 * db/scripts/benchShared.ts.
 */
function localD1Path(): string {
  const dir = `${__dirname}/../../../.wrangler/state/v3/d1/miniflare-D1DatabaseObject`
  const files = readdirSync(dir).filter(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite')
  if (files.length !== 1) throw new Error(`expected exactly one .sqlite in ${dir}, found ${files.length}`)
  return `${dir}/${files[0]}`
}

function query<T>(sql: string): T[] {
  let raw: string
  try {
    raw = execFileSync('sqlite3', ['-readonly', '-json', localD1Path(), sql], { encoding: 'utf-8', maxBuffer: 1 << 28 })
  } catch (error) {
    throw new Error(`sqlite3 failed (is it installed?): ${(error as Error).message}`)
  }
  return raw.trim() ? JSON.parse(raw) as T[] : []
}

// ── inputs ───────────────────────────────────────────────────────────────────

interface ScheduleRow {
  stationId: string
  tripNumber: string
  estimatedDeparture: string
  estimatedArrival: string
  lineCode: string
  boundFor: string
  dayMask: number
}

interface EdgeRow { lineCode: string, fromStationId: string, toStationId: string }

/** `HH:MM:SS` to seconds since local midnight. */
function toSeconds(time: string): number {
  const [h, m, s] = time.split(':').map(Number)
  return (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0)
}

const operatorOf = (stationId: string) => stationId.slice(0, stationId.indexOf('-'))

// ── the trip shape this emits ────────────────────────────────────────────────

/*
 * One stop on one trip. `arrivalS` is null where the feed does not record a real
 * per-stop arrival (see PER_STOP_ARRIVAL_OPERATORS) — null means "unknown",
 * never "same as departure", so a consumer cannot silently read a dwell of zero
 * as measured.
 *
 * Both times are seconds since local midnight and may exceed DAY_S on a trip
 * that crosses it.
 */
interface TripStop {
  stationId: string
  departureS: number
  arrivalS: number | null
}

interface Trip {
  tripNumber: string
  lineCode: string
  /** Days this trip runs, as the 3-bit WD|SAT|SUN mask from schemas/schedules. */
  dayMask: number
  stops: TripStop[]
}

type RejectReason
  = 'single-stop'
    | 'unresolved-line'
    | 'not-routable'
    | 'chain-gap'
    | 'multiple-wraps'
    | 'non-monotonic'

interface Reject {
  tripNumber: string
  lineCode: string
  operator: string
  reason: RejectReason
  detail?: string
}

// ── build ────────────────────────────────────────────────────────────────────

const rows = query<ScheduleRow>(
  `SELECT stationId, tripNumber, estimatedDeparture, estimatedArrival, lineCode, boundFor, dayMask
   FROM schedules ORDER BY tripNumber, dayMask, estimatedDeparture`
)

const edges = query<EdgeRow>('SELECT lineCode, fromStationId, toStationId FROM edges')
const edgeKeys = new Set(edges.map(e => `${e.lineCode}|${e.fromStationId}|${e.toStationId}`))
const hasEdge = (lineCode: string, from: string, to: string) => edgeKeys.has(`${lineCode}|${from}|${to}`)

/*
 * Group by (tripNumber, dayMask), not tripNumber alone.
 *
 * MRTJ and LRTJBDB emit the SAME trip number under both a weekday and a weekend
 * mask, so grouping by trip number alone interleaves two boards into one
 * impossible journey that visits every station twice.
 */
const grouped = new Map<string, ScheduleRow[]>()
for (const row of rows) {
  const key = `${row.tripNumber}|${row.dayMask}`
  const bucket = grouped.get(key)
  if (bucket) bucket.push(row)
  else grouped.set(key, [row])
}

const trips: Trip[] = []
const rejects: Reject[] = []
let wrapsRepaired = 0
let trimmedStops = 0

for (const group of grouped.values()) {
  const first = group[0]!
  const { tripNumber, lineCode, dayMask } = first
  const operator = operatorOf(first.stationId)
  const reject = (reason: RejectReason, detail?: string) =>
    rejects.push({ tripNumber, lineCode, operator, reason, detail })

  if (lineCode === UNRESOLVED_LINE) {
    reject('unresolved-line')
    continue
  }
  if (!ROUTABLE_LINE_CODES.has(lineCode)) {
    reject('not-routable')
    continue
  }
  /*
   * Trim retired stops before anything else measures the trip: its length, its
   * hops and its pattern must all describe the run the graph can actually
   * serve, not the one the stale rows describe.
   */
  const trimmed = group.filter(r => !RETIRED_STATIONS.has(r.stationId))
  if (trimmed.length < group.length) trimmedStops += group.length - trimmed.length
  /*
   * A one-row "trip" is a departure board entry, not a trip. This is every LRTJ
   * row by construction, plus KCI trains that touch a single station in our
   * data. Neither can be ridden from anywhere to anywhere, so neither is useful
   * to a router that needs to know where a vehicle goes next.
   */
  if (trimmed.length < 2) {
    reject('single-stop')
    continue
  }

  /*
   * Repair a midnight crossing.
   *
   * The rows arrive sorted by clock time, which puts a post-midnight tail at the
   * FRONT. Find the single large backwards jump and rotate there, adding DAY_S
   * to everything that follows so the sequence is monotonic in absolute time.
   */
  const sorted = [...trimmed].sort((a, b) => toSeconds(a.estimatedDeparture) - toSeconds(b.estimatedDeparture))
  const jumps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const gap = toSeconds(sorted[i]!.estimatedDeparture) - toSeconds(sorted[i - 1]!.estimatedDeparture)
    if (gap > WRAP_THRESHOLD_S) jumps.push(i)
  }
  if (jumps.length > 1) {
    reject('multiple-wraps', `${jumps.length} candidate wrap points`)
    continue
  }

  const rotation = jumps[0] ?? 0
  const ordered = rotation === 0 ? sorted : [...sorted.slice(rotation), ...sorted.slice(0, rotation)]
  if (rotation !== 0) wrapsRepaired++

  const perStopArrival = PER_STOP_ARRIVAL_OPERATORS.has(operator)
  const stops: TripStop[] = ordered.map((row, index) => {
    // Everything after the rotation point is on the following day.
    const offset = rotation !== 0 && index >= ordered.length - rotation ? DAY_S : 0
    return {
      stationId: row.stationId,
      departureS: toSeconds(row.estimatedDeparture) + offset,
      /*
       * KCI's arrival column is the terminus arrival repeated on every row, so
       * it says nothing about THIS stop and is dropped. See trap 1 above.
       */
      arrivalS: perStopArrival ? toSeconds(row.estimatedArrival) + offset : null
    }
  })

  /*
   * Time must not run backwards once the wrap is repaired. A trip that still
   * does is not a trip we understand, and guessing which row is wrong would be
   * inventing a timetable.
   */
  const monotonic = stops.every((stop, i) => i === 0 || stop.departureS >= stops[i - 1]!.departureS)
  if (!monotonic) {
    reject('non-monotonic')
    continue
  }

  /*
   * Every hop must be an edge the router can actually traverse. A trip with a
   * gap is dropped whole rather than split: the gap means intermediate stop rows
   * are missing, so the two halves are real but the through-journey the trip
   * describes is not one the graph can express.
   */
  const gap = stops.findIndex((stop, i) => i > 0 && !hasEdge(lineCode, stops[i - 1]!.stationId, stop.stationId))
  if (gap > 0) {
    reject('chain-gap', `${stops[gap - 1]!.stationId} -> ${stops[gap]!.stationId}`)
    continue
  }

  trips.push({ tripNumber, lineCode, dayMask, stops })
}

// ── patterns ─────────────────────────────────────────────────────────────────

/*
 * A pattern is the ordered stop list shared by many trips — RAPTOR's "route",
 * which is not the same thing as a line: line M runs six of them once
 * short-turns are counted. Trips are grouped under one so the eventual search
 * scans a handful of patterns rather than every trip.
 */
const patternKey = (trip: Trip) => `${trip.lineCode}|${trip.stops.map(s => s.stationId).join('>')}`
const patterns = new Map<string, { lineCode: string, stationIds: string[], trips: Trip[] }>()
for (const trip of trips) {
  const key = patternKey(trip)
  const existing = patterns.get(key)
  if (existing) existing.trips.push(trip)
  else patterns.set(key, { lineCode: trip.lineCode, stationIds: trip.stops.map(s => s.stationId), trips: [trip] })
}

// ── report ───────────────────────────────────────────────────────────────────

const operators = [...new Set(rows.map(r => operatorOf(r.stationId)))].sort()
const countBy = <T>(items: T[], key: (item: T) => string) => {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return counts
}

const tripsByOperator = countBy(trips, t => operatorOf(t.stops[0]!.stationId))
const rejectsByOperator = countBy(rejects, r => r.operator)
const patternsByOperator = countBy([...patterns.values()], p => operatorOf(p.stationIds[0]!))

console.log(`Read ${rows.length} schedule rows in ${grouped.size} (trip, dayMask) groups\n`)
console.log('  operator      kept   rejected   patterns   avg stops')
for (const operator of operators) {
  const kept = tripsByOperator.get(operator) ?? 0
  const keptTrips = trips.filter(t => operatorOf(t.stops[0]!.stationId) === operator)
  const avg = kept > 0 ? (keptTrips.reduce((sum, t) => sum + t.stops.length, 0) / kept).toFixed(1) : '—'
  console.log(
    `  ${operator.padEnd(10)}${String(kept).padStart(7)}`
    + `${String(rejectsByOperator.get(operator) ?? 0).padStart(11)}`
    + `${String(patternsByOperator.get(operator) ?? 0).padStart(11)}`
    + `${avg.padStart(12)}`
  )
}

console.log(`\n  total kept ${trips.length}, rejected ${rejects.length}, patterns ${patterns.size}`)
console.log(`  midnight wraps repaired: ${wrapsRepaired}`)
console.log(`  retired stops trimmed:   ${trimmedStops}`)

console.log('\nrejections by reason:')
for (const [reason, count] of [...countBy(rejects, r => r.reason)].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${reason.padEnd(18)}${String(count).padStart(6)}`)
}

/*
 * Chain gaps are the one rejection worth naming individually: they are a data
 * problem in the feed rather than a rule this script applies, so the hops are
 * the actionable output. Deduplicated because 61 trips share one missing hop.
 */
const gapHops = countBy(rejects.filter(r => r.reason === 'chain-gap'), r => `${r.lineCode} ${r.detail}`)
if (gapHops.size > 0) {
  console.log(`\nmissing hops behind chain-gap rejections (${gapHops.size} distinct):`)
  for (const [hop, count] of [...gapHops].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(count).padStart(4)}x  ${hop}`)
  }
  if (gapHops.size > 12) console.log(`  … and ${gapHops.size - 12} more`)
}

// ── emit ─────────────────────────────────────────────────────────────────────

/*
 * Emitted as patterns plus per-trip times rather than as flat stop-times: the
 * stop list is what repeats, and writing it once per trip instead of once per
 * pattern would multiply the file by the trips-per-pattern factor for nothing.
 */
const patternEntries = [...patterns.values()]
  .sort((a, b) => a.lineCode.localeCompare(b.lineCode) || a.stationIds.length - b.stationIds.length)
  .map((pattern) => {
    const trips = pattern.trips
      .sort((a, b) => a.stops[0]!.departureS - b.stops[0]!.departureS)
      .map(trip => `      { t: '${trip.tripNumber}', d: ${trip.dayMask}, s: [${trip.stops.map(s => s.departureS).join(', ')}]`
        + `${trip.stops[0]!.arrivalS === null ? '' : `, a: [${trip.stops.map(s => s.arrivalS).join(', ')}]`} }`)
    return `  {\n    line: '${pattern.lineCode}',\n`
      + `    stations: [${pattern.stationIds.map(id => `'${id}'`).join(', ')}],\n`
      + `    trips: [\n${trips.join(',\n')}\n    ]\n  }`
  })

const fileTS = '/*\n'
  + ' * Trips: when each vehicle runs, grouped by the stop pattern it serves.\n'
  + ' *\n'
  + ' * GENERATED — do not edit by hand; re-run `pnpm --filter api generate:trips`.\n'
  + ' *\n'
  + ' * A pattern is the ordered stop list several trips share — RAPTOR\'s "route",\n'
  + ' * which is not a line: line M runs six patterns once short-turns are counted.\n'
  + ' *\n'
  + ' * Times are seconds since local midnight and MAY EXCEED 86400 on a trip that\n'
  + ' * crosses it, so that a sequence stays monotonic. Compare against a departure\n'
  + ' * time in the same units rather than taking a modulus, or a 00:05 arrival\n'
  + ' * sorts before the 22:48 departure it follows.\n'
  + ' *\n'
  + ' * `s` is departure per stop, `d` the 3-bit WD|SAT|SUN day mask. `a` is\n'
  + ' * arrival per stop and is ABSENT where the feed does not record a real one —\n'
  + ' * KCI stores the terminus arrival on every row, so it is dropped rather than\n'
  + ' * misread as a per-stop time. Absent means unknown, never "same as departure".\n'
  + ' *\n'
  + ' * Only trips whose every hop matches a routable edge are here. Trips with\n'
  + ' * gaps in the feed are dropped rather than stitched — see generateTrips.ts.\n'
  + ' *\n'
  + ' * Measured 2026-09-06: importing this took the worker bundle from 875 KB /\n'
  + ' * 167 KB gz to 1287 KB / 244 KB gz. Comfortable against the 3 MB compressed\n'
  + ' * limit, but it is ~7x the largest hand-written data module here and it buys\n'
  + ' * nothing until the search reads it. If a fuller timetable lands (all-day\n'
  + ' * boards, holiday variants) this should move to a D1 read at graph load —\n'
  + ' * the graph is already memoised per isolate, so it would amortise exactly\n'
  + ' * the way getGraphInputs does.\n'
  + ' */\n\n'
  + '/** One trip: departures per stop, optional arrivals, and the days it runs. */\n'
  + 'export interface TripTimes {\n'
  + '  t: string\n'
  + '  d: number\n'
  + '  s: number[]\n'
  + '  a?: number[]\n'
  + '}\n\n'
  + '/** One stop pattern and every trip that serves it. */\n'
  + 'export interface TripPattern {\n'
  + '  line: string\n'
  + '  stations: string[]\n'
  + '  trips: TripTimes[]\n'
  + '}\n\n'
  + 'export const TRIP_PATTERNS: TripPattern[] = [\n'
  + patternEntries.join(',\n')
  + '\n]\n'

writeFileSync(OUT_PATH, fileTS)
const sizeKB = (Buffer.byteLength(fileTS) / 1024).toFixed(0)
console.log(`\nWrote ${patterns.size} patterns / ${trips.length} trips to ${OUT_PATH} (${sizeKB} KB)`)
