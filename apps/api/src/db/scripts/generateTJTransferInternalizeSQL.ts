import * as fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { haversineMeters } from '../../utils/geo'

/*
 * Reconciles the legacy EXTERNAL rail->TransJakarta transfer rows against the
 * now-imported TJ stations, rewriting each matched row to INTERNAL so the router
 * can walk rail <-> TJ (transfers are made symmetric in buildGraph, so one
 * direction per pair is enough).
 *
 * Matching: exact station-name first (when it resolves to exactly one TJ
 * station); otherwise the nearest TJ station to the rail origin's coordinates,
 * within MAX_MATCH_M. Non-TJ externals (e.g. KCIC) are ignored. Unresolved rows
 * are left EXTERNAL and reported.
 *
 * Reads the DB via `wrangler d1 execute --json`; emits an UPDATE seed. Apply:
 *   pnpm --filter api generate:tj-transfers   (then wrangler d1 execute --file)
 */

const OUTPUT_SQL_PATH = `${__dirname}/tj_internalize_transfers.sql`
const DB_NAME = 'commute'
const TJ_OPERATOR_NAME = 'TransJakarta'
// A rail-to-TJ interchange is a walk; anything beyond this isn't the same complex.
const MAX_MATCH_M = 400

const LOCAL = !process.argv.includes('--remote')

// Hand-measured walk lengths for the name-matched interchanges (metres, measured
// along the real path). Authoritative — these override both the stored `distance`
// and any computed haversine, so re-running is idempotent regardless of what a
// prior run wrote. Proximity matches are not listed; they keep their computed m.
const MEASURED_DISTANCE_M: Record<string, number> = {
  'T-KCI-SUD-XTJ1': 310, // Sudirman -> Dukuh Atas
  'T-KCI-SUD-XTJ2': 310, // Sudirman -> Galunggung
  'T-KCI-SUD-XTJ3': 70, //  Sudirman -> Transport Hub Dukuh Atas
  'T-LRTJBDB-CWG-XTJ1': 170, // Cawang (LRT) -> Cawang (TJ)
  'T-LRTJBDB-KUA-XTJ1': 80, //  Kuningan (LRT) -> Kuningan (TJ)
  'T-LRTJBDB-RAS-XTJ1': 80, //  Rasuna Said (LRT) -> Rasuna Said (TJ)
  'T-MRTJ-BLM-XTJ1': 240 //    Blok M (MRT) -> Blok M (TJ)
}

/*
 * Walk lengths for interchanges that are ALREADY internal (metres).
 *
 * Separate from MEASURED_DISTANCE_M above, which keys on transfer id and only
 * covers rows this script converts from EXTERNAL. These are keyed on the
 * station pair and emitted in both directions, because the DB stores each walk
 * as two mirrored rows.
 *
 * Why this exists: 66 of 116 internal transfers stored `distance = 0`, which
 * meant *unmeasured*, not zero-length. The old router masked it by charging a
 * flat TRANSFER_PENALTY_M per walk; @commute/tsundere's planner drops that
 * penalty on purpose (boardings and waiting are explicit criteria now), so a 0m
 * transfer became free on every axis and the engine happily chained several.
 * Cakung -> Karet Kuningan returned four journeys, two of them nonsense: an
 * "0m walking" route through Jatinegara and a detour via MRT. With these
 * applied it returns the two that are actually sensible.
 *
 * Measured 2026-08-03 along the real walked path, except where noted.
 */
