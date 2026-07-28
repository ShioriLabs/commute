import * as fs from 'node:fs'
import { haversineMeters } from '../../utils/geo'

/*
 * TransJakarta GTFS importer. Reads the static feed (extracted under
 * `file_gtfs/`) and emits SQL seeds for the `stations`, `stationLines`, `edges`,
 * and `transfers` tables, plus overwrites `operators/tj/lines.ts` with the
 * corridor `Line` entries. Scope = BRT + Angkutan Umum Integrasi only. Trip-
 * pattern based (no schedules). See docs/tj-gtfs-import.md.
 *
 * Re-run after refreshing the feed:
 *   pnpm --filter api generate:tj
 * Then apply the four .sql files (stations -> stationLines -> edges ->
 * transfers) with `wrangler d1 execute commute --local --file=...`.
 */

const FEED_DIR = `${__dirname}/file_gtfs`
const SCRIPTS_DIR = __dirname
const LINES_TS_PATH = `${__dirname}/../../operators/tj/lines.ts`

const OPERATOR = 'TJ'
const REGION = 'Jabodetabek'
const REGION_CODE = 'CGK'
const SCOPE_DESC = new Set(['BRT', 'Angkutan Umum Integrasi'])

// ── minimal CSV parser (feed has quoted fields with embedded commas) ─────────
function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      record.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      record.push(field)
      field = ''
      if (record.length > 1 || record[0] !== '') rows.push(record)
      record = []
    } else field += ch
  }
  if (field !== '' || record.length > 0) {
    record.push(field)
    rows.push(record)
  }

  const header = rows.shift()
  if (!header) return []
  return rows.map((r) => {
    const obj: Record<string, string> = {}
    header.forEach((h, i) => {
      obj[h] = r[i] ?? ''
    })
    return obj
  })
}

function load(file: string): Record<string, string>[] {
  return parseCSV(fs.readFileSync(`${FEED_DIR}/${file}`, 'utf-8'))
}

const esc = (s: string): string => s.replace(/'/g, '\'\'')
const stationId = (collapsedStopId: string): string => `${OPERATOR}-${collapsedStopId}`

// ── load feed ───────────────────────────────────────────────────────────────
const routes = load('routes.txt')
const trips = load('trips.txt')
const stops = load('stops.txt')
const transfers = load('transfers.txt')

// ── scope: routes + trips ────────────────────────────────────────────────────
const scopeRoutes = routes.filter(r => SCOPE_DESC.has(r.route_desc))
const scopeRouteIds = new Set(scopeRoutes.map(r => r.route_id))
const scopeTrips = trips.filter(t => scopeRouteIds.has(t.route_id))
const scopeTripIds = new Set(scopeTrips.map(t => t.trip_id))
const tripRoute = new Map(scopeTrips.map(t => [t.trip_id, t.route_id]))

// ── stop catalog + parent collapse ──────────────────────────────────────────
const stopById = new Map(stops.map(s => [s.stop_id, s]))
function collapse(id: string): string {
  const s = stopById.get(id)
  return (s && s.parent_station) ? s.parent_station : id
}

// ── build per-trip ordered, collapsed stop sequences from stop_times ─────────
interface StopTimeRow { seq: number, stop: string, dist: number | null }
const patterns = new Map<string, StopTimeRow[]>()
{
  const stopTimes = load('stop_times.txt')
  for (const row of stopTimes) {
    if (!scopeTripIds.has(row.trip_id)) continue
    const distRaw = row.shape_dist_traveled
    const list = patterns.get(row.trip_id) ?? []
    list.push({
      seq: Number(row.stop_sequence),
      stop: collapse(row.stop_id),
      dist: distRaw === '' ? null : Number(distRaw)
    })
    patterns.set(row.trip_id, list)
  }
  for (const list of patterns.values()) list.sort((a, b) => a.seq - b.seq)
}

// ── station rows (collapsed stops referenced by scope trips) ─────────────────
const referenced = new Set<string>()
for (const list of patterns.values()) for (const r of list) referenced.add(r.stop)

