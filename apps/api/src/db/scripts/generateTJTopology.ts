import * as fs from 'node:fs'

/*
 * TransJakarta BRT topology generator. Reads the static GTFS feed (extracted
 * under `file_gtfs/`) and emits `db/data/topology.tj.ts` — the `TJ_TOPOLOGY`
 * array that `topology.ts` merges into `TOPOLOGY`, giving TJ BRT corridors the
 * same per-line path structure as rail. That structure drives edge generation
 * (generateEdgesSQL.ts) and the interlining merge (utils/interlining.ts) so a
 * one-seat ride (e.g. 13E Puri Beta 2 -> Karet Kuningan) renders as one leg
 * rather than fragmenting across sibling corridor codes.
 *
 * Scope: BRT corridors only (the "koridor utama" trunk routes), not the
 * Angkutan Umum Integrasi feeders. The BRT_CODES list below is the authoritative
 * set from TransJakarta's official BRT corridor poster.
 *
 * Path reconstruction: TransJakarta models each trip as a full out-and-back
 * round trip (Blok M -> ... -> Blok M). We take the LONGEST trip per line and
 * keep its OUTBOUND half — the sequence up to the first repeated stop — which is
 * the clean one-way corridor. `cumM` comes from shape_dist_traveled so
 * generateEdgesSQL emits real track distances (not haversine).
 *
 * Re-run: pnpm --filter api generate:tj-topology  (then generate:edges)
 */

const FEED_DIR = `${__dirname}/file_gtfs`
const OUT_PATH = `${__dirname}/../data/topology.tj.ts`

const OPERATOR = 'TJ'

// Authoritative BRT corridor set (TransJakarta BRT poster). L7 is intentionally
// absent: it is in the poster but NOT in this GTFS dataset, so it cannot be
// authored here — add it when the feed includes it.
const BRT_CODES = [
  '1', '2', '2A', '3', '3F', '3H', '4', '4D', '5', '5C', '6', '6A', '6B', '6V',
  '7', '7F', '8', '9', '9A', '9C', '9N', '10', '10D', '10H', '11', '12', '13',
  '13B', '13E', 'L13E', '14'
]

// ── minimal CSV parser (matches generateTJSQL.ts) ────────────────────────────
function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      record.push(field); field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      record.push(field); field = ''
      if (record.length > 1 || record[0] !== '') rows.push(record)
      record = []
    } else field += ch
  }
  if (field !== '' || record.length > 0) { record.push(field); rows.push(record) }
  const header = rows.shift()
  if (!header) return []
  return rows.map((r) => {
    const obj: Record<string, string> = {}
    header.forEach((h, i) => { obj[h] = r[i] ?? '' })
    return obj
  })
}

const load = (file: string): Record<string, string>[] =>
  parseCSV(fs.readFileSync(`${FEED_DIR}/${file}`, 'utf-8'))

// ── load + scope to BRT routes in BRT_CODES ──────────────────────────────────
const routes = load('routes.txt')
const trips = load('trips.txt')
const stops = load('stops.txt')

const codeSet = new Set(BRT_CODES)
const scopeRoutes = routes.filter(r => r.route_desc === 'BRT' && codeSet.has(r.route_short_name))
const routeShortById = new Map(scopeRoutes.map(r => [r.route_id, r.route_short_name]))
const scopeRouteIds = new Set(scopeRoutes.map(r => r.route_id))
const scopeTrips = trips.filter(t => scopeRouteIds.has(t.route_id))
const tripRoute = new Map(scopeTrips.map(t => [t.trip_id, t.route_id]))
const scopeTripIds = new Set(scopeTrips.map(t => t.trip_id))

const stopById = new Map(stops.map(s => [s.stop_id, s]))
const collapse = (id: string): string => {
  const s = stopById.get(id)
  return (s && s.parent_station) ? s.parent_station : id
}

