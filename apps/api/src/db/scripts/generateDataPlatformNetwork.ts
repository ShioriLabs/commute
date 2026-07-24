/*
 * build-network.ts — one-off generator for the hero's baked rail topology.
 *
 * Joins the api app's source-of-truth data into a single committed constant
 * (`src/network.ts`) that the homepage renders at runtime with ZERO queries.
 *
 * Sources (all read-only, under ../../api/src):
 *   - db/data/topology.ts          ordered stops per line (+ Bogor fork, Cikarang loop)
 *   - operators/{op}/lines.ts      per-line hex colorCode + name
 *   - db/scripts/stations_lat_lng.sql   station coords, keyed by `${op}-${code}`
 *   - db/scripts/hubs.sql          cross-operator interchange members
 * Plus a one-off live fetch of https://api.commute.shiorilabs.id/stations/{op}
 * to resolve display names.
 *
 * RUN (from apps/api, so the topology's bare imports resolve via api tsconfig):
 *   npm run generate:dataplatform-network
 *   # or: node_modules/.bin/tsx src/db/scripts/generateDataPlatformNetwork.ts
 *
 * Output apps/data-platform/src/network.ts is committed — re-run only when the
 * rail topology, colors, or coords change. Rail-only: TJ codes excluded by filter.
 *
 * NOTE: this generator lives under apps/api (not apps/data-platform) so tsx
 * resolves TOPOLOGY's transitive workspace imports (@commute/constants, etc.)
 * with the api tsconfig — a data-platform-located entry collapses the named
 * exports through CJS interop and TOPOLOGY comes back undefined.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// The line color/name table is inlined below to mirror
// apps/api/src/operators/{op}/lines.ts without importing each (keeps this
// generator's imports to the single topology source).
import { TOPOLOGY, type LineTopology, type Stop } from '../data/topology'

const __dirname = dirname(fileURLToPath(import.meta.url))
const API_SRC = resolve(__dirname, '../..') // apps/api/src
const OUT = resolve(__dirname, '../../../../data-platform/src/network.ts')

// Fixed dot-lattice the hero snaps stations onto. Baked here (not in the
// renderer) so the diagram is identical at every viewport width — re-snapping
// per-resize made octilinear doglegs drift ("kinks" that moved with width).
const GRID_COLS = 120
const GRID_INSET = 2 // keep stations >= this many cells from the lattice edge

const RAIL_OPERATORS = ['KCI', 'MRTJ', 'LRTJ', 'LRTJBDB'] as const
// 'A' (Soekarno-Hatta airport) deliberately excluded from the hero: it's
// skip-stop (sparse) and its near-black #262262 barely reads on the dark
// ground. All its stops (MRI/SUDB/DU/RW/BPR) still appear via other lines.
const RAIL_LINE_CODES = new Set(['C', 'B', 'R', 'T', 'TP', 'M', 'S', 'BK', 'CB'])
const API_BASE = 'https://api.commute.shiorilabs.id'

// operator:lineCode -> { name, color } — mirrors apps/api/src/operators/*/lines.ts
const LINE_META = new Map<string, { name: string; color: string }>([
  ['KCI:C', { name: 'Lin Cikarang', color: '#25B8EB' }],
  ['KCI:B', { name: 'Lin Bogor', color: '#EE3D43' }],
  ['KCI:R', { name: 'Lin Rangkasbitung', color: '#96C83E' }],
  ['KCI:T', { name: 'Lin Tangerang', color: '#C15F28' }],
  ['KCI:TP', { name: 'Lin Tanjung Priok', color: '#ED4F98' }],
  ['MRTJ:M', { name: 'Lin Utara Selatan', color: '#ca2a51' }],
  ['LRTJ:S', { name: 'Lin Selatan', color: '#F26324' }],
  ['LRTJBDB:BK', { name: 'Lin Bekasi', color: '#006838' }],
  ['LRTJBDB:CB', { name: 'Lin Cibubur', color: '#21409A' }]
])

