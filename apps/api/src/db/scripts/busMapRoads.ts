import * as fs from 'node:fs'
import * as path from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { LngLat } from '../../utils/polyline'
import { readTile } from './mvt'

/*
 * Peta Bus's lines laid onto the roads themselves. The feed's shape points are
 * loose: a few metres off the carriageway, a corner cut, a turn drawn across
 * the block. shirase's own basemap tiles carry OSM's roads, so each line is
 * matched to them: a point every SAMPLE_M along it takes the nearest road
 * within SNAP_M that runs the way the bus does (a one-way only with it: the
 * right carriageway of a divided road), keeping to the road it is on where it
 * can, and between two points on one road the line follows the road's own
 * geometry, corners and all. A point with no road near enough stays where the
 * feed put it.
 *
 * Tiles are read from shirase as served (the newest basemap, at TILE_ZOOM) and
 * cached on disk under apps/api/.cache, so a re-run needs no network.
 */

const SHIRASE = 'https://shirase.commute.shiorilabs.id'
const CACHE_DIR = path.join(__dirname, '../../../.cache/shirase-roads')

/** Roads at z14: every street a bus takes, at well under a metre's precision. */
const TILE_ZOOM = 14

/** A point every SAMPLE_M along a line, matched to a road within SNAP_M of it. */
const SAMPLE_M = 8
const SNAP_M = 30

/** A road counts when it runs within this of the bus's way, either way (both ways on a two-way road). */
const HEADING_COS = Math.cos((40 * Math.PI) / 180)

/*
 * Preferences, in metres off a road's distance: keep to the road the last
 * point was on (the feed's wobble shouldn't hop lanes), BRT on a busway, and
 * off a flyover unless the shape is clearly on it (Kuningan's runs over Rasuna
 * Said's busway).
 */
const SAME_ROAD_M = 8
const BUSWAY_M = 10
const BRIDGE_M = 12

/** Points matching no road between two on one road are a corner the feed cut, up to this many. */
const GAP_POINTS = 6

/** The kinds of road a bus can drive. */
const DRIVABLE = new Set(['highway', 'major_road', 'minor_road', 'other'])
const NOT_DRIVABLE = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'corridor', 'sidewalk', 'crossing', 'bridleway'])

const KX = Math.cos((-6.2 * Math.PI) / 180) * 111_320
const KY = 110_574

interface Road {
  xy: [number, number][]
  oneway: boolean
  busway: boolean
  bridge: boolean
}

interface Segment {
  road: number
  /** Index of the segment's first point in its road. */
  i: number
}

export class Roads {
  private readonly cells = new Map<string, Segment[]>()

  constructor(readonly roads: Road[]) {
    roads.forEach((road, r) => {
      for (let i = 1; i < road.xy.length; i++) {
        const [ax, ay] = road.xy[i - 1]!
        const [bx, by] = road.xy[i]!
        const x0 = Math.floor(Math.min(ax, bx) / SNAP_M)
        const x1 = Math.floor(Math.max(ax, bx) / SNAP_M)
        const y0 = Math.floor(Math.min(ay, by) / SNAP_M)
        const y1 = Math.floor(Math.max(ay, by) / SNAP_M)
        for (let cx = x0; cx <= x1; cx++) {
          for (let cy = y0; cy <= y1; cy++) {
            const key = `${cx},${cy}`
            const list = this.cells.get(key)
            if (list) list.push({ road: r, i: i - 1 })
            else this.cells.set(key, [{ road: r, i: i - 1 }])
          }
        }
      }
    })
  }

  /** The segments with a cell around ([x], [y]), once each. */
  near(x: number, y: number): Segment[] {
    const out: Segment[] = []
    const seen = new Set<string>()
    const cx = Math.floor(x / SNAP_M)
    const cy = Math.floor(y / SNAP_M)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const s of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const key = `${s.road}:${s.i}`
          if (!seen.has(key)) {
            seen.add(key)
            out.push(s)
          }
        }
      }
    }
    return out
  }
}

const toXY = ([lng, lat]: LngLat): [number, number] => [lng * KX, lat * KY]
const toLngLat = ([x, y]: [number, number]): LngLat => [x / KX, y / KY]

function tileOf(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z
  const x = Math.floor(((lng + 180) / 360) * n)
  const r = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
  return [x, y]
}

/** A point in tile [x],[y] at [z], from its tile units ([px], [py] of [extent]). */
function tileLngLat(z: number, x: number, y: number, extent: number, px: number, py: number): LngLat {
  const n = 2 ** z
  const lng = ((x + px / extent) / n) * 360 - 180
  const my = Math.PI * (1 - (2 * (y + py / extent)) / n)
  const lat = (Math.atan(Math.sinh(my)) * 180) / Math.PI
  return [lng, lat]
}

async function tileBytes(tileset: string, z: number, x: number, y: number): Promise<Uint8Array | null> {
  const file = path.join(CACHE_DIR, tileset, `${z}`, `${x}`, `${y}.mvt`)
  if (fs.existsSync(file)) return fs.readFileSync(file)
  const res = await fetch(`${SHIRASE}/${tileset}/${z}/${x}/${y}.mvt`)
  if (res.status === 204 || res.status === 404) return null
  if (!res.ok) throw new Error(`shirase ${tileset}/${z}/${x}/${y}: ${res.status}`)
  let bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, bytes)
  return bytes
}

/**
 * The drivable roads of every TILE_ZOOM tile the [pieces] pass through, from
 * shirase's newest basemap, with a tile's neighbours too so a line near a tile's
 * edge finds the roads across it.
 */
