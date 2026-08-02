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
const LINE_META = new Map<string, { name: string, color: string }>([
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
function parseCoords(): Map<string, { lat: number, lng: number }> {
  const sql = readFileSync(resolve(API_SRC, 'db/scripts/stations_lat_lng.sql'), 'utf8')
  const re = /latitude\s*=\s*(-?[\d.]+),\s*longitude\s*=\s*(-?[\d.]+)[^']*id\s*=\s*'([^']+)'/g
  const out = new Map<string, { lat: number, lng: number }>()
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
function parseSchematicPoints(): Map<string, { sx: number, sy: number }> {
  const raw = readFileSync(resolve(API_SRC, '../../web/app/data/points.json'), 'utf8')
  const parsed = JSON.parse(raw) as { points: Array<{ id: string, ax: number, ay: number, bx: number, by: number }> }
  const out = new Map<string, { sx: number, sy: number }>()
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
      .replace(/\b\w/g, c => c.toUpperCase())
      .replace(/\bBni\b/g, 'BNI')
      .replace(/\bLrt\b/g, 'LRT')
  }
  return s
}

interface APIStation {
  names: Map<string, string>
  coords: Map<string, { lat: number, lng: number }>
}

/**
 * One-off fetch of display names + coords from the live API, keyed by station
 * id. Coords here are the fallback for stations not yet in stations_lat_lng.sql
 * (e.g. newly-opened JTK/JIS), so the generator self-heals as the DB grows.
 */
async function fetchStations(): Promise<APIStation> {
  const names = new Map<string, string>()
  const coords = new Map<string, { lat: number, lng: number }>()
  for (const op of RAIL_OPERATORS) {
    const res = await fetch(`${API_BASE}/stations/${op}`)
    if (!res.ok) throw new Error(`GET /stations/${op} -> ${res.status}`)
    const body = (await res.json()) as {
      data?: Array<{ id: string, name: string, latitude?: number | null, longitude?: number | null }>
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
  /**
   * A bend point, not a station: it steers the octilinear route through a cell
   * the printed diagram passes through, and the renderer draws no roundel for it.
   * See ROUTE_WAYPOINTS.
   */
  waypoint?: boolean
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
    t => RAIL_LINE_CODES.has(t.lineCode) && (RAIL_OPERATORS as readonly string[]).includes(t.operator)
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
  const lngs = nodeList.map(n => n.lng)
  const lats = nodeList.map(n => n.lat)
  const bounds = {
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats)
  }
  const sxs = nodeList.map(n => n.sx)
  const sys = nodeList.map(n => n.sy)
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

  // ── Collinearity tie-break ───────────────────────────────────────────────
  // Rounding each station independently can split a run the FDTJ map draws dead
  // straight: MRTJ-STB / DKA / BHI span only 0.57 cells in x (ideal cols 49.96,
  // 50.48, 50.53) but round to 50, 50, 51 — so a vertical corridor renders with
  // a 45° jog on Dukuh Atas, which the tarif beat frames. KCI-CKR -> KCI-TLM
  // does the same in y.
  //
  // Works on RUNS, not pairs. Adjacent stations whose true separation on one
  // axis is under half a cell form a chain by transitivity, and fixing such a
  // chain pairwise just walks the kink down it (aligning DKA to BHI opens a new
  // jog at STB -> DKA). So: collect each maximal connected run of near-collinear
  // neighbours, then move the whole run onto one shared value — the candidate
  // that costs the least total rounding error and whose cells are all free.
  const cellPerSx = (hiC - loC) / schemW
  const cellPerSy = (hiR - loR) / schemH
  const COLLINEAR_TOL = 0.55 // cells; a true delta under this rounded apart
  const idealCol = (n: NetNode) => loC + ((n.sx - schematicBounds.minX) / schemW) * (hiC - loC)
  const idealRow = (n: NetNode) => loR + ((n.sy - schematicBounds.minY) / schemH) * (hiR - loR)
  const aligned: string[] = []

  for (const axis of ['col', 'row'] as const) {
    const idealOf = axis === 'col' ? idealCol : idealRow
    const perCell = axis === 'col' ? cellPerSx : cellPerSy
    const coord = axis === 'col' ? (n: NetNode) => n.sx : (n: NetNode) => n.sy

    // Union-find over stations linked by a near-collinear adjacency.
    const parent = new Map<string, string>()
    const find = (x: string): string => {
      let r = x
      while (parent.get(r) !== r) r = parent.get(r)!
      return r
    }
    for (const n of nodeList) parent.set(n.id, n.id)
    for (const line of lines) {
      for (const seg of line.segments) {
        for (let i = 0; i < seg.length - 1; i++) {
          const a = nodes.get(seg[i]!)
          const b = nodes.get(seg[i + 1]!)
          if (!a || !b) continue
          if (Math.abs(coord(b) - coord(a)) * perCell >= COLLINEAR_TOL) continue
          const ra = find(a.id)
          const rb = find(b.id)
          if (ra !== rb) parent.set(ra, rb)
        }
      }
    }
    const runs = new Map<string, NetNode[]>()
    for (const n of nodeList) {
      const r = find(n.id)
      runs.set(r, [...(runs.get(r) ?? []), n])
    }

    for (const run of runs.values()) {
      if (run.length < 2) continue
      const values = new Set(run.map(n => n[axis]))
      if (values.size === 1) continue // already collinear
      // Try every value the run currently occupies, plus the rounded mean of the
      // run's ideal positions; keep the cheapest that every member can reach.
      const meanIdeal = Math.round(run.reduce((s, n) => s + idealOf(n), 0) / run.length)
      let best: { value: number, cost: number } | null = null
      for (const value of new Set([...values, meanIdeal])) {
        if (axis === 'col' ? value < loC || value > hiC : value < loR || value > hiR) continue
        // Cells the run would vacate are fair game for its own members.
        const freed = new Set(run.map(n => `${n.col},${n.row}`))
        let cost = 0
        let ok = true
        for (const n of run) {
          const dest = axis === 'col' ? `${value},${n.row}` : `${n.col},${value}`
          if (taken.has(dest) && !freed.has(dest)) {
            ok = false
            break
          }
          cost += Math.abs(idealOf(n) - value)
        }
        if (!ok) continue
        if (!best || cost < best.cost) best = { value, cost }
      }
      if (!best) continue
      for (const n of run) taken.delete(`${n.col},${n.row}`)
      for (const n of run) {
        n[axis] = best.value
        taken.add(`${n.col},${n.row}`)
      }
      aligned.push(
        `${run.map(n => n.id).join('/')} -> ${axis} ${best.value} (${best.cost.toFixed(2)} cells total)`
      )
    }
  }

  // ── Hand-authored layout corrections ─────────────────────────────────────
  // A short list of places where the automatic passes above land defensibly but
  // still disagree with the printed FDTJ diagram. Keyed by station, applied
  // before spacing so the spacing pass can react to them. Each entry cites what
  // the map shows — check tile-1-1/tile-1-2 in web/public/maps/fdtj before
  // adding to this list.
  const LAYOUT_FIXES: Array<{ id: string, col?: number, row?: number, why: string }> = [
    {
      // FDTJ draws Angke, Duri and Tanah Abang on ONE vertical cyan trunk. Angke's
      // sx (2959) is 0.6 cells right of the other two (2918/2917), so it rounds to
      // col 41 while they take col 40 — a one-cell jog in a line the map shows dead
      // straight. The collinearity pass can't catch it: AK->DU is 6 rows apart, so
      // the pair is nowhere near the sub-cell tolerance that pass keys on.
      id: 'KCI-AK',
      col: 40,
      why: 'FDTJ: Angke/Duri/Tanah Abang share one vertical trunk'
    }
  ]
  const layoutFixed: string[] = []
  for (const fix of LAYOUT_FIXES) {
    const node = nodes.get(fix.id)
    if (!node) throw new Error(`LAYOUT_FIXES: unknown station ${fix.id}`)
    const col = fix.col ?? node.col
    const row = fix.row ?? node.row
    if (col === node.col && row === node.row) continue
    const dest = `${col},${row}`
    if (taken.has(dest)) throw new Error(`LAYOUT_FIXES: ${fix.id} -> ${dest} is already occupied`)
    taken.delete(`${node.col},${node.row}`)
    node.col = col
    node.row = row
    taken.add(dest)
    layoutFixed.push(`${fix.id} -> ${dest} (${fix.why})`)
  }

  // ── Minimum station spacing ──────────────────────────────────────────────
  // Neighbours one cell apart leave no dark dot between their roundels, so they
  // read as one blob (MRTJ-DKA/BHI and LRTJBDB-RAS/KUA were the obvious ones).
  // Spread them until at least one unlit lattice cell always separates two
  // stations.
  //
  // Works on a whole CORRIDOR, not a pair at a time. Nudging each station away
  // from its predecessor independently makes them leapfrog: on the Cikarang
  // trunk it produced ...TLM(115) CIT(112) TB(114)..., i.e. stations drawn out
  // of sequence, which is far worse than two of them touching. So instead:
  // take each maximal run of stations that share a row (or column), sort it
  // along that corridor, and re-lay the members out in order with a minimum
  // stride — preserving sequence by construction.
  const MIN_SPACING = 2
  const spaced: string[] = []
  // Both passes below can open one gap while closing another (moving KCI-JMU off
  // KCI-PDJ walked it into KCI-SDM), so run them to a fixed point. Converges in
  // 2-3 rounds; the cap only guards against a cluster with nowhere to go.
  for (let round = 0; round < 8; round++) {
    const before = spaced.length
    for (const axis of ['col', 'row'] as const) {
    // The axis the corridor runs ALONG; the other one it's constant on.
      const along = axis
      const across: 'col' | 'row' = axis === 'col' ? 'row' : 'col'
      const lo = along === 'col' ? loC : loR
      const hi = along === 'col' ? hiC : hiR

      // Group stations by (line, segment, shared across-value) so a corridor is a
      // contiguous stretch of one line, not every station that happens to share a row.
      for (const line of lines) {
        for (const seg of line.segments) {
          let run: NetNode[] = []
          const flush = () => {
            if (run.length >= 2) relayout(run, seg)
            run = []
          }
          for (const id of seg) {
            const n = nodes.get(id)
            if (!n) {
              flush()
              continue
            }
            const prev = run[run.length - 1]
            if (prev && prev[across] === n[across]) {
              run.push(n)
            } else {
              flush()
              run = [n]
            }
          }
          flush()
        }
      }

      function relayout(run: NetNode[], seg: string[]): void {
      // Already comfortably spread? leave it alone.
        const sorted = [...run].sort((x, y) => x[along] - y[along])
        let tight = false
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i]![along] - sorted[i - 1]![along] < MIN_SPACING) tight = true
        }
        if (!tight) return
        // The stations immediately before and after this run in the segment. A run
        // spread outward must not overshoot them, or the line doubles back: the
        // Rangkasbitung row-56 tail, re-laid out from its west end, walked KCI-RU
        // east past KCI-SDM (row 55, col 26) and the polyline went west, east,
        // then west again. Occupancy alone does not catch this — SDM is on a
        // different row, so no cell ever collides.
        const first = run[0]!
        const last = run[run.length - 1]!
        const iFirst = seg.indexOf(first.id)
        const iLast = seg.indexOf(last.id)
        const before = iFirst > 0 ? nodes.get(seg[iFirst - 1]!) : undefined
        const after = iLast >= 0 && iLast < seg.length - 1 ? nodes.get(seg[iLast + 1]!) : undefined
        // A run needs (len-1)*MIN_SPACING cells of span. Long runs against the
        // lattice edge (the Rangkasbitung tail reaches col 3) cannot get that by
        // pushing away from their head, so try anchoring each end and keep the
        // first layout that fits. Anchoring the head is preferred — it leaves
        // upstream geometry alone — but a run that only fits from the tail is
        // still better than one drawn out of sequence.
        const ascending = run[run.length - 1]![along] >= run[0]![along]
        const ordered = ascending ? sorted : [...sorted].reverse()
        const outside = new Set(
          nodeList.filter(n => !run.includes(n)).map(n => `${n.col},${n.row}`)
        )
        const attempt = (fromHead: boolean): Array<{ node: NetNode, value: number }> | null => {
        // Walking from the tail is the same problem mirrored: reverse the list
        // and the stride direction.
          const walk = fromHead ? ordered : [...ordered].reverse()
          const dir = (ascending ? 1 : -1) * (fromHead ? 1 : -1)
          // Whichever end this walk grows toward is the one that can overshoot the
          // adjacent station, so bound the cursor by that neighbour.
          const limitNode = fromHead ? after : before
          const limit = limitNode && !limitNode.waypoint ? limitNode[along] : null
          const out: Array<{ node: NetNode, value: number }> = []
          let cursor = walk[0]![along]
          out.push({ node: walk[0]!, value: cursor })
          for (let i = 1; i < walk.length; i++) {
            const n = walk[i]!
            const want = cursor + dir * MIN_SPACING
            // Only push outward; never pull a station back toward its neighbour.
            const next = dir > 0 ? Math.max(n[along], want) : Math.min(n[along], want)
            if (next < lo || next > hi) return null
            // Crossing the neighbour that feeds this run reverses the line.
            if (limit !== null && (dir > 0 ? next >= limit : next <= limit)) return null
            const dest = along === 'col'
              ? `${next},${n.row}`
              : `${n.col},${next}`
            if (outside.has(dest)) return null
            out.push({ node: n, value: next })
            cursor = next
          }
          return out
        }
        const plan = attempt(true) ?? attempt(false)
        if (!plan) return
        const moved: string[] = []
        for (const { node, value } of plan) {
          if (node[along] === value) continue
          moved.push(`${node.id} ${along} ${node[along]}->${value}`)
          node[along] = value
        }
        if (!moved.length) return
        spaced.push(moved.join(', '))
      }
    }
    // The relayout above vacates cells lazily; rebuild occupancy from the nodes so
    // later checks see the truth.
    taken.clear()
    for (const n of nodeList) taken.add(`${n.col},${n.row}`)

    // Diagonal touchers: a pair one cell apart on BOTH axes belongs to no
    // shared-axis corridor, so the run-based pass above never sees it
    // (KCI-PDJ/KCI-JMU on the Rangkasbitung descent). Step the downstream station
    // one further out along the pair's own diagonal, which keeps the bearing the
    // line already has.
    for (const line of lines) {
      for (const seg of line.segments) {
        for (let i = 0; i < seg.length - 1; i++) {
          const a = nodes.get(seg[i]!)
          const b = nodes.get(seg[i + 1]!)
          if (!a || !b) continue
          if (Math.abs(a.col - b.col) !== 1 || Math.abs(a.row - b.row) !== 1) continue
          const dc = Math.sign(b.col - a.col)
          const dr = Math.sign(b.row - a.row)
          // Moving a station that sits on a straight run with its OTHER neighbour
          // would bend that run to unhug this pair — trading a touch for a kink,
          // which is the worse defect. On the Rangkasbitung tail this pulled
          // KCI-RU off row 56 into a zigzag. Prefer the end that is free to move.
          const onCorridor = (n: NetNode, other: NetNode): boolean => {
            const k = seg.indexOf(n.id)
            for (const j of [k - 1, k + 1]) {
              const nb = j >= 0 && j < seg.length ? nodes.get(seg[j]!) : undefined
              if (!nb || nb === other) continue
              if (nb.col === n.col || nb.row === n.row) return true
            }
            return false
          }
          const candidates = [b, a].filter(n => !n.interchange && !onCorridor(n, n === b ? a : b))
          const mover = candidates[0]
          if (!mover) continue
          const sign = mover === b ? 1 : -1
          const col = mover.col + dc * sign
          const row = mover.row + dr * sign
          if (col < loC || col > hiC || row < loR || row > hiR) continue
          if (taken.has(`${col},${row}`)) continue
          taken.delete(`${mover.col},${mover.row}`)
          mover.col = col
          mover.row = row
          taken.add(`${col},${row}`)
          spaced.push(`${a.id}/${b.id}: moved ${mover.id} diagonally to ${col},${row}`)
        }
      }
    }
    if (spaced.length === before) break
  }

  // ── Route waypoints ──────────────────────────────────────────────────────
  // Two stations can be adjacent on a line yet far apart on the diagram, and
  // there the straight octilinear run between them is simply the wrong shape.
  // The Cikarang loop tail is the case: Kampung Bandan (C07) -> Angke (C08) is
  // one hop but spans 27 columns, and routed straight it dives to row 11 and
  // cuts through the Jakarta Kota / Jayakarta / Mangga Besar block. FDTJ draws
  // that stretch arcing NORTH of Jakarta Kota (see tile-1-1 / tile-1-2 in
  // web/public/maps/fdtj — the cyan C line curves over the top).
  //
  // A waypoint is a bend point inserted into the segment: it steers the route
  // but draws no roundel (NetNode.waypoint). Applied after spacing so the
  // spacing passes never see, or shuffle, these synthetic cells.
  const ROUTE_WAYPOINTS: Record<string, Array<{ col: number, row: number }>> = {
    // Row 4 is clear right across cols 40..67, so the tail runs above Jakarta
    // Kota (row 6) and rejoins Angke's column before descending to it.
    'KCI-KPB>KCI-AK': [{ col: 64, row: 4 }, { col: 43, row: 4 }]
  }
  const wayptAdded: string[] = []
  for (const [pair, cells] of Object.entries(ROUTE_WAYPOINTS)) {
    const [fromId, toId] = pair.split('>') as [string, string]
    let hits = 0
    for (const line of lines) {
      for (const seg of line.segments) {
        // Either direction: the loop tail can be emitted reversed.
        let i = seg.indexOf(fromId)
        let ordered = cells
        if (i < 0 || seg[i + 1] !== toId) {
          i = seg.indexOf(toId)
          ordered = [...cells].reverse()
          if (i < 0 || seg[i + 1] !== fromId) continue
        }
        const ids = ordered.map((cell, k) => {
          const id = `WP-${fromId}-${toId}-${k}`
          const existing = nodes.get(id)
          if (existing) return id
          if (taken.has(`${cell.col},${cell.row}`)) {
            throw new Error(`ROUTE_WAYPOINTS: ${id} cell ${cell.col},${cell.row} is occupied`)
          }
          const node: NetNode = {
            id,
            name: '',
            lng: 0,
            lat: 0,
            sx: 0,
            sy: 0,
            col: cell.col,
            row: cell.row,
            interchange: false,
            waypoint: true
          }
          nodes.set(id, node)
          nodeList.push(node)
          taken.add(`${cell.col},${cell.row}`)
          return id
        })
        seg.splice(i + 1, 0, ...ids)
        hits++
      }
    }
    if (!hits) throw new Error(`ROUTE_WAYPOINTS: pair ${pair} matched no segment`)
    wayptAdded.push(`${pair}: ${cells.map(c => `${c.col},${c.row}`).join(' -> ')} (${hits} segment(s))`)
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
  /** Bend point that steers a route but draws no station roundel. */
  waypoint?: boolean
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
  console.log(`  lines: ${lines.length}, nodes: ${nodeList.length}, interchanges: ${nodeList.filter(n => n.interchange).length}`)
  console.log(`  grid: ${grid.cols}x${grid.rows} (aspect ${aspect.toFixed(2)}:1)`)
  console.log(`  collinearity tie-break: ${aligned.length} run(s) aligned${aligned.length ? `\n    ${aligned.join('\n    ')}` : ''}`)
  console.log(`  layout fixes: ${layoutFixed.length}${layoutFixed.length ? `\n    ${layoutFixed.join('\n    ')}` : ''}`)
  console.log(`  min spacing: ${spaced.length} move(s)${spaced.length ? `\n    ${spaced.join('\n    ')}` : ''}`)
  console.log(`  route waypoints: ${wayptAdded.length}${wayptAdded.length ? `\n    ${wayptAdded.join('\n    ')}` : ''}`)
  if (missing.length) console.warn(`  dropped ${missing.length} node(s) missing schematic coord: ${missing.join(', ')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
