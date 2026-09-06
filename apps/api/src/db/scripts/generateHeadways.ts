import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import { TOPOLOGY } from '../data/topology'

/*
 * Headway generator: how often a vehicle comes, per line AND per stop.
 *
 * Feeds the expected-wait model in @commute/tsundere's multi-criteria planner,
 * which charges half a headway per boarding, and the `/stations/:op/:code/headway`
 * endpoint behind the halte page. That is the whole "time" dimension the network
 * can support — it is NOT a timetable. KCI has real trip chains, MRTJ/LRTJ only
 * station-scoped departure boards, and TransJakarta has no timetable at all, so
 * "when is the next bus" is unanswerable while "how long do you usually wait" is
 * not.
 *
 * Two sources, because the two halves of the network record service differently:
 *
 *   TJ   — GTFS `frequencies.txt`, the feed's native shape (one trip per route
 *          variant, carrying a service span and a headway rather than stop times).
 *   Rail — the median gap between consecutive departures in the `schedules`
 *          table. Median rather than mean because the overnight gap between the
 *          last train and the first is not a wait anyone experiences, and it
 *          would drag a mean to nonsense.
 *
 * Both emit per-(line, stop) values with a per-line fallback. That split is the
 * point: on Koridor 1, Blok M is served by 11 route variants and Petamburan by
 * one, and on MRT line M a rider waits ~170s at Stasiun ASEAN against ~480s at
 * Lebak Bulus. A single number per line is wrong at both ends of both.
 *
 * Re-run: pnpm --filter api generate:headways
 */

const FEED_DIR = `${__dirname}/file_gtfs`
const OUT_PATH = `${__dirname}/../data/headways.ts`

/*
 * Bounds applied to every derived value.
 *
 * The cap exists for rows like `BW*` (Wisata tourist buses, 52700s) and `ASG*`
 * (school shuttles, up to 86400s — a once-daily service). None are routable
 * today, so nothing is currently clamped; it is here so a future GTFS refresh
 * that pulls a school route into the topology fails safe instead of pricing a
 * boarding at twelve hours of waiting.
 *
 * The floor exists because a sub-two-minute nominal headway is not a difference
 * a rider can act on, and letting it approach zero just adds noise to the
 * dominance test. It binds on ~37% of TJ pairs once variants are combined, which
 * is why the UI renders the floor as "~2 menit" rather than a precise figure.
 */
const HEADWAY_CAP_S = 3600
const HEADWAY_FLOOR_S = 120

/*
 * TJ route scope, matching generateTJSQL.ts's SCOPE_DESC.
 *
 * Without it the generator emits every route in the feed — Mikrotrans, Bus
 * Wisata, Royaltrans, school shuttles — roughly 150 entries for lines that have
 * no topology and are not routable.
 */
const SCOPE_DESC = new Set(['BRT', 'Angkutan Umum Integrasi'])

/*
 * Calendar services to ignore outright: both are stale in the published feed.
 * `HJ` ended 2025-12-31 and `X` covered two days in 2005.
 */
const STALE_SERVICES = new Set(['HJ', 'X'])

/*
 * Hand corrections, applied last and winning over anything derived.
 *
 * Empty on purpose. It exists so a line whose derived value is visibly wrong
 * can be fixed without abandoning derivation for everything else — but if this
 * map starts filling up, derivation is the wrong approach and the source data
 * should be fixed instead.
 */
const OVERRIDES: Record<string, number> = {}

// ── minimal CSV parser (matches generateTJTopology.ts) ───────────────────────
function parseCSV(text: string): Record<string, string>[] {
  const rows: Record<string, string>[] = []
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n')
  const header = lines[0]!.split(',')
  for (const line of lines.slice(1)) {
    const cells = line.split(',')
    const row: Record<string, string> = {}
    header.forEach((key, i) => {
      row[key] = cells[i] ?? ''
    })
    rows.push(row)
  }
  return rows
}

const load = (file: string) => parseCSV(fs.readFileSync(`${FEED_DIR}/${file}`, 'utf-8'))

