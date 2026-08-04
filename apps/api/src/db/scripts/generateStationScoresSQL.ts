import * as fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { STATION_SCORE_MAX } from '@commute/constants'
import { anchorDemand, RIDERSHIP_BY_STATION_ID } from '../data/ridership'
import { TOPOLOGY } from '../data/topology'

/*
 * Generates `stations.score` and `hubs.score` — the search/picker ranking.
 *
 * TWO LAYERS, because we have measured data for 15 stations and none for the
 * other ~135:
 *
 *   anchored   score from published ridership (db/data/ridership.ts). Measured.
 *   unanchored score from service volume + network structure. An ESTIMATE.
 *
 * Anchors always win. They are not blended with the estimate, because the
 * estimate is wrong in ways the anchors exist to correct: LRT Jabodebek's Dukuh
 * Atas is the operator's busiest station and its LAST by departure count, since
 * a terminus is served in one direction only.
 *
 * WHY THE ESTIMATE IS ONLY A BAND. Service is measured per LINE, not per
 * station: on MRTJ, LRTJ and LRTJBDB every train stops everywhere, so every
 * through station on a line shares one departure count. MRT's five anchors all
 * sit at 340,800 seat-passes yet range from 11,099 to 24,096 riders a day.
 * Nothing in the database distinguishes Cilebut from Bogor except that Bogor is
 * a terminus. So the estimate places a station in the right band — KCI trunk
 * above LRT Jabodebek above LRT Jakarta — and structure orders it within that
 * band. It does not claim to know within-line variation, and its ceiling
 * (ESTIMATE_MAX) keeps it below the measured interchanges on purpose.
 *
 * Rail only. TransJakarta has no timetables (headway-based GTFS) and no
 * published per-halte ridership, so TJ stays at the DEFAULT 0 and is not
 * emitted here. When TJ is scored, note that db/scripts/tj_stations_insert.sql
 * is an INSERT OR REPLACE with no `score` column: a TJ reseed wipes TJ scores,
 * so the score seed must be applied after it.
 *
 * Reads the DB via `wrangler d1 execute --json`; emits an UPDATE seed. Apply:
 *   pnpm --filter api generate:station-scores -- --remote
 *   wrangler d1 execute commute --remote --file=src/db/scripts/station_scores.sql
 * Then bump API_VERSION in wrangler.toml — routes/cache.ts is not mounted, so a
 * version bump is the only way to clear the five KV families that carry score.
 */

const OUTPUT_SQL_PATH = `${__dirname}/station_scores.sql`
const DB_NAME = 'commute'
const LOCAL = !process.argv.includes('--remote')

/** Operators with timetables, and so with a service term. TJ is excluded. */
const RAIL_OPERATORS = ['KCI', 'MRTJ', 'LRTJ', 'LRTJBDB'] as const
type RailOperator = typeof RAIL_OPERATORS[number]

/*
 * Nominal passengers per vehicle, by operator. Converts each line's train count
 * into a common unit so a KRL trunk and a light-rail branch can be compared at
 * all — five facts about rolling stock rather than 150 opinions about stations,
 * and the honest reason a 12-car KRL line outranks a 2-car one.
 */
const CAPACITY: Record<RailOperator, number> = {
  KCI: 2000, //     12-car KRL, crush load
  MRTJ: 1200, //    6-car Nippon Sharyo
  LRTJBDB: 740, //  6-car
  LRTJ: 270 //      2-car
}

/*
 * Per-line overrides, where a line does not run its operator's usual stock.
 *
 * 'A' is the Soekarno-Hatta airport line: a 6-car KA Bandara set seating ~300,
 * not a 12-car KRL. KCI's 2024 annual report puts the Basoetta line at
 * 2,246,651 passengers — 6,155 a day over 64 trips, about 96 a train — so the
 * operator default overstated every airport-line station by roughly 6x on this
 * term. Duri, Batu Ceper, Rawa Buaya and BNI City all sit on it.
 */
const LINE_CAPACITY: Record<string, number> = {
  A: 300
}

