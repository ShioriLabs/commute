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

// ── all directional half-sequences per corridor ──────────────────────────────
// TransJakarta trips are out-and-back and often SHORT-TURNS: no single trip
// necessarily spans the full corridor (Koridor 1's longest trip only reaches
// Taman Sari, not Kota). So instead of "longest trip → its outbound half" we
// split EVERY trip into its maximal no-repeat runs ("halves") and keep the
// longest run per travel direction — which reconstructs the full corridor even
// when it only appears across several short-turn trips.
const halvesByCode = new Map<string, Row[][]>()
for (const [tripId, list] of patterns) {
  const routeId = tripRoute.get(tripId)
  if (!routeId) continue
  const code = routeShortById.get(routeId)!
  const bucket = halvesByCode.get(code) ?? []
  for (const half of splitHalves(list)) if (half.length > 1) bucket.push(half)
  halvesByCode.set(code, bucket)
}

// Cut a round-trip stop list into maximal runs with no repeated stop; each run
// is one travel direction (a repeat marks the turnaround into the return leg).
function splitHalves(list: Row[]): Row[][] {
  const out: Row[][] = []
  let seen = new Set<string>()
  let cur: Row[] = []
  for (const r of list) {
    if (seen.has(r.stop)) {
      out.push(cur)
      cur = []
      seen = new Set<string>()
    }
    seen.add(r.stop)
    cur.push(r)
  }
  if (cur.length) out.push(cur)
  return out
}

// Count adjacent (a→b) stop pairs of `half` that appear, in the same order, as
// adjacent pairs of `ref`. Used to decide whether `half` runs the SAME direction
// as `ref` (score high) or the OPPOSITE direction (score low; its reverse scores
// high instead).
function adjacencyOverlap(half: Row[], ref: Row[]): number {
  const refPairs = new Set<string>()
  for (let i = 1; i < ref.length; i++) refPairs.add(`${ref[i - 1]!.stop}>${ref[i]!.stop}`)
  let n = 0
  for (let i = 1; i < half.length; i++) if (refPairs.has(`${half[i - 1]!.stop}>${half[i]!.stop}`)) n++
  return n
}

// The longest half running the OPPOSITE direction to `ref`: among halves whose
// reverse aligns with `ref` better than their forward orientation does, the
// longest. Empty when the corridor only ever runs one direction in the feed.
function longestOpposite(halves: Row[][], ref: Row[]): Row[] {
  let best: Row[] = []
  for (const h of halves) {
    const forward = adjacencyOverlap(h, ref)
    const reverse = adjacencyOverlap([...h].reverse(), ref)
    if (reverse > forward && h.length > best.length) best = h
  }
  return best
}

// True when the reverse direction serves a different ordered stop set than the
// mirror of `path` — i.e. a genuinely asymmetric corridor (Koridor 1: Kejagung
// path-only; ASEAN/Kali Besar/Museum Sejarah pathReverse-only).
function isAsymmetric(path: Row[], reverse: Row[]): boolean {
  if (reverse.length === 0) return false
  const mirror = path.map(r => r.stop).reverse()
  const back = reverse.map(r => r.stop)
  if (mirror.length !== back.length) return true
  return mirror.some((stop, i) => stop !== back[i])
}

// Render a stop list to `topology.tj.ts` Stop literals, normalising cumM to 0 at
// the leg's origin so generateEdgesSQL emits real per-segment distances.
function renderStops(rows: Row[]): string {
  const base = rows[0]?.dist ?? 0
  return rows.map((r) => {
    const cum = r.dist != null ? Math.round(Math.abs(r.dist - base)) : null
    const cumField = cum != null ? `, cumM: ${cum}` : ''
    return `      { station: '${r.stop}', pos: ''${cumField} }`
  }).join(',\n')
}

