// Bakes the generated NETWORK into world-space instance data for the WebGL
// renderer. Pure data — no GL calls. The lattice geometry (octilinear routes,
// lit-dot dedupe, per-color longest route for trains) matches the original
// Canvas2D hero; only the projection changes: baked col/row -> world XZ on the
// y=0 ground plane, centered on the origin so camera lerps and the 45° tilt
// are symmetric.
import { NETWORK, type NetNode } from '../network'
import { octRoute, type GridCell } from './octilinear'

// One world unit per lattice cell. Camera distances are expressed relative to
// this. Centering on origin: worldX = (col - cols/2)*CELL.
export const CELL = 1

// Aesthetic constants carried over from network-canvas.ts (world units now).
export const FIELD_COLOR: [number, number, number] = hexToRgb('#20242e')
export const FIELD_RADIUS = 0.11
export const LINE_DOT_RADIUS = 0.21
export const STATION_RADIUS = 0.28
export const TRAIN_RADIUS = 0.29

export const TRAINS_PER_LINE = 2
export const TRAIN_STEP_MS = 90

// The topology-beat highlight: a contiguous run on Lin Cikarang (segment 1).
export const HIGHLIGHT_CHAIN = [
  'KCI-SUDB', // Sudirman Baru
  'KCI-SUD', //  Sudirman
  'KCI-MRI', //  Manggarai (interchange)
  'KCI-MTR' //  Matraman
] as const

// The tarif beat prices Blok M -> Dukuh Atas: a short central run on MRT's Lin
// Utara Selatan, chosen so the corridor stays readable on a portrait viewport.
// Sliced out of the real line rather than typed by hand, so it can't drift from
// the stop order the API prices; falls back to the endpoints if the slice fails.
export const MRT_FARE_FROM = 'MRTJ-BLM'
export const MRT_FARE_TO = 'MRTJ-DKA'

function mrtCorridor(): readonly string[] {
  const seg = NETWORK.lines.find(l => l.code === 'M')?.segments[0]
  if (!seg) return [MRT_FARE_FROM, MRT_FARE_TO]
  const a = seg.indexOf(MRT_FARE_FROM)
  const b = seg.indexOf(MRT_FARE_TO)
  if (a < 0 || b < 0) return [MRT_FARE_FROM, MRT_FARE_TO]
  return seg.slice(Math.min(a, b), Math.max(a, b) + 1)
}

const MRT_CORRIDOR: readonly string[] = mrtCorridor()

// Which subject the map emphasises. Every set is baked at build time (a few
// thousand Float32Array writes each, once) and swapped at runtime by the
// renderer, because a beat's subject is chosen by scroll position.
export type HighlightId = 'none' | 'cikarang' | 'mrt-lbb-bhi' | 'rasuna'

// The info-stasiun beat's subject. A lone station can't carry a beat — at
// STATION_RADIUS it stays indistinguishable from its neighbours while everything
// around it dims. So emphasise the run Rasuna Said sits on: Dukuh Atas ->
// Setiabudi -> Rasuna Said -> Kuningan -> Pancoran, the stretch where Lin Bekasi
// and Lin Cibubur share one track, which is exactly what the plate claims.
const RASUNA_RUN = [
  'LRTJBDB-DKA', // Dukuh Atas
  'LRTJBDB-SET', // Setiabudi
  'LRTJBDB-RAS', // Rasuna Said
  'LRTJBDB-KUA', // Kuningan
  'LRTJBDB-PAN' //  Pancoran
] as const

// Station chains to emphasise. Pairs are walked with octRoute() so the lit dots
// BETWEEN stations light up too; a single-station set has no pairs and would mark
// only the station itself.
const HIGHLIGHT_SETS: Record<Exclude<HighlightId, 'none'>, readonly string[]> = {
  'cikarang': HIGHLIGHT_CHAIN,
  'mrt-lbb-bhi': MRT_CORRIDOR,
  'rasuna': RASUNA_RUN
}