export async function loadRoads(pieces: readonly LngLat[][]): Promise<Roads> {
  const style = await (await fetch(`${SHIRASE}/styles/light.json`)).json() as { metadata: Record<string, string> }
  const tileset = style.metadata['shirase:tileset']!
  const tiles = new Set<string>()
  for (const piece of pieces) {
    for (const [lng, lat] of piece) {
      const [x, y] = tileOf(lng, lat, TILE_ZOOM)
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) tiles.add(`${x + dx},${y + dy}`)
    }
  }
  const roads: Road[] = []
  const list = [...tiles]
  const wanted = new Set(['roads'])
  // A few at a time: shirase serves them from its edge cache, and a first run fetches some hundreds.
  for (let i = 0; i < list.length; i += 8) {
    const batch = await Promise.all(list.slice(i, i + 8).map(async (key) => {
      const [x, y] = key.split(',').map(Number) as [number, number]
      return { x, y, bytes: await tileBytes(tileset, TILE_ZOOM, x, y) }
    }))
    for (const { x, y, bytes } of batch) {
      if (!bytes) continue
      for (const layer of readTile(bytes, wanted)) {
        for (const f of layer.features) {
          if (f.type !== 2) continue
          const kind = String(f.properties.kind ?? '')
          const detail = String(f.properties.kind_detail ?? '')
          if (!DRIVABLE.has(kind) || NOT_DRIVABLE.has(detail)) continue
          for (const part of f.geometry) {
            if (part.length < 2) continue
            roads.push({
              xy: part.map(([px, py]) => toXY(tileLngLat(TILE_ZOOM, x, y, layer.extent, px, py))),
              oneway: f.properties.oneway === 'yes',
              busway: detail === 'busway',
              bridge: f.properties.is_bridge === true
            })
          }
        }
      }
    }
  }
  return new Roads(roads)
}

/** Points every SAMPLE_M along a polyline, both ends kept, in metres. */
function sample(xy: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = [xy[0]!]
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1]!
    const [bx, by] = xy[i]!
    const parts = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / SAMPLE_M))
    for (let k = 1; k <= parts; k++) out.push([ax + ((bx - ax) * k) / parts, ay + ((by - ay) * k) / parts])
  }
  return out
}

interface Match {
  road: number
  /** Metres along the road. */
  at: number
  point: [number, number]
}

/** Metres along [road] at each of its points. */
const alongCache = new WeakMap<Road, number[]>()
function along(road: Road): number[] {
  let out = alongCache.get(road)
  if (!out) {
    out = [0]
    for (let i = 1; i < road.xy.length; i++) out.push(out[i - 1]! + Math.hypot(road.xy[i]![0] - road.xy[i - 1]![0], road.xy[i]![1] - road.xy[i - 1]![1]))
    alongCache.set(road, out)
  }
  return out
}

/** [piece] laid onto [roads] (see the file comment); [brt] prefers a busway. */
export function snapToRoads(piece: readonly LngLat[], roads: Roads, { brt = false }: { brt?: boolean } = {}): LngLat[] {
  if (piece.length < 2) return [...piece]
  const points = sample(piece.map(toXY))
  const matches: (Match | null)[] = []
  let previous: Match | null = null
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i]!
    const [px, py] = points[Math.max(0, i - 2)]!
    const [nx, ny] = points[Math.min(points.length - 1, i + 2)]!
    const hl = Math.hypot(nx - px, ny - py) || 1
    const hx = (nx - px) / hl
    const hy = (ny - py) / hl
    let best: Match | null = null
    let bestScore = Infinity
    for (const { road: r, i: s } of roads.near(x, y)) {
      const road = roads.roads[r]!
      const [ax, ay] = road.xy[s]!
      const [bx, by] = road.xy[s + 1]!
      const dx = bx - ax
      const dy = by - ay
      const l = Math.hypot(dx, dy)
      if (l === 0) continue
      const dot = (dx * hx + dy * hy) / l
      if (road.oneway ? dot < HEADING_COS : Math.abs(dot) < HEADING_COS) continue
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (l * l)))
      const qx = ax + t * dx
      const qy = ay + t * dy
      const d = Math.hypot(x - qx, y - qy)
      if (d > SNAP_M) continue
      const score = d
        - (previous && previous.road === r ? SAME_ROAD_M : 0)
        - (brt && road.busway ? BUSWAY_M : 0)
        + (road.bridge ? BRIDGE_M : 0)
      if (score < bestScore) {
        bestScore = score
        best = { road: r, at: along(road)[s]! + t * l, point: [qx, qy] }
      }
    }
    matches.push(best)
    previous = best
  }

  // Back to a line: matched points joined along their road where two in a row share one. A few
  // points between them matching nothing (the feed cutting a corner, its heading off the road's on
  // both sides) give way to the road too; more than GAP_POINTS is a stretch off the roads, kept.
  const out: [number, number][] = []
  const push = (p: [number, number]): void => {
    const last = out[out.length - 1]
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.1) out.push(p)
  }
  let last: Match | null = null
  let unmatched: [number, number][] = []
  for (let i = 0; i < points.length; i++) {
    const m = matches[i]
    if (!m) {
      unmatched.push(points[i]!)
      continue
    }
    if (last && last.road === m.road && unmatched.length <= GAP_POINTS) {
      const road = roads.roads[m.road]!
      const at = along(road)
      const lo = Math.min(last.at, m.at)
      const hi = Math.max(last.at, m.at)
      const between = road.xy.filter((_, k) => at[k]! > lo && at[k]! < hi)
      for (const p of last.at <= m.at ? between : [...between].reverse()) push(p)
    } else {
      for (const p of unmatched) push(p)
    }
    unmatched = []
    push(m.point)
    last = m
  }
  for (const p of unmatched) push(p)
  return out.map(toLngLat)
}
