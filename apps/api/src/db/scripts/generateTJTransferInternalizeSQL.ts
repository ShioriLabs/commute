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

fs.writeFileSync(OUTPUT_SQL_PATH, statements.join('\n') + (statements.length ? '\n' : ''))

console.log(`Resolved ${resolvedLog.length} EXTERNAL -> INTERNAL transfer(s):`)
for (const l of resolvedLog) console.log(l)
if (skippedLog.length) {
  console.log(`\nLeft EXTERNAL (${skippedLog.length}) — review:`)
  for (const l of skippedLog) console.log(l)
}
console.log(`\nWrote ${statements.length} UPDATE(s) to "${OUTPUT_SQL_PATH}".`)