// Collapsed stops served by a BRT (koridor) route. Only these are searchable for
// now: the Angkutan Umum Integrasi feeders route but have no topology, so we hide
// their feeder-only haltes from search until they're properly modelled. A halte
// shared with a BRT corridor stays searchable.
// TODO: re-enable the non-BRT services (Angkutan Umum Integrasi / Mikrotrans /
// Royaltrans) later — needs per-line topology first (extend generateTJTopology
// beyond BRT_CODES), then widen this gate; everything downstream (API list
// filter, search surfaces, sitemap) keys off `searchable` and follows for free.
const brtRouteIds = new Set(routes.filter(r => r.route_desc === 'BRT').map(r => r.route_id))
const brtServed = new Set<string>()
for (const [tripId, list] of patterns) {
  const routeId = tripRoute.get(tripId)
  if (!routeId || !brtRouteIds.has(routeId)) continue
  for (const r of list) brtServed.add(r.stop)
}

// Drop temp-stop cruft (no H/B/G/P prefix convention).
const stationStops = [...referenced].filter(id => id.startsWith('H') || id.startsWith('B'))
stationStops.sort()

// One INSERT statement per row — D1's `wrangler d1 execute` rejects a single
// multi-thousand-row VALUES list (SQLITE_TOOBIG). Matches generateEdgesSQL.ts.
const STATIONS_COLS = 'id, name, code, formattedName, region, regionCode, operator, timetableSynced, searchable, latitude, longitude, createdAt, updatedAt'
const stationRows: string[] = []
let searchableCount = 0
let hiddenCount = 0
for (const collapsedId of stationStops) {
  const s = stopById.get(collapsedId)
  if (!s) continue
  const isHalte = collapsedId.startsWith('H') || s.location_type === '1'
  // Searchable only if it's a halte AND served by a BRT corridor. Feeder-only
  // haltes are hidden for now (no topology yet); see brtServed above.
  const searchable = isHalte && brtServed.has(collapsedId) ? 1 : 0
  if (searchable) {
    searchableCount++
  } else {
    hiddenCount++
  }
  const name = esc(s.stop_name)
  stationRows.push(
    `INSERT OR REPLACE INTO stations (${STATIONS_COLS}) VALUES `
    + `('${stationId(collapsedId)}', '${name}', '${esc(collapsedId)}', '${name}', '${REGION}', '${REGION_CODE}', '${OPERATOR}', FALSE, ${searchable}, ${s.stop_lat}, ${s.stop_lon}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`
  )
}
fs.writeFileSync(`${SCRIPTS_DIR}/tj_stations_insert.sql`, stationRows.join('\n') + '\n')

// ── lines.ts (100 corridor lines) ────────────────────────────────────────────
const lineEntries = scopeRoutes
  .slice()
  .sort((a, b) => a.route_short_name.localeCompare(b.route_short_name))
  .map((r) => {
    const name = r.route_long_name.replace(/'/g, '\\\'')
    return `  { name: '${name}', lineCode: '${r.route_short_name.replace(/'/g, '\\\'')}', colorCode: '#${r.route_color}' }`
  })

const linesTS
  = `import { Line } from 'models/line'\n\n`
    + `/*\n`
    + ` * TransJakarta corridor lines — generated by db/scripts/generateTJSQL.ts from\n`
    + ` * the GTFS feed's BRT + Angkutan Umum Integrasi routes (lineCode =\n`
    + ` * route_short_name, name = route_long_name, colorCode = route_color).\n`
    + ` * Do not edit by hand; re-run \`pnpm --filter api generate:tj\`.\n`
    + ` */\n`
    + `export const LINES: readonly Line[] = [\n`
    + lineEntries.join(',\n') + '\n] as const\n'
fs.writeFileSync(LINES_TS_PATH, linesTS)

// ── stationLines (dedup station×line across trip variants) ───────────────────
const stationLineKeys = new Set<string>()
const stationLineRows: string[] = []
for (const [tripId, list] of patterns) {
  const lineCode = tripRoute.get(tripId)
  if (!lineCode) continue
  for (const r of list) {
    if (!(r.stop.startsWith('H') || r.stop.startsWith('B'))) continue
    const sid = stationId(r.stop)
    const key = `${sid}::${lineCode}`
    if (stationLineKeys.has(key)) continue
    stationLineKeys.add(key)
    stationLineRows.push(
      `INSERT OR IGNORE INTO stationLines (id, stationId, lineCode, stationNumber, createdAt, updatedAt) VALUES `
      + `('${sid}-${esc(lineCode)}', '${sid}', '${esc(lineCode)}', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`
    )
  }
}
fs.writeFileSync(`${SCRIPTS_DIR}/tj_stationlines_insert.sql`, stationLineRows.join('\n') + '\n')

