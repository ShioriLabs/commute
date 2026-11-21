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

/**
 * TransJakarta's own lanes (OSM highway=busway) start at z15: at z14 the tiles carry 4 km of them,
 * where z15 has the koridors' medians. Busways are read from z15 then, the rest from z14.
 */
const BUSWAY_ZOOM = 15

/** A point every SAMPLE_M along a line, matched to a road within SNAP_M of it. */
const SAMPLE_M = 8
const SNAP_M = 30

/** A road counts when it runs within this of the bus's way, either way (both ways on a two-way road). */
const HEADING_COS = Math.cos((40 * Math.PI) / 180)

/*
 * Preferences, in metres off a road's distance: keep to the road the last
 * point was on (the feed's wobble shouldn't hop lanes), BRT on a busway, and
 * off a flyover unless the shape is clearly on it (Kuningan's runs over Rasuna
 * Said's busway). The busway's is strong: the feed's shapes often follow the
 * general carriageway, 10-15 m off the median lane the bus runs in (1 on
 * Sudirman, 9 on S. Parman).
 */
const SAME_ROAD_M = 8
const BUSWAY_M = 20
const BRIDGE_M = 12

/** Points matching no road between two on one road are a corner the feed cut, up to this many. */
const GAP_POINTS = 6

/** Two matches on one road further apart along it than this, for how far apart they are, aren't joined along it. */
const DETOUR_RATIO = 3
const DETOUR_SLACK_M = 50

/** A road's point this near a match, along it, is where the line hands over to the next road. */
const HANDOVER_M = 25

/**
 * A run of this many points or fewer (40 m) on a road that doesn't lead on from the road before it to
 * the one after (a ramp, a busway stub beside the street) is the feed wobbling onto it, not the bus.
 */
const ASIDE_POINTS = 5

/** A road's end this near another road's way joins it there. */
const JOIN_M = 3

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
  /** A toll road (OSM motorway): what parts a split road's two carriageways (Yos Sudarso at Walikota). */
  motorway?: boolean
}