/*
 * Log-scale anchors for the service term, in seat-passes per day.
 *
 * Fixed, not observed min/max: with min-max every station's score depends on
 * the extremes, so adding one quiet halte re-scores the network and the emitted
 * diff becomes unreadable. generatePruneStationLinesSQL.ts fixes its own
 * constants for the same reason.
 *
 * Log, not linear: service spans ~5e4 (LRT Jakarta) to ~1.5e6 (Manggarai), and
 * a linear map would flatten everything below the top interchanges into the
 * bottom third. Log gives a fixed step per doubling of service, which is closer
 * to how frequency is actually perceived.
 */
const SERVICE_FLOOR = 40_000
const SERVICE_CEIL = 1_500_000

/*
 * Log-scale anchors for measured demand, in passengers per day. CEIL sits just
 * above Tanah Abang (244,126 = 89,126 gate + 155,000 transit), the largest
 * measured figure on the network; FLOOR is a plausibly quiet station.
 */
const DEMAND_FLOOR = 500
const DEMAND_CEIL = 250_000

/*
 * How far the two halves of the estimate can carry a station.
 *
 * Service is the larger term because it separates the operators; structure is
 * smaller but is the ONLY discriminator within a line, so it has to be able to
 * move a station without ever lifting a branch halte above a trunk. Their sum
 * is the estimate's ceiling: an unanchored station cannot reach the scores that
 * measured interchanges hold, which is the intended asymmetry — we should not
 * claim a station is busy on structural grounds alone.
 */
const SERVICE_WEIGHT = 0.60
const STRUCTURE_WEIGHT = 0.30
export const ESTIMATE_MAX = SERVICE_WEIGHT + STRUCTURE_WEIGHT

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** Position on a log scale between two fixed anchors. */
function logNormalize(value: number, floor: number, ceil: number): number {
  if (value <= 0) return 0
  return clamp01((Math.log1p(value) - Math.log1p(floor)) / (Math.log1p(ceil) - Math.log1p(floor)))
}

export interface StationFacts {
  /** Seat-passes per day: sum over the station's lines of trips x capacity. */
  service: number
  /** Distinct lines calling here. */
  lineCount: number
  /** Distinct INTERNAL transfer partners. */
  interchangePartners: number
  hubMember: boolean
  terminus: boolean
  /** Measured passengers per day, when published. */
  measuredDemand?: number
}

/**
 * How much service passes through, in [0, 1]. Constant along a line by
 * construction — see the header.
 */
export function serviceTerm(service: number): number {
  return logNormalize(service, SERVICE_FLOOR, SERVICE_CEIL)
}

/**
 * What the network shape says about a station, in [0, 1].
 *
 * Interchange degree dominates because a station serving several lines is where
 * riders actually converge. Terminus is worth the least: it makes a station
 * notable without making it busy, and the LRT Jabodebek anchors show termini
 * running the full range from busiest to quietest.
 */
export function structureTerm(facts: StationFacts): number {
  return clamp01(
    0.35 * Math.min(1, (facts.lineCount - 1) / 2)
    + 0.30 * Math.min(1, facts.interchangePartners / 3)
    + 0.25 * (facts.hubMember ? 1 : 0)
    + 0.10 * (facts.terminus ? 1 : 0)
  )
}

/**
 * Final 0-100 score. Measured demand where we have it, banded estimate where we
 * do not. Clamped, which is what makes the fuzzy-match tier invariant in
 * apps/web/utils/fuzzy-match.ts true by construction rather than by convention.
 */
export function stationScore(facts: StationFacts): number {
  const normalized = facts.measuredDemand !== undefined
    ? logNormalize(facts.measuredDemand, DEMAND_FLOOR, DEMAND_CEIL)
    : SERVICE_WEIGHT * serviceTerm(facts.service) + STRUCTURE_WEIGHT * structureTerm(facts)

  return Math.round(STATION_SCORE_MAX * clamp01(normalized))
}

/** True when the score came from published ridership rather than an estimate. */
export function isAnchored(facts: StationFacts): boolean {
  return facts.measuredDemand !== undefined
}

// ── I/O ─────────────────────────────────────────────────────────────────────

interface Row { [k: string]: string | number | null }