// ── hand-authored overrides ──────────────────────────────────────────────────
// Corridors whose real service can't be reconstructed from the GTFS shapes (e.g.
// day/night terminus differences, one-way-only termini). When a lineCode appears
// here its path/pathReverse are emitted VERBATIM instead of the GTFS-derived run,
// so these corrections survive `generate:tj-topology`. cumM is metres from each
// leg's origin (0-based). Keep the reason note current.
interface OverrideStop { station: string, cumM: number }
interface Override { note: string, path: OverrideStop[], pathReverse?: OverrideStop[] }
const HAND_OVERRIDES: Record<string, Override> = {
  // K13 west end is a loop with a day/night split: DAY D'MASIV–CBD Ciledug–Puri
  // Beta 1, NIGHT D'MASIV–Puri Beta 2–Puri Beta 1. Puri Beta 2 (H00190P) is
  // WESTBOUND-only (appears in pathReverse, not path). Eastbound leaves via
  // CBD → Puri Beta 1 → D'MASIV. cumM for the west-loop tail is haversine-based.
  '13': {
    note: 'day/night west-loop; Puri Beta 2 westbound-only; both termini kept',
    path: [
      { station: 'H00031P', cumM: 0 }, { station: 'H00189P', cumM: 3013 }, { station: 'H00001P', cumM: 5585 },
      { station: 'H00091P', cumM: 6402 }, { station: 'H00234P', cumM: 7124 }, { station: 'H00040P', cumM: 7682 },
      { station: 'H00214P', cumM: 8325 }, { station: 'H00101P', cumM: 9096 }, { station: 'H00257P', cumM: 9990 },
      { station: 'H00130P', cumM: 10667 }, { station: 'H00041P', cumM: 11631 }, { station: 'H00249P', cumM: 12673 },
      { station: 'H00192P', cumM: 13608 }, { station: 'H00246P', cumM: 15451 }
    ],
    pathReverse: [
      { station: 'H00246P', cumM: 0 }, { station: 'H00192P', cumM: 1676 }, { station: 'H00249P', cumM: 2619 },
      { station: 'H00041P', cumM: 3664 }, { station: 'H00130P', cumM: 4619 }, { station: 'H00257P', cumM: 5292 },
      { station: 'H00101P', cumM: 6192 }, { station: 'H00214P', cumM: 6965 }, { station: 'H00040P', cumM: 7607 },
      { station: 'H00234P', cumM: 8158 }, { station: 'H00091P', cumM: 8865 }, { station: 'H00001P', cumM: 9692 },
      { station: 'H00190P', cumM: 12578 }, { station: 'H00031P', cumM: 14372 }, { station: 'H00189P', cumM: 17385 }
    ]
  },
  // K13B terminus is Pancoran Arah Timur (H00198S); the return loops via Pancoran
  // Arah Barat (H00203S) + Tegal Mampang (H00246P). Eastbound ends at the terminus.
  '13B': {
    note: 'terminus Pancoran Arah Timur; return via Pancoran Arah Barat + Tegal Mampang',
    path: [
      { station: 'H00190P', cumM: 0 }, { station: 'H00189P', cumM: 433 }, { station: 'H00001P', cumM: 3007 },
      { station: 'H00091P', cumM: 3825 }, { station: 'H00234P', cumM: 4547 }, { station: 'H00040P', cumM: 5107 },
      { station: 'H00214P', cumM: 5753 }, { station: 'H00101P', cumM: 6528 }, { station: 'H00257P', cumM: 7433 },
      { station: 'H00130P', cumM: 8101 }, { station: 'H00041P', cumM: 9062 }, { station: 'H00249P', cumM: 10109 },
      { station: 'H00192P', cumM: 11047 }, { station: 'H00198S', cumM: 13513 }
    ],
    pathReverse: [
      { station: 'H00198S', cumM: 0 }, { station: 'H00203S', cumM: 1288 }, { station: 'H00246P', cumM: 2029 },
      { station: 'H00192P', cumM: 3718 }, { station: 'H00249P', cumM: 4659 }, { station: 'H00041P', cumM: 5704 },
      { station: 'H00130P', cumM: 6664 }, { station: 'H00257P', cumM: 7337 }, { station: 'H00101P', cumM: 8243 },
      { station: 'H00214P', cumM: 9016 }, { station: 'H00040P', cumM: 9655 }, { station: 'H00234P', cumM: 10183 },
      { station: 'H00091P', cumM: 10891 }, { station: 'H00001P', cumM: 11680 }, { station: 'H00190P', cumM: 14566 }
    ]
  }
}

// Render hand-override stops (already 0-based cumM) to Stop literals.
function renderOverrideStops(stops: OverrideStop[]): string {
  return stops.map(s => `      { station: '${s.station}', pos: '', cumM: ${s.cumM} }`).join(',\n')
}

// ── emit topology.tj.ts ──────────────────────────────────────────────────────
// H… id is the DB station code (no TJ- prefix).
const entries: string[] = []
const summary: { code: string, stops: number, asymmetric: boolean, override?: boolean }[] = []
const missing: string[] = []