/** A motorway runs alongside two points when within this of the way between them (SNAP_COS in busMapBundle). */
const ALONGSIDE_COS = Math.cos((35 * Math.PI) / 180)

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
  /**
   * Whether a motorway runs between [a] and [b], alongside a line heading [heading] (a unit vector)
   * there: the two sides of a road split by a toll road (Yos Sudarso under the Tanjung Priok toll at
   * Walikota), not one road. A motorway crossing over the line's street doesn't part them.
   */
  motorwayBetween([ax, ay]: [number, number], [bx, by]: [number, number], [hx, hy]: [number, number]): boolean {
    const dx = bx - ax
    const dy = by - ay
    if (dx === 0 && dy === 0) return false
    const seen = new Set<string>()
    for (const [x, y] of [[ax, ay], [(ax + bx) / 2, (ay + by) / 2], [bx, by]] as const) {
      for (const s of this.near(x, y)) {
        const key = `${s.road}:${s.i}`
        if (seen.has(key)) continue
        seen.add(key)
        const road = this.roads[s.road]!
        if (!road.motorway) continue
        const [cx, cy] = road.xy[s.i]!
        const [ex, ey] = road.xy[s.i + 1]!
        const fx = ex - cx
        const fy = ey - cy
        const fl = Math.hypot(fx, fy)
        if (fl === 0) continue
        // Alongside: running the line's way, either way.
        if (Math.abs((hx * fx + hy * fy) / fl) < ALONGSIDE_COS) continue
        // And between: the segments a..b and c..e cross.
        const den = dx * fy - dy * fx
        if (den === 0) continue
        const t = ((cx - ax) * fy - (cy - ay) * fx) / den
        const u = ((cx - ax) * dy - (cy - ay) * dx) / den
        if (t > 0 && t < 1 && u >= 0 && u <= 1) return true
      }
    }
    return false
  }

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
  // Each z14 tile, and its four z15 children for the busways.
  const list = [...tiles].flatMap((key) => {
    const [x, y] = key.split(',').map(Number) as [number, number]
    const scale = 2 ** (BUSWAY_ZOOM - TILE_ZOOM)
    const children: [number, number, number][] = []
    for (let dx = 0; dx < scale; dx++) for (let dy = 0; dy < scale; dy++) children.push([BUSWAY_ZOOM, x * scale + dx, y * scale + dy])
    return [[TILE_ZOOM, x, y] as [number, number, number], ...children]
  })
  const wanted = new Set(['roads'])
  // A few at a time: shirase serves them from its edge cache, and a first run fetches some hundreds.
  for (let i = 0; i < list.length; i += 8) {
    const batch = await Promise.all(list.slice(i, i + 8).map(async ([z, x, y]) => ({ z, x, y, bytes: await tileBytes(tileset, z, x, y) })))
    for (const { z, x, y, bytes } of batch) {
      if (!bytes) continue
      for (const layer of readTile(bytes, wanted)) {
        for (const f of layer.features) {
          if (f.type !== 2) continue
          const kind = String(f.properties.kind ?? '')
          const detail = String(f.properties.kind_detail ?? '')
          if (!DRIVABLE.has(kind) || NOT_DRIVABLE.has(detail)) continue
          if ((detail === 'busway') !== (z === BUSWAY_ZOOM)) continue
          for (const part of f.geometry) {
            if (part.length < 2) continue
            roads.push({
              xy: part.map(([px, py]) => toXY(tileLngLat(z, x, y, layer.extent, px, py))),
              oneway: f.properties.oneway === 'yes',
              busway: detail === 'busway',
              bridge: f.properties.is_bridge === true,
              motorway: detail === 'motorway'
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
export function snapToRoads(
  piece: readonly LngLat[],
  roads: Roads,
  { brt = false, anyWay = false }: { brt?: boolean, anyWay?: boolean } = {}
): LngLat[] {
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
      // A one-way only with the bus, unless [anyWay]: a bundle carries both ways and runs either.
      if (road.oneway && !anyWay ? dot < HEADING_COS : Math.abs(dot) < HEADING_COS) continue
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
  foldAsides(matches, points, roads)

  // Back to a line, made of the roads' own points only: every line along a road then has the very
  // same points there, so lines sharing it share it exactly, and where it hands over to the next
  // road it does at the road's point nearest, the node the two meet at. Matched points join along
  // their road where two in a row share one. A few points between them matching nothing (the feed
  // cutting a corner, its heading off the road's on both sides) give way to the road too; more than
  // GAP_POINTS is a stretch off the roads, kept as the feed has it.
  const out: [number, number][] = []
  const push = (p: [number, number]): void => {
    const last = out[out.length - 1]
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.1) out.push(p)
  }
  // Where a line hands over from one road to the next: the road's point nearest the match, the node
  // the two roads meet at, when it is that near; on a long straight drawn with a point at each end,
  // the nearest can be hundreds of metres off (koridor 14 jumped 290 m out and back by Kemayoran),
  // and the match itself is where the line is.
  const vertexAt = (m: Match): [number, number] => {
    const road = roads.roads[m.road]!
    const at = along(road)
    let k = 0
    for (let j = 1; j < at.length; j++) if (Math.abs(at[j]! - m.at) < Math.abs(at[k]! - m.at)) k = j
    return Math.abs(at[k]! - m.at) <= HANDOVER_M ? road.xy[k]! : m.point
  }
  let last: Match | null = null
  let unmatched: [number, number][] = []
  for (let i = 0; i < points.length; i++) {
    const m = matches[i]
    if (!m) {
      unmatched.push(points[i]!)
      continue
    }
    const road = roads.roads[m.road]!
    const at = along(road)
    const lo = last ? Math.min(last.at, m.at) : 0
    const hi = last ? Math.max(last.at, m.at) : 0
    const total = at[at.length - 1]!
    const [fx, fy] = road.xy[0]!
    const [tx, ty] = road.xy[road.xy.length - 1]!
    const ring = Math.hypot(fx - tx, fy - ty) < 1
    // How far along the road from the last match to this one, the short way round a ring.
    const alongWay = ring ? Math.min(hi - lo, total - (hi - lo)) : hi - lo
    // Much further along the road than apart is not one stretch of it but two arms of one feature: the
    // tiles draw both carriageways of a divided road, and the roundabout joining them, as one line
    // (Sisingamangaraja round Bundaran Senayan). Followed, a step across the median went round the
    // roundabout and back. Handed over like a change of road instead.
    const apart = last ? Math.hypot(m.point[0] - last.point[0], m.point[1] - last.point[1]) : 0
    const sameStretch = alongWay <= apart * DETOUR_RATIO + DETOUR_SLACK_M
    if (last && last.road === m.road && unmatched.length <= GAP_POINTS && sameStretch) {
      // A ring (a roundabout drawn as one closed road): across its seam is the short way round, not
      // back along all of it.
      if (ring && hi - lo > total / 2) {
        const tail = road.xy.filter((_, k) => at[k]! > hi && at[k]! < total)
        const head = road.xy.filter((_, k) => at[k]! > 0 && at[k]! < lo)
        // Forward past the seam (from late on the ring to early), or backward.
        const way = last.at > m.at ? [...tail, road.xy[0]!, ...head] : [...head].reverse().concat([road.xy[0]!], [...tail].reverse())
        for (const p of way) push(p)
      } else {
        const between = road.xy.filter((_, k) => at[k]! > lo && at[k]! < hi)
        for (const p of last.at <= m.at ? between : [...between].reverse()) push(p)
      }
    } else if (last && last.road === m.road && unmatched.length <= GAP_POINTS) {
      // Across from one arm of a road to another: straight between the two matches, the road's nearest
      // vertex along it being anywhere on a sparsely drawn arm.
      push(last.point)
      push(m.point)
    } else {
      // Off one road and onto another (or back from off the roads): by their nearest points.
      if (last) push(vertexAt(last))
      for (const p of unmatched) push(p)
      push(vertexAt(m))
    }
    unmatched = []
    last = m
  }
  if (last) push(vertexAt(last))
  for (const p of unmatched) push(p)
  return out.map(toLngLat)
}

/** Whether [road] has an end on [other]'s way, within JOIN_M: one leads on from the other there. */
function joins(road: Road, other: Road): boolean {
  return [road.xy[0]!, road.xy[road.xy.length - 1]!].some(([x, y]) => other.xy.some((a, i) => {
    const b = other.xy[i + 1]
    if (!b) return Math.hypot(x - a[0], y - a[1]) <= JOIN_M
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l2 = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2))
    return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) <= JOIN_M
  }))
}

/** [p] onto [road]'s nearest point, within SNAP_M; null when it's further. */
function project(roads: Roads, r: number, [x, y]: [number, number]): Match | null {
  const road = roads.roads[r]!
  const at = along(road)
  let best: Match | null = null
  let bestD = SNAP_M
  for (let i = 1; i < road.xy.length; i++) {
    const [ax, ay] = road.xy[i - 1]!
    const [bx, by] = road.xy[i]!
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy
    if (l2 === 0) continue
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2))
    const q: [number, number] = [ax + t * dx, ay + t * dy]
    const d = Math.hypot(x - q[0], y - q[1])
    if (d <= bestD) {
      bestD = d
      best = { road: r, at: at[i - 1]! + t * Math.sqrt(l2), point: q }
    }
  }
  return best
}

/**
 * [matches] with each short hop aside taken back: a run of ASIDE_POINTS or fewer on one road, between
 * runs on others, back onto the road it left or on a road not joining the ones either side of it (9
 * at Grogol: onto a ramp and straight back, onto a busway stub beside the street). Its [points] go
 * onto the nearer of the roads either side instead, or match nothing with neither near.
 */
function foldAsides(matches: (Match | null)[], points: readonly [number, number][], roads: Roads): void {
  let i = 0
  while (i < matches.length) {
    const m = matches[i]
    let j = i
    while (m && j + 1 < matches.length && matches[j + 1]?.road === m.road) j++
    const before = matches[i - 1]
    const after = matches[j + 1]
    if (m && before && after && j - i + 1 <= ASIDE_POINTS) {
      const road = roads.roads[m.road]!
      const aside = before.road === after.road || !joins(road, roads.roads[before.road]!) || !joins(road, roads.roads[after.road]!)
      if (aside) {
        for (let k = i; k <= j; k++) {
          const onto = [project(roads, before.road, points[k]!), project(roads, after.road, points[k]!)]
            .filter((q): q is Match => q !== null)
            .sort((p, q) => Math.hypot(p.point[0] - points[k]![0], p.point[1] - points[k]![1]) - Math.hypot(q.point[0] - points[k]![0], q.point[1] - points[k]![1]))
          matches[k] = onto[0] ?? null
        }
      }
    }
    i = j + 1
  }
}

/**
 * [p] onto the nearest point of any drivable road within SNAP_M, whichever way it
 * runs; as it is with none. For a junction of the network, where several edges
 * meet and must go on meeting.
 */
export function snapPoint(p: LngLat, roads: Roads): LngLat {
  const [x, y] = toXY(p)
  let best: [number, number] | null = null
  let bestD = SNAP_M
  for (const { road: r, i: s } of roads.near(x, y)) {
    const road = roads.roads[r]!
    const [ax, ay] = road.xy[s]!
    const [bx, by] = road.xy[s + 1]!
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy
    if (l2 === 0) continue
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2))
    const q: [number, number] = [ax + t * dx, ay + t * dy]
    const d = Math.hypot(x - q[0], y - q[1])
    if (d < bestD) {
      bestD = d
      best = q
    }
  }
  return best ? toLngLat(best) : p
}