// ── per-trip ordered, collapsed halte sequences (haltes = H…) ────────────────
interface Row { seq: number, stop: string, dist: number | null }
const patterns = new Map<string, Row[]>()
{
  const stopTimes = load('stop_times.txt')
  for (const row of stopTimes) {
    if (!scopeTripIds.has(row.trip_id)) continue
    const stop = collapse(row.stop_id)
    if (!stop.startsWith('H')) continue // BRT haltes only
    const list = patterns.get(row.trip_id) ?? []
    list.push({
      seq: Number(row.stop_sequence),
      stop,
      dist: row.shape_dist_traveled === '' ? null : Number(row.shape_dist_traveled)
    })
    patterns.set(row.trip_id, list)
  }
  for (const list of patterns.values()) list.sort((a, b) => a.seq - b.seq)
}

// ── longest trip per line, then its outbound half (up to first repeat) ────────
const longestByCode = new Map<string, Row[]>()
for (const [tripId, list] of patterns) {
  const routeId = tripRoute.get(tripId)
  if (!routeId) continue
  const code = routeShortById.get(routeId)!
  const prev = longestByCode.get(code)
  if (!prev || list.length > prev.length) longestByCode.set(code, list)
}

function outboundHalf(list: Row[]): Row[] {
  const seen = new Set<string>()
  const out: Row[] = []
  for (const r of list) {
    if (seen.has(r.stop)) break // return leg begins — stop
    seen.add(r.stop)
    out.push(r)
  }
  return out
}

// ── emit topology.tj.ts ──────────────────────────────────────────────────────
const stationCode = (collapsedId: string): string => collapsedId // H… id is the DB code (no TJ- prefix)
const entries: string[] = []
const summary: { code: string, stops: number }[] = []
const missing: string[] = []

for (const code of BRT_CODES) {
  const longest = longestByCode.get(code)
  if (!longest || longest.length === 0) { missing.push(code); continue }
  const path = outboundHalf(longest)
  // cumM: shape_dist_traveled where present; normalise to start at 0 for readability.
  const base = path[0]?.dist ?? 0
  const stopsTS = path.map((r) => {
    const cum = r.dist != null ? Math.round(Math.abs(r.dist - base)) : null
    const cumField = cum != null ? `, cumM: ${cum}` : ''
    return `      { station: '${stationCode(r.stop)}', pos: ''${cumField} }`
  })
  entries.push(
    `  {\n    operator: '${OPERATOR}',\n    lineCode: '${code.replace(/'/g, '\\\'')}',\n    path: [\n${stopsTS.join(',\n')}\n    ]\n  }`
  )
  summary.push({ code, stops: path.length })
}

const fileTS
  = `import type { LineTopology } from './topology'\n\n`
    + `/*\n`
    + ` * TransJakarta BRT corridor topology — generated by\n`
    + ` * db/scripts/generateTJTopology.ts from the GTFS feed's BRT routes.\n`
    + ` * Each path is the longest trip's outbound half (out-and-back round trips in\n`
    + ` * the feed are cut at the turnaround). \`pos\` is empty (TJ has no official\n`
    + ` * per-line codes); \`cumM\` is metres from the line origin (shape_dist_traveled)\n`
    + ` * so generateEdgesSQL emits real distances. Merged into TOPOLOGY by topology.ts.\n`
    + ` * Do not edit by hand; re-run \`pnpm --filter api generate:tj-topology\`.\n`
    + ` * NOTE: corridor L7 is in the official BRT poster but absent from this GTFS\n`
    + ` * dataset, so it is not represented here.\n`
  + ` */\n`
  + `export const TJ_TOPOLOGY: LineTopology[] = [\n`
  + entries.join(',\n') + '\n]\n'

fs.writeFileSync(OUT_PATH, fileTS)

// ── summary ──────────────────────────────────────────────────────────────────
console.log('TransJakarta BRT topology — generated topology.tj.ts:')
console.log(`  lines emitted: ${summary.length}`)
for (const s of summary) console.log(`    ${s.code.padEnd(5)} ${s.stops} stops`)
if (missing.length) console.log(`  MISSING from feed (not emitted): ${missing.join(', ')}`)
