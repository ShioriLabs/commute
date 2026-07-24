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
// Baked here so the shader's per-instance a_isHighlight is ready in Phase 1
// even though the camera doesn't visit it until Phase 2.
export const HIGHLIGHT_CHAIN = [
  'KCI-SUDB', // Sudirman Baru
  'KCI-SUD', //  Sudirman
  'KCI-MRI', //  Manggarai (interchange)
  'KCI-MTR' //  Matraman
] as const

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
  isHighlight: Float32Array // float 0/1
  count: number
}

export interface StationInstances {
  offsets: Float32Array // vec3
  radii: Float32Array // float
  isHighlight: Float32Array // float 0/1
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

  // Cells that belong to the highlighted Cikarang sub-route (Sudirman Baru ->
  // Sudirman -> Manggarai -> Matraman). Computed from the same octRoute the
  // lit dots use, so the highlight lands exactly on drawn dots.
  const highlightCells = new Set<string>()
  for (let i = 0; i < HIGHLIGHT_CHAIN.length - 1; i++) {
    const a = stationCells.get(HIGHLIGHT_CHAIN[i]!)
    const b = stationCells.get(HIGHLIGHT_CHAIN[i + 1]!)
    if (!a || !b) continue
    for (const c of octRoute(a, b)) highlightCells.add(cellKey(c))
  }
  const highlightStations = new Set<string>(HIGHLIGHT_CHAIN)

  // Lit line dots: octilinear routes per line segment, deduped by (cell,color)
  // so overlapping/parallel colors don't stack. Also collect the per-color
  // longest route for trains.
  const litOffsets: number[] = []
  const litColors: number[] = []
  const litRadii: number[] = []
  const litOrder: number[] = []
  const litHighlight: number[] = []
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
      litHighlight.push(highlightCells.has(cellKey(c)) ? 1 : 0)
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
  const stHighlight: number[] = []
  for (const node of NETWORK.nodes) {
    const w = stationWorld.get(node.id)!
    stOffsets.push(w.x, w.y, w.z)
    stRadii.push(STATION_RADIUS)
    stHighlight.push(highlightStations.has(node.id) ? 1 : 0)
  }

  // Faint dead-dot field across a rectangle a bit larger than the network, so
  // the tilted full-viewport plane never shows bare background. Margin in cells.
  const FIELD_MARGIN = 18
  const fieldOffsets: number[] = []
  for (let col = -FIELD_MARGIN; col < cols + FIELD_MARGIN; col++) {
    for (let row = -FIELD_MARGIN; row < rows + FIELD_MARGIN; row++) {
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
      isHighlight: new Float32Array(litHighlight),
      count: litOffsets.length / 3
    },
    stations: {
      offsets: new Float32Array(stOffsets),
      radii: new Float32Array(stRadii),
      isHighlight: new Float32Array(stHighlight),
      count: stOffsets.length / 3
    },
    trainRoutes,
    stationWorld,
    bounds: { min, max, center },
    cols,
    rows
  }
}