/** Per-instance emphasis flags for one subject, parallel to dots/stations. */
export interface HighlightSet {
  dots: Float32Array
  stations: Float32Array
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

// Packed instance arrays for one draw pass. Positions are world XYZ; radius is
// world units. Colors are 0..1 RGB. Extra per-pass attributes are documented
// on each builder's return type.
export interface FieldInstances {
  offsets: Float32Array // vec3 per instance
  count: number
}

export interface DotInstances {
  offsets: Float32Array // vec3
  colors: Float32Array // vec3 (line color)
  radii: Float32Array // float
  order: Float32Array // float 0..1, staggered draw-in
  count: number
}

export interface StationInstances {
  offsets: Float32Array // vec3
  radii: Float32Array // float
  count: number
}

// A train rides an ordered list of world positions (the line's longest route).
export interface TrainRoute {
  color: [number, number, number]
  points: Vec3[]
}

export interface NetworkScene {
  field: FieldInstances
  dots: DotInstances
  stations: StationInstances
  /** Emphasis flags per subject; the renderer uploads one set at a time. */
  highlights: Map<HighlightId, HighlightSet>
  trainRoutes: TrainRoute[]
  stationWorld: Map<string, Vec3>
  /** World-space AABB of the network (for camera framing). */
  bounds: { min: Vec3, max: Vec3, center: Vec3 }
  cols: number
  rows: number
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function cellToWorld(col: number, row: number, cols: number, rows: number): Vec3 {
  return {
    x: (col - cols / 2) * CELL,
    y: 0,
    z: (row - rows / 2) * CELL
  }
}

function cellKey(c: GridCell): string {
  return `${c.col},${c.row}`
}

export function buildScene(): NetworkScene {
  const cols = NETWORK.grid.cols
  const rows = NETWORK.grid.rows

  const nodeById = new Map<string, NetNode>()
  const stationCells = new Map<string, GridCell>()
  const stationWorld = new Map<string, Vec3>()
  for (const node of NETWORK.nodes) {
    nodeById.set(node.id, node)
    stationCells.set(node.id, { col: node.col, row: node.row })
    stationWorld.set(node.id, cellToWorld(node.col, node.row, cols, rows))
  }

  // Cells covered by each highlight subject. Computed from the same octRoute the
  // lit dots use, so a highlight lands exactly on drawn dots. A one-station chain
  // has no pairs, so this loop no-ops and only the station itself is marked.
  const highlightCells = new Map<HighlightId, Set<string>>()
  const highlightStations = new Map<HighlightId, Set<string>>()
  for (const [id, chain] of Object.entries(HIGHLIGHT_SETS) as [HighlightId, readonly string[]][]) {
    const cells = new Set<string>()
    for (let i = 0; i < chain.length - 1; i++) {
      const a = stationCells.get(chain[i]!)
      const b = stationCells.get(chain[i + 1]!)
      if (!a || !b) continue
      for (const c of octRoute(a, b)) cells.add(cellKey(c))
    }
    highlightCells.set(id, cells)
    highlightStations.set(id, new Set(chain))
  }

  // Lit line dots: octilinear routes per line segment, deduped by (cell,color)
  // so overlapping/parallel colors don't stack. Also collect the per-color
  // longest route for trains.
  const litOffsets: number[] = []
  const litColors: number[] = []
  const litRadii: number[] = []
  const litOrder: number[] = []
  // Cell key per emitted dot, in instance order — lets every highlight set be
  // derived after the fact instead of baking one subject into the geometry.
  const litCellKeys: string[] = []
  const litKeys = new Set<string>()
  const routesByColor = new Map<string, GridCell[]>()
  const colorRgb = new Map<string, [number, number, number]>()

  for (const line of NETWORK.lines) {
    const rgb = hexToRgb(line.color)
    colorRgb.set(line.color, rgb)
    const lineRoute: GridCell[] = []
    for (const seg of line.segments) {
      for (let i = 0; i < seg.length - 1; i++) {
        const a = stationCells.get(seg[i]!)
        const b = stationCells.get(seg[i + 1]!)
        if (!a || !b) continue
        const route = octRoute(a, b)
        for (const c of route) {
          const last = lineRoute[lineRoute.length - 1]
          if (!last || last.col !== c.col || last.row !== c.row) lineRoute.push(c)
        }
      }
    }
    const total = Math.max(lineRoute.length, 1)
    lineRoute.forEach((c, i) => {
      const key = `${c.col},${c.row}:${line.color}`
      if (litKeys.has(key)) return
      litKeys.add(key)
      const w = cellToWorld(c.col, c.row, cols, rows)
      litOffsets.push(w.x, w.y, w.z)
      litColors.push(rgb[0], rgb[1], rgb[2])
      litRadii.push(LINE_DOT_RADIUS)
      litOrder.push(i / total)
      litCellKeys.push(cellKey(c))
    })
    const existing = routesByColor.get(line.color)
    if (!existing || lineRoute.length > existing.length) {
      routesByColor.set(line.color, lineRoute)
    }
  }

  // Stations — interchanges render identically to regular stops (no oversized
  // roundel, no labels), keeping the dense core legible.
  const stOffsets: number[] = []
  const stRadii: number[] = []
  const stIds: string[] = []
  for (const node of NETWORK.nodes) {
    const w = stationWorld.get(node.id)!
    stOffsets.push(w.x, w.y, w.z)
    stRadii.push(STATION_RADIUS)
    stIds.push(node.id)
  }

  // Bake one flag array per subject, parallel to the instance arrays above.
  // 'none' stays all-zero so the renderer can clear emphasis without a branch.
  const highlights = new Map<HighlightId, HighlightSet>()
  highlights.set('none', {
    dots: new Float32Array(litCellKeys.length),
    stations: new Float32Array(stIds.length)
  })
  for (const id of Object.keys(HIGHLIGHT_SETS) as Exclude<HighlightId, 'none'>[]) {
    const cells = highlightCells.get(id)!
    const stations = highlightStations.get(id)!
    highlights.set(id, {
      dots: Float32Array.from(litCellKeys, k => (cells.has(k) ? 1 : 0)),
      stations: Float32Array.from(stIds, s => (stations.has(s) ? 1 : 0))
    })
  }

  // Faint dead-dot field across a rectangle larger than the network, so the
  // full-viewport plane never shows bare background. Margins are in cells and
  // asymmetric on purpose: the network is much wider (120 cells) than tall (75),
  // and every beat frames by height, so a wide viewport runs out of field
  // sideways long before it does vertically. Padding X harder than Z covers
  // ultrawide screens without paying for rows nothing ever sees.
  const FIELD_MARGIN_X = 70
  const FIELD_MARGIN_Z = 24
  const fieldOffsets: number[] = []
  for (let col = -FIELD_MARGIN_X; col < cols + FIELD_MARGIN_X; col++) {
    for (let row = -FIELD_MARGIN_Z; row < rows + FIELD_MARGIN_Z; row++) {
      const w = cellToWorld(col, row, cols, rows)
      fieldOffsets.push(w.x, w.y, w.z)
    }
  }

  // Trains: per-color longest route (>= 4 cells), lifted to world points.
  const trainRoutes: TrainRoute[] = []
  for (const [color, route] of routesByColor) {
    if (route.length < 4) continue
    const rgb = colorRgb.get(color)!
    const points = route.map(c => cellToWorld(c.col, c.row, cols, rows))
    trainRoutes.push({ color: rgb, points })
  }

  // World AABB from stations (the field extends past it, but framing keys off
  // the actual network extent).
  const min: Vec3 = { x: Infinity, y: 0, z: Infinity }
  const max: Vec3 = { x: -Infinity, y: 0, z: -Infinity }
  for (const w of stationWorld.values()) {
    min.x = Math.min(min.x, w.x)
    min.z = Math.min(min.z, w.z)
    max.x = Math.max(max.x, w.x)
    max.z = Math.max(max.z, w.z)
  }
  const center: Vec3 = { x: (min.x + max.x) / 2, y: 0, z: (min.z + max.z) / 2 }

  return {
    field: { offsets: new Float32Array(fieldOffsets), count: fieldOffsets.length / 3 },
    dots: {
      offsets: new Float32Array(litOffsets),
      colors: new Float32Array(litColors),
      radii: new Float32Array(litRadii),
      order: new Float32Array(litOrder),
      count: litOffsets.length / 3
    },
    stations: {
      offsets: new Float32Array(stOffsets),
      radii: new Float32Array(stRadii),
      count: stOffsets.length / 3
    },
    highlights,
    trainRoutes,
    stationWorld,
    bounds: { min, max, center },
    cols,
    rows
  }
}