const toSeconds = (hhmmss: string): number => {
  const [h, m, s] = hhmmss.split(':').map(Number)
  return (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0)
}

const clamp = (seconds: number) => Math.max(HEADWAY_FLOOR_S, Math.min(HEADWAY_CAP_S, Math.round(seconds)))

/*
 * Combined frequency of several services sharing a stop.
 *
 * Variants of a corridor all pass the same halte, so a rider waits for whichever
 * comes first and their frequencies ADD: 1 / Σ(1/hᵢ). Averaging them instead —
 * which this generator used to do — inflated the wait enormously wherever a
 * corridor runs short-turns: Koridor 1 came out at 1222s against a true ~58s,
 * and 68 of 100 in-scope lines were more than 2x too high.
 */
const combine = (headways: number[]): number => 1 / headways.reduce((sum, h) => sum + 1 / h, 0)

/** Key for the per-stop map. Station ids carry their operator prefix. */
const stopKey = (lineCode: string, stationId: string) => `${lineCode}@${stationId}`

/** Direction of travel along a corridor. `F` follows TOPOLOGY `path`, `R` `pathReverse`. */
type Direction = 'F' | 'R'

/** Key for the per-direction map. */
const dirKey = (lineCode: string, stationId: string, dir: Direction) =>
  `${stopKey(lineCode, stationId)}@${dir}`

/*
 * Stop order along each direction of a TJ corridor, for classifying trips.
 *
 * `pathReverse` is NOT the mirror of `path` on TJ — a corridor's two directions
 * genuinely serve different stops (verified on 10H). Scoring a trip against the
 * forward index alone therefore misclassifies most of them, because reverse-only
 * stops are invisible to it. Both indices are needed.
 */
function directionIndices(): Map<string, { F: Map<string, number>, R: Map<string, number> }> {
  const out = new Map<string, { F: Map<string, number>, R: Map<string, number> }>()
  for (const line of TOPOLOGY) {
    if (line.operator !== 'TJ') continue
    const reverse = line.pathReverse ?? line.path
    out.set(line.lineCode, {
      F: new Map(line.path.map((s, i) => [s.station, i])),
      R: new Map(reverse.map((s, i) => [s.station, i]))
    })
  }
  return out
}

/*
 * How well an ordered stop sequence fits one direction's stop order.
 *
 * Two factors, multiplied: how monotonically increasing the matched indices are
 * (a trip running this direction visits stops in path order), and how much of the
 * trip the path explains at all (a short-turn that only touches a few stops of the
 * reverse path should not outscore the direction it actually runs).
 */
function fitScore(sequence: string[], order: Map<string, number>): number {
  const indices = sequence.map(s => order.get(s)).filter((v): v is number => v !== undefined)
  if (indices.length < 2) return -1
  let ascending = 0
  for (let i = 1; i < indices.length; i++) if (indices[i]! > indices[i - 1]!) ascending++
  return (ascending / (indices.length - 1)) * Math.min(1, indices.length / sequence.length)
}

/*
 * Which direction(s) a trip serves.
 *
 * Returns BOTH when the trip cannot be pinned to one — a loop run genuinely covers
 * both directions in a single circuit (66 of them, each covering the two paths at
 * near-equal rates), and an unclassifiable trip degrades to the combined figure
 * rather than being guessed into one direction.
 *
 * GTFS `direction_id` is deliberately unused: it is broken in this feed. Koridor 5's
 * `5-R01` (Kampung Melayu->Ancol) and `5-R02` (Ancol->Kampung Melayu) are opposite
 * directions BOTH labelled `direction_id=0`, and 29 of 94 in-scope lines carry only
 * one value at all.
 */
function tripDirections(
  sequence: string[],
  order: { F: Map<string, number>, R: Map<string, number> } | undefined
): Direction[] {
  const BOTH: Direction[] = ['F', 'R']
  if (!order || sequence.length < 2) return BOTH
  // A circuit returning to where it started serves both directions in one run.
  if (sequence[0] === sequence[sequence.length - 1]) return BOTH

  const forward = fitScore(sequence, order.F)
  const reverse = fitScore(sequence, order.R)
  const CONFIDENT = 0.6
  if (forward >= reverse && forward > CONFIDENT) return ['F']
  if (reverse > forward && reverse > CONFIDENT) return ['R']
  return BOTH
}