// ── edges (directed both ways; distance from shape_dist_traveled diffs) ───────
// De-dup identical (lineCode, from, to) across trip variants, keeping the
// smallest distance. Fall back to haversine when a diff is unavailable.
const coord = (collapsedId: string): { lat: number, lng: number } | null => {
  const s = stopById.get(collapsedId)
  if (!s || !s.stop_lat || !s.stop_lon) return null
  return { lat: Number(s.stop_lat), lng: Number(s.stop_lon) }
}
const edgeDist = new Map<string, { lineCode: string, from: string, to: string, m: number }>()
let haversineFallbacks = 0
for (const [tripId, list] of patterns) {
  const lineCode = tripRoute.get(tripId)
  if (!lineCode) continue
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1]
    const b = list[i]
    if (!a || !b || a.stop === b.stop) continue
    if (!(a.stop.startsWith('H') || a.stop.startsWith('B'))) continue
    if (!(b.stop.startsWith('H') || b.stop.startsWith('B'))) continue
    let m: number
    if (a.dist != null && b.dist != null) {
      m = Math.round(Math.abs(b.dist - a.dist))
    } else {
      const ca = coord(a.stop)
      const cb = coord(b.stop)
      m = ca && cb ? Math.round(haversineMeters(ca.lat, ca.lng, cb.lat, cb.lng)) : 0
      haversineFallbacks++
    }
    const from = stationId(a.stop)
    const to = stationId(b.stop)
    const key = `${lineCode}:${from}->${to}`
    const existing = edgeDist.get(key)
    if (!existing || m < existing.m) edgeDist.set(key, { lineCode, from, to, m })
  }
}
const edgeRows: string[] = []
for (const [key, e] of edgeDist) {
  edgeRows.push(
    `INSERT OR REPLACE INTO edges (id, lineCode, fromStationId, toStationId, distance, createdAt, updatedAt)`
    + ` VALUES ('${key}', '${esc(e.lineCode)}', '${e.from}', '${e.to}', ${e.m}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`
  )
}
fs.writeFileSync(`${SCRIPTS_DIR}/tj_edges_insert.sql`, edgeRows.join('\n') + '\n')

// ── transfers (feed-provided H<->H pairs, INTERNAL) ──────────────────────────
const transferRows: string[] = []
const seenTransfer = new Set<string>()
for (const t of transfers) {
  const fromCollapsed = collapse(t.from_stop_id)
  const toCollapsed = collapse(t.to_stop_id)
  const from = stationId(fromCollapsed)
  const to = stationId(toCollapsed)
  if (!referenced.has(fromCollapsed) || !referenced.has(toCollapsed)) continue
  const id = `${from}->${to}`
  if (seenTransfer.has(id)) continue
  seenTransfer.add(id)
  const ca = coord(fromCollapsed)
  const cb = coord(toCollapsed)
  const m = ca && cb ? Math.round(haversineMeters(ca.lat, ca.lng, cb.lat, cb.lng)) : 0
  transferRows.push(
    `INSERT OR REPLACE INTO transfers (id, dataType, fromStationId, toStationId, toStationData, distance, notes, createdAt, updatedAt)`
    + ` VALUES ('${id}', 'INTERNAL', '${from}', '${to}', NULL, ${m}, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`
  )
}
fs.writeFileSync(`${SCRIPTS_DIR}/tj_transfers_insert.sql`, transferRows.join('\n') + '\n')

// ── summary ──────────────────────────────────────────────────────────────────
console.log('TransJakarta GTFS import — generated SQL seeds:')
console.log(`  stations:     ${stationRows.length} (${searchableCount} searchable haltes, ${hiddenCount} hidden roadside)`)
console.log(`  lines.ts:     ${lineEntries.length} corridor lines`)
console.log(`  stationLines: ${stationLineRows.length}`)
console.log(`  edges:        ${edgeRows.length} (${haversineFallbacks} haversine fallbacks)`)
console.log(`  transfers:    ${transferRows.length}`)