const INTERCHANGE_WALK_M: [string, string, number, string][] = [
  // Senen. Conservative: a shortcut through Senen Jaya mall may make the two
  // PSE walks shorter, but it is unconfirmed, and over-estimating only makes
  // the router mildly transfer-shy. Revise if the mall route is verified.
  ['KCI-PSE', 'TJ-H00212P', 550, 'Pasar Senen -> Senen TOYOTA Rangga'],
  ['KCI-PSE', 'TJ-H00213P', 650, 'Pasar Senen -> Jaga Jakarta (550 + 60 + 40)'],
  ['TJ-H00212P', 'TJ-H00213P', 60, 'Toyota Rangga -> Jaga Jakarta (no tap)'],
  // Senen, remainder: the road network there is too tangled to trace, so these
  // are haversine x1.3 — the ratio the measured legs above run at.
  ['KCI-PSE', 'TJ-H00005P', 630, 'Pasar Senen -> Senen Raya (estimated)'],
  ['TJ-H00005P', 'TJ-H00213P', 385, 'Senen Raya -> Jaga Jakarta (estimated)'],
  ['TJ-H00005P', 'TJ-H00212P', 430, 'Senen Raya -> Toyota Rangga (estimated)'],
  // Jatinegara
  ['KCI-JNG', 'TJ-H00225P', 110, 'Jatinegara -> Stasiun Jatinegara'],
  ['TJ-H00225P', 'TJ-H00148P', 300, 'Stasiun Jatinegara -> Bali Mester'],
  ['KCI-JNG', 'TJ-H00148P', 460, 'Jatinegara -> Bali Mester (110 + 300 + 50)'],
  // Kebayoran
  ['KCI-KBY', 'TJ-H00257P', 490, 'Kebayoran -> Velbak'],
  ['KCI-KBY', 'TJ-H00149P', 250, 'Kebayoran -> Kebayoran (TJ)'],
  ['TJ-H00149P', 'TJ-H00257P', 320, 'Kebayoran (TJ) -> Velbak'],
  // ASEAN / CSW. The 200m legs are short on the map but four storeys of climb.
  ['MRTJ-SSM', 'TJ-H00041P', 200, 'Stasiun ASEAN -> CSW 1'],
  ['MRTJ-SSM', 'TJ-H00265P', 130, 'Stasiun ASEAN -> ASEAN'],
  ['MRTJ-SSM', 'TJ-H00266P', 150, 'Stasiun ASEAN -> Kejaksaan Agung'],
  ['TJ-H00266P', 'TJ-H00265P', 110, 'Kejaksaan Agung -> ASEAN'],
  ['TJ-H00266P', 'TJ-H00041P', 200, 'Kejaksaan Agung -> CSW 1'],
  ['TJ-H00265P', 'TJ-H00041P', 200, 'ASEAN -> CSW 1'],
  // Singles
  ['LRTJBDB-KAM', 'TJ-H00096P', 310, 'Kampung Rambutan; Maps 310m, FDTJ totem 200m'],
  ['MRTJ-BHI', 'TJ-H00022P', 180, 'Bundaran HI'],
  ['LRTJBDB-TMI', 'TJ-H00060P', 330, 'TMII -> Makasar, per FDTJ totem'],
  ['KCI-JUA', 'TJ-H00092P', 150, 'Juanda']
]

interface Row { [k: string]: string | number | null }