/*
 * (line, station) pairs the curated topology actually serves.
 *
 * This gate is load-bearing. The GTFS feed keeps stale route variants long after
 * TJ reroutes a corridor — 40 (line, stop) pairs in the current feed are not in
 * TOPOLOGY, including Koridor 1 at Petamburan, Pasar Santa, Rawa Barat and
 * Tarakan. Deriving straight off the feed would advertise "Koridor 1, setiap 20
 * menit" at haltes Koridor 1 no longer serves. TOPOLOGY is GTFS plus the poster
 * overrides, and it is the truth the rest of the app already routes on.
 */
function topologyPairs(): Set<string> {
  const pairs = new Set<string>()
  for (const line of TOPOLOGY) {
    for (const segment of [line.path, line.pathReverse, ...(line.branches ?? []).map(b => b.path)]) {
      for (const stop of segment ?? []) pairs.add(stopKey(line.lineCode, `${line.operator}-${stop.station}`))
    }
  }
  return pairs
}

/*
 * The same gate, per direction: which (line, stop, direction) triples the topology
 * actually serves.
 *
 * Needed because a loop trip touches a stop in both directions of its circuit while
 * the corridor may only SERVE it one way — 28% of pairs are single-direction. Without
 * this, such a stop would advertise a frequency for a direction no service calls in,
 * which is the same failure the combined gate above exists to prevent.
 */
/*
 * Terminus station id per line and direction, for the "arah ..." labels a halte
 * page shows and for suppressing the split at a terminus itself.
 */
function lineTerminiMap(): Map<string, { F: string, R: string }> {
  const out = new Map<string, { F: string, R: string }>()
  for (const line of TOPOLOGY) {
    if (line.operator !== 'TJ') continue
    const reverse = line.pathReverse ?? [...line.path].reverse()
    out.set(line.lineCode, {
      F: `${line.operator}-${line.path[line.path.length - 1]!.station}`,
      R: `${line.operator}-${reverse[reverse.length - 1]!.station}`
    })
  }
  return out
}

function topologyDirectionPairs(): Set<string> {
  const pairs = new Set<string>()
  for (const line of TOPOLOGY) {
    if (line.operator !== 'TJ') continue
    const reverse = line.pathReverse ?? line.path
    for (const stop of line.path) pairs.add(dirKey(line.lineCode, `${line.operator}-${stop.station}`, 'F'))
    for (const stop of reverse) pairs.add(dirKey(line.lineCode, `${line.operator}-${stop.station}`, 'R'))
  }
  return pairs
}

interface Derived {
  /** Per-(line, station) headway, seconds. */
  perStop: Map<string, number>
  /**
   * Per-(line, station, direction), seconds — ONLY where the two directions
   * differ. Absent means both directions equal the `perStop` value.
   */
  perDirection: Map<string, number>
  /** Per-line fallback, seconds. */
  perLine: Map<string, number>
  /** Lines whose only service runs at the weekend — no weekday headway exists. */
  weekendOnly: Set<string>
  /** Topology pairs that fell back to their line's value, for the run summary. */
  fellBack: string[]
}

/*
 * TJ: combined frequency per (line, stop), weekday services only.
 *
 * `trip_id` is joined through `trips.txt` to `route_id` rather than stripped with
 * a regex — route ids like `JAK.74` and `ASG5` make pattern-matching a hazard,
 * and the join is exact. Note this keys on `route_id`, NOT `route_short_name`:
 * generateTJSQL.ts writes `route_id` into `stationLines` and `edges`, so keying
 * on the short name would silently drop every headway the day a feed makes the
 * two differ.
 */