function d1(sql: string): Row[] {
  const args = ['wrangler', 'd1', 'execute', DB_NAME, LOCAL ? '--local' : '--remote', '--json', '--command', sql]
  const out = execFileSync('npx', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
  // wrangler prints a JSON array of result objects; grab the first result set.
  const json = JSON.parse(out.slice(out.indexOf('[')))
  return json[0]?.results ?? []
}

/** Every station that is the first or last stop of a path, branch, or reverse run. */
function collectTermini(): Set<string> {
  const termini = new Set<string>()
  const add = (operator: string, stops: { station: string }[]) => {
    if (stops.length === 0) return
    termini.add(`${operator}-${stops[0].station}`)
    termini.add(`${operator}-${stops[stops.length - 1].station}`)
  }
  for (const line of TOPOLOGY) {
    if (line.operator === 'TJ') continue
    add(line.operator, line.path)
    if (line.pathReverse) add(line.operator, line.pathReverse)
    for (const branch of line.branches ?? []) add(line.operator, branch.path)
  }
  return termini
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function main() {
  const operatorList = RAIL_OPERATORS.map(operator => `'${operator}'`).join(', ')

  // Peak departures per line: the MAX over stations, not each station's own
  // count. A terminus is served in one direction only, so its own count halves
  // and a station-local reading would rank every terminus last on its line.
  const peakRows = d1(`
    SELECT lineCode, MAX(cnt) AS peak FROM (
      SELECT lineCode, stationId, COUNT(*) AS cnt
      FROM schedules WHERE lineCode <> 'NUL'
      GROUP BY lineCode, stationId
    ) GROUP BY lineCode;
  `)
  const peakByLine = new Map<string, number>(peakRows.map(row => [String(row.lineCode), Number(row.peak)]))

  const stationRows = d1(`SELECT id, name, operator FROM stations WHERE operator IN (${operatorList}) ORDER BY id;`)
  // Own departure count, for stations the line topology does not cover: the
  // Commuter Line Merak stops (Merak, Cilegon, Krenceng, ...) are region CGK and
  // searchable but carry no stationLines rows, so a line-based reading alone
  // would score them 0 for want of a join rather than for want of service. They
  // run 7-14 departures a day and still land near 0 — now because that is what
  // the timetable says.
  const ownDepartureRows = d1(`
    SELECT sc.stationId, COUNT(*) AS cnt FROM schedules sc
    JOIN stations s ON s.id = sc.stationId
    WHERE s.operator IN (${operatorList}) AND sc.lineCode <> 'NUL'
    GROUP BY sc.stationId;
  `)
  const ownDepartures = new Map<string, number>(ownDepartureRows.map(row => [String(row.stationId), Number(row.cnt)]))
  const lineRows = d1(`
    SELECT sl.stationId, sl.lineCode FROM stationLines sl
    JOIN stations s ON s.id = sl.stationId
    WHERE s.operator IN (${operatorList}) GROUP BY sl.stationId, sl.lineCode;
  `)
  // EXTERNAL rows point at operators we do not model (KCIC), so they are not
  // interchange in the sense that matters to a rider using this app.
  const transferRows = d1(`SELECT fromStationId, toStationId FROM transfers WHERE dataType = 'INTERNAL' AND toStationId IS NOT NULL;`)
  const hubRows = d1(`SELECT hubId, stationId FROM hubStations;`)

  const linesByStation = new Map<string, string[]>()
  for (const row of lineRows) {
    const id = String(row.stationId)
    if (!linesByStation.has(id)) linesByStation.set(id, [])
    linesByStation.get(id)!.push(String(row.lineCode))
  }

  // Transfers are made symmetric in buildGraph, so count both directions here.
  const partnersByStation = new Map<string, Set<string>>()
  const link = (from: string, to: string) => {
    if (!partnersByStation.has(from)) partnersByStation.set(from, new Set())
    partnersByStation.get(from)!.add(to)
  }
  for (const row of transferRows) {
    const from = String(row.fromStationId)
    const to = String(row.toStationId)
    link(from, to)
    link(to, from)
  }

  const hubMembers = new Set(hubRows.map(row => String(row.stationId)))
  const hubIdByStation = new Map(hubRows.map(row => [String(row.stationId), String(row.hubId)]))
  const termini = collectTermini()

  const scored: { id: string, name: string, operator: string, score: number, anchored: boolean }[] = []
  for (const row of stationRows) {
    const id = String(row.id)
    const operator = String(row.operator) as RailOperator
    const lines = linesByStation.get(id) ?? []
    const capacity = CAPACITY[operator] ?? 0
    const service = lines.length > 0
      ? lines.reduce((total, lineCode) => total + (peakByLine.get(lineCode) ?? 0) * (LINE_CAPACITY[lineCode] ?? capacity), 0)
      : (ownDepartures.get(id) ?? 0) * capacity
    const anchor = RIDERSHIP_BY_STATION_ID.get(id)

    const facts: StationFacts = {
      service,
      lineCount: lines.length,
      interchangePartners: partnersByStation.get(id)?.size ?? 0,
      hubMember: hubMembers.has(id),
      terminus: termini.has(id),
      ...(anchor ? { measuredDemand: anchorDemand(anchor) } : {})
    }

    scored.push({
      id,
      name: String(row.name),
      operator,
      score: stationScore(facts),
      anchored: isAnchored(facts)
    })
  }

  // A hub is as prominent as its most prominent member: HubRepository.getAll
  // orders by this, and the search sheet already nudges non-station results
  // down, so max keeps "Dukuh Atas" the hub just under its busiest station.
  const hubScores = new Map<string, number>()
  for (const station of scored) {
    const hubId = hubIdByStation.get(station.id)
    if (!hubId) continue
    hubScores.set(hubId, Math.max(hubScores.get(hubId) ?? 0, station.score))
  }

  const lines: string[] = [
    '-- Generated by db/scripts/generateStationScoresSQL.ts. Do not edit by hand.',
    '-- Station search/picker ranking. Anchored scores are measured ridership',
    '-- (db/data/ridership.ts); the rest are service+structure estimates.',
    '-- Apply AFTER any TJ reseed, then bump API_VERSION in wrangler.toml.',
    ''
  ]
  // Every rail station, including the zeros: the file is complete state, so a
  // station dropping off the roster gets zeroed instead of keeping a stale score.
  for (const station of scored) {
    const note = station.anchored ? ' -- measured' : ''
    lines.push(`UPDATE stations SET score = ${station.score}, updatedAt = CURRENT_TIMESTAMP WHERE id = '${station.id}';${note}`)
  }
  lines.push('')
  for (const [hubId, score] of [...hubScores].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`UPDATE hubs SET score = ${score}, updatedAt = CURRENT_TIMESTAMP WHERE id = '${hubId}';`)
  }
  lines.push('')
  fs.writeFileSync(OUTPUT_SQL_PATH, lines.join('\n'), 'utf-8')

  // ── summary ───────────────────────────────────────────────────────────────
  const anchoredCount = scored.filter(station => station.anchored).length
  console.log(`Wrote ${scored.length} station scores and ${hubScores.size} hub scores to ${OUTPUT_SQL_PATH}`)
  console.log(`  ${anchoredCount} measured, ${scored.length - anchoredCount} estimated\n`)

  for (const operator of RAIL_OPERATORS) {
    const scores = scored.filter(station => station.operator === operator).map(station => station.score)
    if (scores.length === 0) continue
    console.log(`  ${operator.padEnd(8)} n=${String(scores.length).padStart(3)}  min=${Math.min(...scores)}  median=${median(scores)}  max=${Math.max(...scores)}`)
  }

  console.log('\n  Top 15:')
  for (const station of [...scored].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 15)) {
    console.log(`    ${String(station.score).padStart(3)}  ${station.name.padEnd(32)} ${station.anchored ? 'measured' : 'estimated'}`)
  }

  const overflow = scored.filter(station => station.score > STATION_SCORE_MAX || station.score < 0)
  if (overflow.length > 0) {
    console.warn(`\n  WARNING: ${overflow.length} station(s) outside [0, ${STATION_SCORE_MAX}] before clamping — check the constants.`)
  }

  const missingAnchors = [...RIDERSHIP_BY_STATION_ID.keys()].filter(id => !scored.some(station => station.id === id))
  if (missingAnchors.length > 0) {
    console.warn(`\n  WARNING: ${missingAnchors.length} anchor(s) match no station: ${missingAnchors.join(', ')}`)
  }
}

if (require.main === module) main()