function d1(sql: string): Row[] {
  const args = ['wrangler', 'd1', 'execute', DB_NAME, LOCAL ? '--local' : '--remote', '--json', '--command', sql]
  const out = execFileSync('npx', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
  // wrangler prints a JSON array of result objects; grab the first result set.
  const json = JSON.parse(out.slice(out.indexOf('[')))
  return json[0]?.results ?? []
}

interface Coord { lat: number, lng: number }
const esc = (s: string): string => s.replace(/'/g, '\'\'')

// ── load TJ stations (name -> ids, id -> coord) ──────────────────────────────
const tjStations = d1(`SELECT id, name, latitude, longitude FROM stations WHERE operator = 'TJ';`)
const tjByName = new Map<string, string[]>()
const tjCoord = new Map<string, Coord>()
for (const s of tjStations) {
  const id = String(s.id)
  const name = String(s.name)
  if (!tjByName.has(name)) tjByName.set(name, [])
  tjByName.get(name)!.push(id)
  if (s.latitude != null && s.longitude != null) {
    tjCoord.set(id, { lat: Number(s.latitude), lng: Number(s.longitude) })
  }
}

// ── load rail origin coords (for proximity fallback) ─────────────────────────
const railStations = d1(`SELECT id, latitude, longitude FROM stations WHERE operator <> 'TJ';`)
const railCoord = new Map<string, Coord>()
for (const s of railStations) {
  if (s.latitude != null && s.longitude != null) {
    railCoord.set(String(s.id), { lat: Number(s.latitude), lng: Number(s.longitude) })
  }
}

// Rail->TJ candidates: still-EXTERNAL rows (resolve by name/proximity) plus any
// already-INTERNAL rows we previously converted (id marker `XTJ`), so re-running
// reconciles distances idempotently instead of silently skipping them.
const externals = d1(
  `SELECT id, fromStationId, toStationId, toStationData, dataType FROM transfers`
  + ` WHERE (dataType = 'EXTERNAL' AND toStationData LIKE '%${TJ_OPERATOR_NAME}%')`
  + ` OR (dataType = 'INTERNAL' AND id LIKE '%XTJ%');`
)

function nearestTJ(origin: Coord): { id: string, m: number } | null {
  let best: { id: string, m: number } | null = null
  for (const [id, c] of tjCoord) {
    const m = haversineMeters(origin.lat, origin.lng, c.lat, c.lng)
    if (!best || m < best.m) best = { id, m: Math.round(m) }
  }
  return best
}

const statements: string[] = []
const resolvedLog: string[] = []
const skippedLog: string[] = []

const tjNameById = new Map(tjStations.map(s => [String(s.id), String(s.name)]))

for (const row of externals) {
  const transferId = String(row.id)
  const fromId = String(row.fromStationId)

  // The TJ station name to match on: from the EXTERNAL JSON blob, or (for rows a
  // prior run already converted) the current INTERNAL target's station name.
  let matchName: string
  if (row.dataType === 'EXTERNAL') {
    const data = JSON.parse(String(row.toStationData)) as { name: string, operatorName: string }
    if (data.operatorName !== TJ_OPERATOR_NAME) continue // e.g. KCIC — leave alone
    matchName = data.name
  } else {
    matchName = tjNameById.get(String(row.toStationId)) ?? ''
  }

  // 1) exact, unambiguous name match
  const exact = tjByName.get(matchName)
  let targetId: string | null = null
  let how = ''
  let dist: number | null = null

  if (exact && exact.length === 1) {
    targetId = exact[0]!
    // Name matches keep the hand-measured walk distance (measured along the real
    // path, which a centroid haversine can't match). Use the authoritative
    // measured value when we have one; otherwise leave the stored column as-is
    // (dist = null -> the UPDATE won't touch `distance`).
    const measured = MEASURED_DISTANCE_M[transferId]
    dist = measured ?? null
    how = measured != null ? `name (measured ${measured}m)` : 'name (kept stored dist)'
  } else {
    // 2) proximity to the rail origin
    const origin = railCoord.get(fromId)
    if (origin) {
      const near = nearestTJ(origin)
      if (near && near.m <= MAX_MATCH_M) {
        targetId = near.id
        how = `proximity(${near.m}m)`
        dist = near.m
      }
    }
  }

  if (!targetId) {
    skippedLog.push(`  ${transferId}  ${fromId} -> "${matchName}" (no match within ${MAX_MATCH_M}m)`)
    continue
  }

  const distSql = dist == null ? 'distance' : String(dist)
  statements.push(
    `UPDATE transfers SET dataType = 'INTERNAL', toStationId = '${esc(targetId)}', toStationData = NULL, distance = ${distSql}, updatedAt = CURRENT_TIMESTAMP WHERE id = '${esc(transferId)}';`
  )
  const tjName = String(tjStations.find(s => String(s.id) === targetId)?.name ?? '')
  resolvedLog.push(`  ${transferId}  ${fromId} -> ${targetId} (${tjName}) via ${how}`)
}

/*
 * Interchange walks, appended after the EXTERNAL -> INTERNAL conversions above.
 * Both directions per pair, and only where the row already exists — a missing
 * row means the topology changed and should be noticed, not silently created.
 */
let walkUpdates = 0
for (const [a, b, metres, note] of INTERCHANGE_WALK_M) {
  for (const [from, to] of [[a, b], [b, a]]) {
    statements.push(
      `UPDATE transfers SET distance = ${metres}, updatedAt = CURRENT_TIMESTAMP `
      + `WHERE dataType = 'INTERNAL' AND fromStationId = '${esc(from!)}' AND toStationId = '${esc(to!)}';`
    )
    walkUpdates++
  }
  void note
}

fs.writeFileSync(OUTPUT_SQL_PATH, statements.join('\n') + (statements.length ? '\n' : ''))

console.log(`Resolved ${resolvedLog.length} EXTERNAL -> INTERNAL transfer(s):`)
for (const l of resolvedLog) console.log(l)
if (skippedLog.length) {
  console.log(`\nLeft EXTERNAL (${skippedLog.length}) — review:`)
  for (const l of skippedLog) console.log(l)
}
console.log(`\nInterchange walks: ${walkUpdates} UPDATE(s) from ${INTERCHANGE_WALK_M.length} measured pairs.`)
console.log(`\nWrote ${statements.length} UPDATE(s) to "${OUTPUT_SQL_PATH}".`)