function tjHeadways(topology: Set<string>, topologyByDirection: Set<string>): Derived {
  const lineTermini = lineTerminiMap()
  const trips = new Map(load('trips.txt').map(t => [t.trip_id!, t]))
  const scopedRoutes = new Set(
    load('routes.txt').filter(r => SCOPE_DESC.has(r.route_desc!)).map(r => r.route_id!)
  )
  const calendar = new Map(load('calendar.txt').map(c => [c.service_id!, c]))
  const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const

  const runsOnAWeekday = (serviceId: string): boolean => {
    const service = calendar.get(serviceId)
    return !!service && WEEKDAYS.some(day => service[day] === '1')
  }

  // Weekday headways per trip, and the lines that only ever run at the weekend.
  const weekdayHeadways = new Map<string, number[]>()
  const weekendLines = new Set<string>()
  const weekdayLines = new Set<string>()
  for (const row of load('frequencies.txt')) {
    const trip = trips.get(row.trip_id!)
    if (!trip || !scopedRoutes.has(trip.route_id!) || STALE_SERVICES.has(trip.service_id!)) continue

    const headway = Number(row.headway_secs)
    if (!Number.isFinite(headway) || headway <= 0) continue

    if (runsOnAWeekday(trip.service_id!)) {
      weekdayLines.add(trip.route_id!)
      weekdayHeadways.set(row.trip_id!, [...(weekdayHeadways.get(row.trip_id!) ?? []), headway])
    } else {
      weekendLines.add(trip.route_id!)
    }
  }

  // Stop sets per trip, collapsing platform children onto their parent halte —
  // the same `parent_station ?? stop_id` rule generateTJSQL.ts imports stations
  // with, so these ids match `stations.id`.
  const stops = new Map(load('stops.txt').map(s => [s.stop_id!, s]))
  const collapse = (id: string): string => {
    const stop = stops.get(id)
    return stop?.parent_station ? stop.parent_station : id
  }

  /*
   * Ordered stop sequence per trip. Direction is decided from the whole sequence,
   * not stop by stop, so the rows are gathered before anything is accumulated.
   * Collapsed ids here, matching what `stations.id` carries.
   */
  const sequences = new Map<string, { seq: number, station: string }[]>()
  for (const row of load('stop_times.txt')) {
    if (!weekdayHeadways.has(row.trip_id!)) continue
    const list = sequences.get(row.trip_id!) ?? []
    list.push({ seq: Number(row.stop_sequence), station: collapse(row.stop_id!) })
    sequences.set(row.trip_id!, list)
  }
  for (const list of sequences.values()) list.sort((a, b) => a.seq - b.seq)

  const indices = directionIndices()
  const perStopHeadways = new Map<string, number[]>()
  const perDirHeadways = new Map<string, number[]>()
  const perLineHeadways = new Map<string, number[]>()
  const directionCounts = { F: 0, R: 0, BOTH: 0 }

  for (const [tripId, headways] of weekdayHeadways) {
    const trip = trips.get(tripId)!
    const line = trip.route_id!
    const ordered = (sequences.get(tripId) ?? []).map(r => r.station)
    const directions = tripDirections(ordered, indices.get(line))
    directionCounts[directions.length === 2 ? 'BOTH' : directions[0]!]++

    // A trip that visits a stop twice (loop corridors) must contribute its
    // frequency once, not twice — otherwise the loop looks twice as frequent.
    for (const station of new Set(ordered)) {
      const stationId = `TJ-${station}`
      const key = stopKey(line, stationId)
      perStopHeadways.set(key, [...(perStopHeadways.get(key) ?? []), ...headways])
      for (const dir of directions) {
        const dk = dirKey(line, stationId, dir)
        perDirHeadways.set(dk, [...(perDirHeadways.get(dk) ?? []), ...headways])
      }
    }
  }
  for (const [tripId, headways] of weekdayHeadways) {
    const line = trips.get(tripId)!.route_id!
    perLineHeadways.set(line, [...(perLineHeadways.get(line) ?? []), ...headways])
  }

  const perStop = new Map<string, number>()
  for (const [key, headways] of perStopHeadways) {
    if (topology.has(key)) perStop.set(key, clamp(combine(headways)))
  }
  const perLine = new Map<string, number>()
  for (const [line, headways] of perLineHeadways) perLine.set(line, clamp(combine(headways)))

  /*
   * Keep only the pairs whose two directions actually differ.
   *
   * Both halves are emitted together or neither is, so a consumer that finds one
   * key can rely on its opposite existing. Where the directions agree the combined
   * `perStop` value already says the same thing, and emitting it twice would
   * double the rows on a halte page for no information.
   */
  const perDirection = new Map<string, number>()
  for (const key of perStop.keys()) {
    const servesForward = topologyByDirection.has(`${key}@F`)
    const servesReverse = topologyByDirection.has(`${key}@R`)
    const forward = servesForward ? perDirHeadways.get(`${key}@F`) : undefined
    const reverse = servesReverse ? perDirHeadways.get(`${key}@R`) : undefined

    /*
     * A halte the corridor only passes ONE way. The number is already
     * direction-specific — it just never said so, leaving a rider at (say)
     * Koridor 1's Kejaksaan Agung with a Blok M-bound frequency and no hint that
     * nothing runs the other way. One labelled row, not two.
     *
     * Note this deliberately breaks the "both halves together" symmetry that the
     * two-way case guarantees, so consumers must read the halves independently.
     */
    if (servesForward !== servesReverse) {
      const only = servesForward ? 'F' : 'R'
      const headways = servesForward ? forward : reverse
      if (headways) perDirection.set(`${key}@${only}`, clamp(combine(headways)))
      continue
    }

    /*
     * A terminus is not two directions. Standing at Tanjung Priok, corridor 12's
     * "arah Tanjung Priok" is where buses ARRIVE, not a service anyone boards —
     * only the outbound direction is a departure. Splitting there would label a
     * row with the name of the halte the rider is already standing at.
     */
    const [lineCode, stationId] = [key.slice(0, key.indexOf('@')), key.slice(key.indexOf('@') + 1)]
    const terminus = lineTermini.get(lineCode)
    if (terminus && (terminus.F === stationId || terminus.R === stationId)) continue

    if (!forward || !reverse) continue
    const f = clamp(combine(forward))
    const r = clamp(combine(reverse))
    // Both directions agree: the combined value already says this, and emitting
    // it twice would put two identical rows on a halte page.
    if (f === r) continue
    perDirection.set(`${key}@F`, f)
    perDirection.set(`${key}@R`, r)
  }

  /*
   * Topology pairs the feed gave us nothing for are deliberately NOT written into
   * the per-stop map. Both consumers already fall back to the line-level value on
   * a miss, and materialising it here would make a borrowed number indistinguishable
   * from a measured one — the API reports `source: 'STOP' | 'LINE'`, and that
   * distinction is only true if a per-stop entry means the stop was really measured.
   * They are collected for the run summary so the fallback stays visible.
   */
  const fellBack = [...topology]
    .filter(key => !perStop.has(key) && perLine.has(key.split('@')[0]!))

  console.log(`  TJ trips by direction: F=${directionCounts.F} R=${directionCounts.R} both/loop=${directionCounts.BOTH}`)

  return {
    perStop,
    perDirection,
    perLine,
    weekendOnly: new Set([...weekendLines].filter(l => !weekdayLines.has(l))),
    fellBack
  }
}