for (const code of BRT_CODES) {
  const override = HAND_OVERRIDES[code]
  if (override) {
    // Emit the hand-authored shape verbatim (see HAND_OVERRIDES note above).
    let body = `    // HAND-OVERRIDE: ${override.note}\n    path: [\n${renderOverrideStops(override.path)}\n    ]`
    if (override.pathReverse) body += `,\n    pathReverse: [\n${renderOverrideStops(override.pathReverse)}\n    ]`
    entries.push(`  {\n    operator: '${OPERATOR}',\n    lineCode: '${code.replace(/'/g, '\\\'')}',\n${body}\n  }`)
    summary.push({ code, stops: override.path.length, asymmetric: !!override.pathReverse, override: true })
    continue
  }

  const halves = halvesByCode.get(code)
  if (!halves || halves.length === 0) {
    missing.push(code)
    continue
  }
  // path = the longest half in either direction; pathReverse = the longest half
  // running the opposite direction (reconstructs the full corridor across the
  // feed's short-turn trips).
  const path = halves.reduce((a, b) => (b.length > a.length ? b : a), halves[0]!)
  const reverse = longestOpposite(halves, path)
  const asymmetric = isAsymmetric(path, reverse)

  let body = `    path: [\n${renderStops(path)}\n    ]`
  if (asymmetric) {
    // Reverse direction serves a different stop set — keep it verbatim so the
    // edge generator emits directed edges per true direction (no mirroring).
    body += `,\n    pathReverse: [\n${renderStops(reverse)}\n    ]`
  }
  entries.push(
    `  {\n    operator: '${OPERATOR}',\n    lineCode: '${code.replace(/'/g, '\\\'')}',\n${body}\n  }`
  )
  summary.push({ code, stops: path.length, asymmetric })
}

const fileTS
  = `import type { LineTopology } from './topology'\n\n`
    + `/*\n`
    + ` * TransJakarta BRT corridor topology — generated by\n`
    + ` * db/scripts/generateTJTopology.ts from the GTFS feed's BRT routes.\n`
    + ` * Each path is the longest one-directional run across ALL of the corridor's\n`
    + ` * trips (feed trips are out-and-back and often short-turns, so no single trip\n`
    + ` * need span the whole corridor). \`pos\` is empty (TJ has no official per-line\n`
    + ` * codes); \`cumM\` is metres from the line origin (shape_dist_traveled) so\n`
    + ` * generateEdgesSQL emits real distances. Merged into TOPOLOGY by topology.ts.\n`
    + ` * Corridors whose return direction is NOT the mirror of \`path\` also carry a\n`
    + ` * \`pathReverse\` (the longest opposite-direction run) — e.g. Koridor 1, where\n`
    + ` * Kejagung is served Blok M-bound only and ASEAN/Kali Besar/Museum Sejarah\n`
    + ` * Kota-bound only. generateEdgesSQL emits directed edges per direction there.\n`
    + ` * Do not edit by hand; re-run \`pnpm --filter api generate:tj-topology\`.\n`
    + ` * A few corridors (marked HAND-OVERRIDE — e.g. 13, 13B) come from the\n`
    + ` * HAND_OVERRIDES map in the generator, not the feed: their real service\n`
    + ` * (day/night termini, one-way termini) can't be reconstructed from the GTFS\n`
    + ` * shapes. Correct those in generateTJTopology.ts, not here.\n`
    + ` * NOTE: corridor L7 is in the official BRT poster but absent from this GTFS\n`
    + ` * dataset, so it is not represented here.\n`
  + ` */\n`
  + `export const TJ_TOPOLOGY: LineTopology[] = [\n`
  + entries.join(',\n') + '\n]\n'

fs.writeFileSync(OUT_PATH, fileTS)

// ── summary ──────────────────────────────────────────────────────────────────
console.log('TransJakarta BRT topology — generated topology.tj.ts:')
console.log(`  lines emitted: ${summary.length}`)
for (const s of summary) console.log(`    ${s.code.padEnd(5)} ${s.stops} stops${s.asymmetric ? '  (asymmetric — pathReverse emitted)' : ''}${s.override ? '  [HAND-OVERRIDE]' : ''}`)
const asymCodes = summary.filter(s => s.asymmetric).map(s => s.code)
console.log(`  asymmetric corridors (pathReverse): ${asymCodes.length ? asymCodes.join(', ') : 'none'}`)
const overrideCodes = summary.filter(s => s.override).map(s => s.code)
console.log(`  hand-overrides: ${overrideCodes.length ? overrideCodes.join(', ') : 'none'}`)
if (missing.length) console.log(`  MISSING from feed (not emitted): ${missing.join(', ')}`)