/** Parse `stations_lat_lng.sql` -> Map<stationId, {lat,lng}>. */
function parseCoords(): Map<string, { lat: number; lng: number }> {
  const sql = readFileSync(resolve(API_SRC, 'db/scripts/stations_lat_lng.sql'), 'utf8')
  const re = /latitude\s*=\s*(-?[\d.]+),\s*longitude\s*=\s*(-?[\d.]+)[^']*id\s*=\s*'([^']+)'/g
  const out = new Map<string, { lat: number; lng: number }>()
  for (const m of sql.matchAll(re)) out.set(m[3]!, { lat: parseFloat(m[1]!), lng: parseFloat(m[2]!) })
  return out
}

/**
 * Parse the FDTJ schematic map's hand-authored station points into
 * Map<stationId, {sx,sy}> (the diagram-space center of each station). This is
 * the layout source for the hero: the arms are already collapsed and the core
 * expanded, so stations sit on an even schematic lattice rather than sprawling
 * geographically. Points are oriented dumbbells (ax,ay -> bx,by); the midpoint
 * is the station center.
 */
function parseSchematicPoints(): Map<string, { sx: number; sy: number }> {
  const raw = readFileSync(resolve(API_SRC, '../../web/public/maps/fdtj/points.json'), 'utf8')
  const parsed = JSON.parse(raw) as { points: Array<{ id: string; ax: number; ay: number; bx: number; by: number }> }
  const out = new Map<string, { sx: number; sy: number }>()
  for (const p of parsed.points) out.set(p.id, { sx: (p.ax + p.bx) / 2, sy: (p.ay + p.by) / 2 })
  return out
}

/** Parse `hubs.sql` hubStations rows -> Set<stationId> that belong to a hub. */
function parseHubMembers(): Set<string> {
  const sql = readFileSync(resolve(API_SRC, 'db/scripts/hubs.sql'), 'utf8')
  const re = /INSERT OR REPLACE INTO hubStations[^;]*?VALUES\s*\('[^']*',\s*'[^']*',\s*'([^']+)'/g
  const out = new Set<string>()
  for (const m of sql.matchAll(re)) out.add(m[1]!)
  return out
}

/**
 * Normalize the operators' inconsistent name formats (KCI SHOUTS, MRTJ prefixes
 * "Stasiun ") into clean Title Case for roundel labels.
 */
function normalizeName(raw: string): string {
  let s = raw.trim().replace(/^Stasiun\s+/i, '')
  // Title-case only if the source is all-caps (KCI); leave mixed-case as-is.
  if (s === s.toUpperCase()) {
    s = s
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\bBni\b/g, 'BNI')
      .replace(/\bLrt\b/g, 'LRT')
  }
  return s
}

interface ApiStation {
  names: Map<string, string>
  coords: Map<string, { lat: number; lng: number }>
}

/**
 * One-off fetch of display names + coords from the live API, keyed by station
 * id. Coords here are the fallback for stations not yet in stations_lat_lng.sql
 * (e.g. newly-opened JTK/JIS), so the generator self-heals as the DB grows.
 */
async function fetchStations(): Promise<ApiStation> {
  const names = new Map<string, string>()
  const coords = new Map<string, { lat: number; lng: number }>()
  for (const op of RAIL_OPERATORS) {
    const res = await fetch(`${API_BASE}/stations/${op}`)
    if (!res.ok) throw new Error(`GET /stations/${op} -> ${res.status}`)
    const body = (await res.json()) as {
      data?: Array<{ id: string; name: string; latitude?: number | null; longitude?: number | null }>
    }
    for (const s of body.data ?? []) {
      names.set(s.id, normalizeName(s.name))
      if (typeof s.latitude === 'number' && typeof s.longitude === 'number') {
        coords.set(s.id, { lat: s.latitude, lng: s.longitude })
      }
    }
  }
  return { names, coords }
}

interface NetNode {
  id: string
  name: string
  lng: number
  lat: number
  sx: number // FDTJ schematic-space x (layout driver)
  sy: number // FDTJ schematic-space y
  col: number // baked lattice column (fixed grid; renderer just scales)
  row: number // baked lattice row
  interchange: boolean
}
interface NetLine {
  code: string
  operator: string
  name: string
  color: string
  segments: string[][] // each segment = ordered station ids -> polyline
}

async function main() {
  const coords = parseCoords()
  const schematic = parseSchematicPoints()
  const hubMembers = parseHubMembers()
  const { names, coords: apiCoords } = await fetchStations()

  // Fall back to live-API coords for any station missing from the checked-in
  // SQL (SQL wins where present, to stay in sync with the seeded DB).
  for (const [id, c] of apiCoords) if (!coords.has(id)) coords.set(id, c)

  const railTopo: LineTopology[] = TOPOLOGY.filter(
    (t) => RAIL_LINE_CODES.has(t.lineCode) && (RAIL_OPERATORS as readonly string[]).includes(t.operator)
  )

  // First pass: how many distinct lines touch each station id (>1 => interchange).
  const lineTouch = new Map<string, Set<string>>()
  const touch = (op: string, code: string, station: string) => {
    const id = `${op}-${station}`
    const set = lineTouch.get(id) ?? new Set<string>()
    set.add(`${op}:${code}`)
    lineTouch.set(id, set)
  }
  for (const t of railTopo) {
    for (const s of t.path) touch(t.operator, t.lineCode, s.station)
    for (const b of t.branches ?? []) for (const s of b.path) touch(t.operator, t.lineCode, s.station)
  }

  const nodes = new Map<string, NetNode>()
  const missing: string[] = []
  const ensureNode = (op: string, station: string) => {
    const id = `${op}-${station}`
    if (nodes.has(id)) return true
    const s = schematic.get(id)
    if (!s) {
      // Schematic coord is the layout driver now; a node without one can't be
      // placed on the hero diagram, so drop it (splits the polyline at the gap).
      missing.push(id)
      return false
    }
    const c = coords.get(id) // geographic, kept for reference; may be absent
    const crossOperatorHub = hubMembers.has(id)
    const multiLine = (lineTouch.get(id)?.size ?? 0) > 1
    nodes.set(id, {
      id,
      name: names.get(id) ?? station,
      lng: c?.lng ?? 0,
      lat: c?.lat ?? 0,
      sx: s.sx,
      sy: s.sy,
      col: 0, // filled by the snap pass below
      row: 0,
      interchange: crossOperatorHub || multiLine
    })
    return true
  }

  // Build ordered segments (dropping nodes with no coords, splitting the
  // polyline at the gap so we never draw a line to a phantom point).
  const buildSegments = (op: string, stops: Stop[]): string[][] => {
    const segs: string[][] = []
    let cur: string[] = []
    for (const s of stops) {
      if (ensureNode(op, s.station)) {
        cur.push(`${op}-${s.station}`)
      } else if (cur.length) {
        segs.push(cur)
        cur = []
      }
    }
    if (cur.length) segs.push(cur)
    return segs
  }

  const lines: NetLine[] = []
  for (const t of railTopo) {
    const meta = LINE_META.get(`${t.operator}:${t.lineCode}`)
    if (!meta) throw new Error(`No line meta for ${t.operator}:${t.lineCode}`)
    const segments = buildSegments(t.operator, t.path)
    // Branches: prepend the junction id so the branch polyline visibly connects
    // to the trunk (Bogor's Nambo fork, Cikarang's loop tail).
    for (const b of t.branches ?? []) {
      const junctionId = `${t.operator}-${b.fromStation}`
      const branchSegs = buildSegments(t.operator, b.path)
      for (const seg of branchSegs) {
        if (nodes.has(junctionId) && seg[0] !== junctionId) seg.unshift(junctionId)
        segments.push(seg)
      }
      // Loop closure (Cikarang): draw the tail back to closeTo.
      if (b.closeTo && b.path.length) {
        const lastId = `${t.operator}-${b.path[b.path.length - 1]!.station}`
        const closeId = `${t.operator}-${b.closeTo}`
        if (nodes.has(lastId) && nodes.has(closeId)) segments.push([lastId, closeId])
      }
    }
    lines.push({ code: t.lineCode, operator: t.operator, name: meta.name, color: meta.color, segments })
  }

  const nodeList = [...nodes.values()]
  const lngs = nodeList.map((n) => n.lng)
  const lats = nodeList.map((n) => n.lat)
  const bounds = {
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats)
  }
  const sxs = nodeList.map((n) => n.sx)
  const sys = nodeList.map((n) => n.sy)
  const schematicBounds = {
    minX: Math.min(...sxs),
    maxX: Math.max(...sxs),
    minY: Math.min(...sys),
    maxY: Math.max(...sys)
  }

  // ── Bake the fixed dot-lattice ───────────────────────────────────────────
  // Snap every station to an integer (col,row) ONCE, so the diagram is stable
  // across viewport widths (the renderer only scales col/row -> pixels).
  const schemW = schematicBounds.maxX - schematicBounds.minX
  const schemH = schematicBounds.maxY - schematicBounds.minY
  const gridCols = GRID_COLS
  const gridRows = Math.round(GRID_COLS / (schemW / schemH))
  const loC = GRID_INSET
  const hiC = gridCols - 1 - GRID_INSET
  const loR = GRID_INSET
  const hiR = gridRows - 1 - GRID_INSET
  const taken = new Set<string>()
  const freeCell = (c0: number, r0: number) => {
    for (let radius = 0; radius < 8; radius++) {
      for (let dc = -radius; dc <= radius; dc++) {
        for (let dr = -radius; dr <= radius; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue
          const c = c0 + dc
          const r = r0 + dr
          if (c < loC || r < loR || c > hiC || r > hiR) continue
          if (!taken.has(`${c},${r}`)) return { col: c, row: r }
        }
      }
    }
    return { col: c0, row: r0 }
  }
  // Snap interchanges first so hubs claim their intended cell before feeders.
  const snapOrder = [...nodeList].sort((a, b) => Number(b.interchange) - Number(a.interchange))
  for (const node of snapOrder) {
    const rawC = Math.round(loC + ((node.sx - schematicBounds.minX) / schemW) * (hiC - loC))
    const rawR = Math.round(loR + ((node.sy - schematicBounds.minY) / schemH) * (hiR - loR))
    const c0 = Math.max(loC, Math.min(hiC, rawC))
    const r0 = Math.max(loR, Math.min(hiR, rawR))
    const cell = taken.has(`${c0},${r0}`) ? freeCell(c0, r0) : { col: c0, row: r0 }
    taken.add(`${cell.col},${cell.row}`)
    node.col = cell.col
    node.row = cell.row
  }
  const grid = { cols: gridCols, rows: gridRows }

  const header = `// GENERATED by src/db/scripts/generateDataPlatformNetwork.ts — do not edit by hand.
// Baked Jabodetabek rail topology (KRL/MRT/LRT) for the hero network canvas.
// Layout is FDTJ schematic space (sx/sy); lng/lat kept for reference only.
// Re-generate: cd apps/api && npm run generate:dataplatform-network
`
  const body = `${header}
export interface NetNode {
  id: string
  name: string
  lng: number
  lat: number
  sx: number
  sy: number
  col: number
  row: number
  interchange: boolean
}

export interface NetLine {
  code: string
  operator: string
  name: string
  color: string
  segments: string[][]
}

export interface Network {
  nodes: NetNode[]
  lines: NetLine[]
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number }
  schematicBounds: { minX: number; maxX: number; minY: number; maxY: number }
  grid: { cols: number; rows: number }
}

export const NETWORK: Network = ${JSON.stringify({ nodes: nodeList, lines, bounds, schematicBounds, grid }, null, 2)}
`

  writeFileSync(OUT, body)
  const aspect = (schematicBounds.maxX - schematicBounds.minX) / (schematicBounds.maxY - schematicBounds.minY)
  console.log(`Wrote ${OUT}`)
  console.log(`  lines: ${lines.length}, nodes: ${nodeList.length}, interchanges: ${nodeList.filter((n) => n.interchange).length}`)
  console.log(`  grid: ${grid.cols}x${grid.rows} (aspect ${aspect.toFixed(2)}:1)`)
  if (missing.length) console.warn(`  dropped ${missing.length} node(s) missing schematic coord: ${missing.join(', ')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