/*
 * Rail: median gap between consecutive departures, per (line, station).
 *
 * Read through `wrangler d1 execute --local`, matching how the other generators
 * reach the database. Distinct departure times only: several trips share a
 * departure minute at a busy station, and counting those as zero-second gaps
 * would collapse every median to nothing.
 */
function railHeadways(): Derived {
  const sql = `SELECT lineCode, stationId, boundFor, estimatedDeparture FROM schedules
               WHERE lineCode IS NOT NULL AND lineCode != 'NUL'`
  const raw = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'commute', '--local', '--command', sql, '--json'],
    { cwd: `${__dirname}/../../..`, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }
  )
  const rows = JSON.parse(raw.slice(raw.indexOf('[')))[0].results as {
    lineCode: string
    stationId: string
    estimatedDeparture: string
  }[]

  // Group per (line, station): a headway is what one rider waits at one stop,
  // not the gap between departures anywhere on the line.
  const byStop = new Map<string, Set<number>>()
  for (const row of rows) {
    const key = stopKey(row.lineCode, row.stationId)
    const times = byStop.get(key) ?? new Set<number>()
    times.add(toSeconds(row.estimatedDeparture.slice(-8)))
    byStop.set(key, times)
  }

  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]!
  }

  const perStop = new Map<string, number>()
  const gapsByLine = new Map<string, number[]>()
  for (const [key, times] of byStop) {
    const line = key.split('@')[0]!
    const sorted = [...times].sort((a, b) => a - b)
    const gaps: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i]! - sorted[i - 1]!
      // Over two hours is the overnight break, not a wait.
      if (gap > 0 && gap <= 7200) gaps.push(gap)
    }
    if (gaps.length === 0) continue
    perStop.set(key, clamp(median(gaps)))
    gapsByLine.set(line, [...(gapsByLine.get(line) ?? []), ...gaps])
  }

  const perLine = new Map<string, number>()
  for (const [line, gaps] of gapsByLine) perLine.set(line, clamp(median(gaps)))

  // Rail stations show a real departure board with true boundFor values, so they
  // neither call /headway nor need a directional split.
  return { perStop, perDirection: new Map(), perLine, weekendOnly: new Set(), fellBack: [] }
}

const topology = topologyPairs()
const tj = tjHeadways(topology, topologyDirectionPairs())
const rail = railHeadways()

const perLine = new Map([...tj.perLine, ...rail.perLine])
const perStop = new Map([...tj.perStop, ...rail.perStop])
for (const [line, seconds] of Object.entries(OVERRIDES)) perLine.set(line, clamp(seconds))

const perDirection = new Map([...tj.perDirection, ...rail.perDirection])

/*
 * Terminus per line and direction, for the "arah ..." labels a halte page shows.
 *
 * Station IDS rather than names: the display name is resolved against the stations
 * table at request time, so renaming a station does not require regenerating this
 * file. `F` is the last stop of TOPOLOGY `path`, `R` of `pathReverse`.
 */
const termini = lineTerminiMap()

const weekendOnly = [...tj.weekendOnly].sort((a, b) => a.localeCompare(b))
const lineEntries = [...perLine].sort(([a], [b]) => a.localeCompare(b))
const stopEntries = [...perStop].sort(([a], [b]) => a.localeCompare(b))
const dirEntries = [...perDirection].sort(([a], [b]) => a.localeCompare(b))
const terminusEntries = [...termini].sort(([a], [b]) => a.localeCompare(b))
const overridden = new Set(Object.keys(OVERRIDES))

const fileTS = '/*\n'
  + ' * Seconds between vehicles, per line, per (line, stop), and per direction.\n'
  + ' *\n'
  + ' * GENERATED — do not edit by hand; re-run `pnpm --filter api generate:headways`.\n'
  + ' * TJ values combine the frequencies of every weekday route variant serving a\n'
  + ' * stop (1/Σ(1/h)); rail values are the median gap between departures in the\n'
  + ` * schedules table. Both are clamped to [${HEADWAY_FLOOR_S}, ${HEADWAY_CAP_S}] seconds.\n`
  + ' * See generateHeadways.ts for why.\n'
  + ' *\n'
  + ' * Consumed by routes/fares.ts as the planner\'s expected-wait input and by the\n'
  + ' * /stations/:operator/:code/headway endpoint. It is an average, not a schedule:\n'
  + ' * it cannot say when the next vehicle comes, only how long a rider tends to\n'
  + ' * wait for one.\n'
  + ' */\n\n'
  + '/** Per-line fallback, used when a stop has no measured value of its own. */\n'
  + 'export const HEADWAYS_S: Record<string, number> = {\n'
  + lineEntries.map(([line, s]) => `  '${line}': ${s}${overridden.has(line) ? ' // HAND-OVERRIDE' : ''}`).join(',\n')
  + '\n}\n\n'
  + '/** Per-(line, station) headway. Key: `${lineCode}@${stationId}`. */\n'
  + 'export const STOP_HEADWAYS_S: Record<string, number> = {\n'
  + stopEntries.map(([key, s]) => `  '${key}': ${s}`).join(',\n')
  + '\n}\n\n'
  + '/*\n'
  + ' * Lines whose only service runs at the weekend, so no weekday headway exists.\n'
  + ' * These deliberately carry NO value rather than borrowing a neighbouring one:\n'
  + ' * a number here would assert weekday service that does not run.\n'
  + ' */\n'
  + `export const WEEKEND_ONLY_LINES: readonly string[] = [${weekendOnly.map(l => `'${l}'`).join(', ')}]\n\n`
  + '/*\n'
  + ' * Per-(line, station, direction), ONLY where the two directions genuinely\n'
  + ' * differ. A pair absent here means both directions match STOP_HEADWAYS_S, so a\n'
  + ' * halte page shows one row instead of two identical ones.\n'
  + ' *\n'
  + ' * `F` follows TOPOLOGY `path`, `R` follows `pathReverse`. Both halves are always\n'
  + ' * emitted together, so finding one key guarantees its opposite exists.\n'
  + ' *\n'
  + ' * Direction comes from TOPOLOGY, never GTFS `direction_id` — that field is broken\n'
  + ' * in this feed (Koridor 5 labels both directions `0`).\n'
  + ' */\n'
  + 'export const DIRECTIONAL_HEADWAYS_S: Record<string, number> = {\n'
  + dirEntries.map(([key, s]) => `  '${key}': ${s}`).join(',\n')
  + '\n}\n\n'
  + '/*\n'
  + ' * Terminus station id per line and direction, for "arah ..." labels. Names are\n'
  + ' * resolved against the stations table at request time so a rename needs no\n'
  + ' * regeneration here.\n'
  + ' */\n'
  + 'export const LINE_TERMINI: Record<string, { F: string, R: string }> = {\n'
  + terminusEntries.map(([line, t]) => `  '${line}': { F: '${t.F}', R: '${t.R}' }`).join(',\n')
  + '\n}\n'

fs.writeFileSync(OUT_PATH, fileTS)

console.log(`Wrote ${lineEntries.length} line headways and ${stopEntries.length} stop headways to ${OUT_PATH}`)
const twoWay = dirEntries.filter(([k]) => perDirection.has(`${k.slice(0, -1)}${k.endsWith('F') ? 'R' : 'F'}`)).length
console.log(`  Directional:          ${twoWay / 2} split pairs + ${dirEntries.length - twoWay} one-way stops = ${dirEntries.length} entries`)
console.log(`  Termini:              ${terminusEntries.length} corridors`)
console.log(`  TJ   — ${tj.perLine.size} lines, ${tj.perStop.size} stop pairs (of ${topology.size} in TOPOLOGY)`)
console.log(`  Rail — ${rail.perLine.size} lines, ${rail.perStop.size} stop pairs`)
if (weekendOnly.length > 0) console.log(`  Weekend-only lines:   ${weekendOnly.join(', ')}`)
if (tj.fellBack.length > 0) console.log(`  Line-level fallbacks: ${tj.fellBack.sort().join(', ')}`)
if (overridden.size > 0) console.log(`  Hand overrides:       ${[...overridden].join(', ')}`)

// A topology pair with no value at all is either a weekend-only line or a real
// gap worth knowing about. Naming them keeps a silent fallback from turning a
// rerouted corridor into a plausible-looking wrong number.
const uncovered = [...topology].filter(k => !perStop.has(k))
if (uncovered.length > 0) {
  const byLine = new Map<string, number>()
  for (const key of uncovered) {
    const line = key.split('@')[0]!
    byLine.set(line, (byLine.get(line) ?? 0) + 1)
  }
  const summary = [...byLine].sort(([a], [b]) => a.localeCompare(b))
    .map(([line, n]) => `${line}:${n}${tj.weekendOnly.has(line) ? ' (weekend-only)' : ''}`)
  console.log(`  No weekday value:     ${uncovered.length} pairs — ${summary.join(', ')}`)
}
