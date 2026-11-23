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

/**
 * Off a toll road (OSM motorway), all but always: TransJakarta's koridors run on the street under it,
 * and the feed drawn nearer the toll took 9 up onto the Tol Dalam Kota above S. Parman.
 */
const MOTORWAY_M = 10

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

/**
 * A run of this many points or more (48 m) on one road is where the line surely is. Between two such
 * runs the line takes the roads' own way, routed, when the feed's goes off them: a corner cut across a
 * junction in one straight (8 from Tomang Raya onto S. Parman) snapped to whatever lay under it.
 */
const SURE_POINTS = 6

/** A route between two sure runs may be this much longer than the feed's way between them, and no more. */
const ROUTE_RATIO = 1.5
const ROUTE_SLACK_M = 40

/**
 * Nor may the feed between stray further than this from it: a corner the feed cuts or overshoots (8's V
 * by the busway's curve at Tomang) strays tens of metres, a way the bus really goes the route would skip
 * hundreds (11D up the spur to Gapura Rusun Pulo Jahe, 4 round Manggarai's one-way loop).
 */
const ROUTE_REACH_M = 80

/**
 * Nor may it take the line further from one of its haltes, near the feed between, than this beyond how
 * near the feed came: the feed goes there to call (11D up to the Gapura Rusun Pulo Jahe terminus).
 */
const ROUTE_HALTE_M = 15
const HALTE_NEAR_M = 50

/**
 * Within PLATFORM_NEAR_M of one of the line's platforms (its own side of a halte, from the feed's stop
 * ids) lying on a busway (within PLATFORM_ON_M), of the busways the bus's way passing within PLATFORM_M
 * of it, only those no more than PLATFORM_SLACK_M further from it than that one: of the lanes past a
 * halte, the one its bus calls at (6 on Galunggung's south lane, 4 on its north). A halte's own
 * coordinate lies between them. A platform off the busways says too little: Semanggi's lie between
 * Gatot Subroto and its toll road.
 */
const PLATFORM_NEAR_M = 50
const PLATFORM_M = 15
const PLATFORM_ON_M = 3
const PLATFORM_SLACK_M = 5

/** Platforms this near each other are one halte's, and say what they say together. */
const PLATFORM_HALTE_M = 30

/**
 * A halte of the line's within YARD_M of where a piece starts or ends, and further than YARD_HALTE_M
 * from every road, stands in a yard the tiles don't draw the lanes of: a terminal (Ragunan's halte is
 * 23 m off the road round it). Within YARD_M of it, a point
 * goes onto a road only within YARD_SNAP_M; the rest keep where the feed has them, the buses' way
 * through, past the halte and round the loop they turn by.
 */
const YARD_HALTE_M = 12
const YARD_M = 150
const YARD_SNAP_M = 8

/** Road points this near each other are one junction: z15 busways meet z14 roads a fraction of a metre off. */
const NODE_M = 1

/** What a metre costs on a route: a BRT's busway less, a flyover or toll road more. */
const BUSWAY_COST = 0.7
const BRIDGE_COST = 1.5
const MOTORWAY_COST = 3

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
  /** A busway's koridors, as its name has them ("Transjakarta Busway Koridor 4, 6"). */
  koridors?: string[]
}

/** The koridors a busway's [name] says it carries. */
export function koridorsOf(name: string): string[] {
  const listed = /Koridor\s+([\d,\s]+)/i.exec(name)
  return listed ? listed[1]!.split(/[,\s]+/).filter(Boolean) : []
}

/** The koridor family a line belongs to, by its code's number: 13 for 13, 13E and L13E. */
export function koridorOf(code: string): string | undefined {
  return /(\d+)/.exec(code)?.[1]
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
  private network?: RoadGraph

  /** The roads as one network, for routing; built on first use. */
  graph(): RoadGraph {
    return (this.network ??= new RoadGraph(this))
  }

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
              ...(detail === 'busway' ? { koridors: koridorsOf(String(f.properties.name ?? '')) } : {}),
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

/**
 * [piece] laid onto [roads] (see the file comment); [brt] prefers a busway, [stops] are the line's haltes,
 * [platforms] the sides of them its buses call at.
 */
export function snapToRoads(
  piece: readonly LngLat[],
  roads: Roads,
  { brt = false, anyWay = false, stops = [], platforms = [], koridor }: { brt?: boolean, anyWay?: boolean, stops?: readonly LngLat[], platforms?: readonly LngLat[], koridor?: string } = {}
): LngLat[] {
  if (piece.length < 2) return [...piece]
  const points = sample(piece.map(toXY))
  const sides = platforms.map(toXY)
  // Haltes at its ends the tiles draw no road by: a terminal's own lanes (Ragunan's), where the feed is
  // the way. Along the way, a halte off the roads is one beside a street the tiles leave out.
  const [fx, fy] = toXY(piece[0]!)
  const [lx, ly] = toXY(piece[piece.length - 1]!)
  const atEnd = ([hx, hy]: [number, number]): boolean => Math.min(Math.hypot(hx - fx, hy - fy), Math.hypot(hx - lx, hy - ly)) <= YARD_M
  const yards = stops.map(toXY).filter(atEnd).filter(([hx, hy]) => roads.near(hx, hy).every(({ road: r, i: s }) => {
    const xy = roads.roads[r]!.xy
    return distanceTo([xy[s]!, xy[s + 1]!], [hx, hy]) > YARD_HALTE_M
  }))
  // Each platform's halte: the platforms within PLATFORM_HALTE_M of it, itself among them.
  const together = sides.map(([ax, ay]) => sides.flatMap(([bx, by], k) => (Math.hypot(bx - ax, by - ay) <= PLATFORM_HALTE_M ? [k] : [])))
  // How far each road passes from each platform, as asked.
  const passing = new Map<string, number>()
  const fromPlatform = (r: number, k: number): number => {
    const key = `${r}:${k}`
    let d = passing.get(key)
    if (d === undefined) {
      d = distanceTo(roads.roads[r]!.xy, sides[k]!)
      passing.set(key, d)
    }
    return d
  }
  const matches: (Match | null)[] = []
  let previous: Match | null = null
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i]!
    const [px, py] = points[Math.max(0, i - 2)]!
    const [nx, ny] = points[Math.min(points.length - 1, i + 2)]!
    const hl = Math.hypot(nx - px, ny - py) || 1
    const hx = (nx - px) / hl
    const hy = (ny - py) / hl
    const candidates: { score: number, match: Match }[] = []
    const reach = yards.some(([hx, hy]) => Math.hypot(hx - x, hy - y) <= YARD_M) ? YARD_SNAP_M : SNAP_M
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
      if (d > reach) continue
      const score = d
        - (previous && previous.road === r ? SAME_ROAD_M : 0)
        - (brt && road.busway ? BUSWAY_M : 0)
        // A busway on a bridge named for the line's own koridor is its elevated lane (13 above Ciledug
        // and Tendean): its way, however near the street under it the feed runs. Another's (13's past
        // Blok M, over 1's own lane) is still off it.
        + (road.bridge && !(brt && koridor !== undefined && road.koridors?.includes(koridor)) ? BRIDGE_M : 0)
        + (road.motorway ? MOTORWAY_M : 0)
      candidates.push({ score, match: { road: r, at: along(road)[s]! + t * l, point: [qx, qy] } })
    }
    // Near its platforms on a busway, of the busways the bus's way past them, only the ones they're on. A
    // busway one platform is on stays, whatever another says: 4 calls at Pasar Rumput beside each of two
    // busways, one each way.
    const passed = new Set<number>()
    const kept = new Set<number>()
    const halte = new Set(sides.flatMap(([sx, sy], k) => (Math.hypot(sx - x, sy - y) <= PLATFORM_NEAR_M ? together[k]! : [])))
    for (const k of halte) {
      const past = candidates.filter(c => roads.roads[c.match.road]!.busway && fromPlatform(c.match.road, k) <= PLATFORM_M)
      if (past.length < 2) continue
      const nearest = Math.min(...past.map(c => fromPlatform(c.match.road, k)))
      if (nearest > PLATFORM_ON_M) continue
      for (const c of past) {
        passed.add(c.match.road)
        if (fromPlatform(c.match.road, k) <= nearest + PLATFORM_SLACK_M) kept.add(c.match.road)
      }
    }
    for (const c of candidates) if (passed.has(c.match.road) && !kept.has(c.match.road)) c.score = Infinity
    let best: Match | null = null
    let bestScore = Infinity
    for (const c of candidates) {
      if (c.score < bestScore) {
        bestScore = c.score
        best = c.match
      }
    }
    matches.push(best)
    previous = best
  }
  foldAsides(matches, points, roads)
  const routes = routeBetweenSure(matches, points, roads, { brt, anyWay }, stops.map(toXY))

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
  let lastIndex = -1
  let unmatched: [number, number][] = []
  for (let i = 0; i < points.length; i++) {
    const m = matches[i]
    if (!m) {
      unmatched.push(points[i]!)
      continue
    }
    // Routed from the last sure run to this one: along the roads, whatever the feed did between.
    const routed = routes.get(lastIndex)
    if (last && routed?.to === i) {
      for (const p of routed.path) push(p)
      unmatched = []
      last = m
      lastIndex = i
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
      // Off one road and onto another (or back from off the roads): by their nearest points. Where the
      // last ends on this one's way between its points (6's slip road off Purworejo, partway along
      // Latuharhari, 22 m on from its corner), at that point: its nearest would be back at the corner.
      const exit = last ? vertexAt(last) : null
      if (exit) push(exit)
      for (const p of unmatched) push(p)
      const onto = exit && unmatched.length === 0 ? nearestOn(roads.roads[m.road]!.xy, exit) : null
      push(onto && Math.hypot(onto[0] - exit![0], onto[1] - exit![1]) <= JOIN_M ? onto : vertexAt(m))
    }
    unmatched = []
    last = m
    lastIndex = i
  }
  if (last) push(vertexAt(last))
  for (const p of unmatched) push(p)
  return out.map(toLngLat)
}

/**
 * Each pair of sure runs (SURE_POINTS or more on one road) with anything else between them, or on two
 * roads: the roads' way from the one to the other, by the index of the first's last point, and the
 * points between matching nothing now. Only where the way is no more than ROUTE_RATIO the feed's.
 */
function routeBetweenSure(
  matches: (Match | null)[],
  points: readonly [number, number][],
  roads: Roads,
  options: { brt: boolean, anyWay: boolean },
  stops: readonly [number, number][]
): Map<number, { to: number, path: [number, number][] }> {
  const runs: { road: number, from: number, to: number }[] = []
  matches.forEach((m, i) => {
    if (!m) return
    const run = runs[runs.length - 1]
    if (run && run.road === m.road && i - run.to <= GAP_POINTS + 1) run.to = i
    else runs.push({ road: m.road, from: i, to: i })
  })
  const out = new Map<number, { to: number, path: [number, number][] }>()
  let previous = -1
  runs.forEach((run, k) => {
    if (run.to - run.from + 1 < SURE_POINTS) return
    const before = runs[previous]
    const adjacent = previous === k - 1
    previous = k
    if (!before) return
    // The same road straight on: joined along it as it is.
    if (before.road === run.road && adjacent) return
    let feed = 0
    for (let j = before.to + 1; j <= run.from; j++) feed += Math.hypot(points[j]![0] - points[j - 1]![0], points[j]![1] - points[j - 1]![1])
    const path = roads.graph().route(matches[before.to]!, matches[run.from]!, { ...options, limit: feed * ROUTE_RATIO + ROUTE_SLACK_M })
    if (!path) return
    const between = points.slice(before.to, run.from + 1)
    if (between.some(p => distanceTo(path, p) > ROUTE_REACH_M)) return
    for (const stop of stops) {
      const fed = distanceTo(between, stop)
      if (fed <= HALTE_NEAR_M && distanceTo(path, stop) > fed + ROUTE_HALTE_M) return
    }
    out.set(before.to, { to: run.from, path })
    for (let j = before.to + 1; j < run.from; j++) matches[j] = null
  })
  return out
}

/** The point of [path] nearest [p]. */
function nearestOn(path: readonly [number, number][], [x, y]: [number, number]): [number, number] {
  let best: [number, number] = path[0]!
  let bestD = Infinity
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1]!
    const [bx, by] = path[i]!
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2))
    const q: [number, number] = [ax + t * dx, ay + t * dy]
    const d = Math.hypot(q[0] - x, q[1] - y)
    if (d < bestD) {
      bestD = d
      best = q
    }
  }
  return best
}

/** How far [p] is from [path]. */
function distanceTo(path: readonly [number, number][], [x, y]: [number, number]): number {
  let best = Infinity
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1]!
    const [bx, by] = path[i]!
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2))
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy))
  }
  return best
}

/** Metres along [path]. */
function lengthOf(path: readonly [number, number][]): number {
  return path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1]), 0)
}

interface Link {
  to: number
  m: number
  /** The road it runs along; -1 for a step between two roads' points at one junction. */
  road: number
  /** Against a one-way road's direction: only for a bundle, which carries both ways. */
  against: boolean
}

/** A small binary heap of [cost, node], cheapest first. */
class Queue {
  private readonly items: [number, number][] = []

  get size(): number {
    return this.items.length
  }

  push(item: [number, number]): void {
    const items = this.items
    items.push(item)
    let i = items.length - 1
    while (i > 0) {
      const up = (i - 1) >> 1
      if (items[up]![0] <= items[i]![0]) break
      const swap = items[up]!
      items[up] = items[i]!
      items[i] = swap
      i = up
    }
  }

  pop(): [number, number] {
    const items = this.items
    const top = items[0]!
    const end = items.pop()!
    if (items.length > 0) {
      items[0] = end
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let least = i
        if (l < items.length && items[l]![0] < items[least]![0]) least = l
        if (r < items.length && items[r]![0] < items[least]![0]) least = r
        if (least === i) break
        const swap = items[least]!
        items[least] = items[i]!
        items[i] = swap
        i = least
      }
    }
    return top
  }
}

/**
 * The roads as one network: each road's points as nodes along it (one way only on a one-way road),
 * points of two roads within NODE_M joined as one junction, and a road's end within JOIN_M of another
 * road's way joined onto it there, that way split at the point (a road clipped at a tile's edge, a
 * busway's end on the street, a side street's end part-way along a long straight).
 */
export class RoadGraph {
  /** Each road's points, split where another road's end joins it, and the node of its first. */
  private readonly points: [number, number][][] = []
  private readonly alongs: number[][] = []
  private readonly base: number[] = []
  private readonly roadOf: number[] = []
  private readonly xy: [number, number][] = []
  private readonly next: Link[][] = []

  constructor(private readonly roads: Roads) {
    const list = roads.roads
    // Where each road's ends join another road's way: that way's segment, how far along it, the point.
    const splits = list.map(() => new Map<number, { t: number, point: [number, number], end: [number, number] }[]>())
    list.forEach((road, r) => {
      for (const end of [road.xy[0]!, road.xy[road.xy.length - 1]!]) {
        const [x, y] = end
        for (const s of roads.near(x, y)) {
          if (s.road === r) continue
          const [ax, ay] = list[s.road]!.xy[s.i]!
          const [bx, by] = list[s.road]!.xy[s.i + 1]!
          const dx = bx - ax
          const dy = by - ay
          const l2 = dx * dx + dy * dy
          if (l2 === 0) continue
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2))
          const point: [number, number] = [ax + t * dx, ay + t * dy]
          if (Math.hypot(x - point[0], y - point[1]) > JOIN_M) continue
          const at = splits[s.road]!.get(s.i) ?? []
          at.push({ t, point, end })
          splits[s.road]!.set(s.i, at)
        }
      }
    })
    list.forEach((road, r) => {
      const points: [number, number][] = []
      road.xy.forEach((p, k) => {
        points.push(p)
        for (const split of (splits[r]!.get(k) ?? []).sort((a, b) => a.t - b.t)) points.push(split.point)
      })
      const at = [0]
      for (let k = 1; k < points.length; k++) at.push(at[k - 1]! + Math.hypot(points[k]![0] - points[k - 1]![0], points[k]![1] - points[k - 1]![1]))
      this.points.push(points)
      this.alongs.push(at)
      this.base.push(this.xy.length)
      for (const p of points) {
        this.xy.push(p)
        this.roadOf.push(r)
        this.next.push([])
      }
    })
    const link = (a: number, b: number, road: number, against: boolean): void => {
      this.next[a]!.push({ to: b, m: Math.hypot(this.xy[b]![0] - this.xy[a]![0], this.xy[b]![1] - this.xy[a]![1]), road, against })
    }
    list.forEach((road, r) => {
      for (let k = 1; k < this.points[r]!.length; k++) {
        const a = this.base[r]! + k - 1
        link(a, a + 1, r, false)
        link(a + 1, a, r, road.oneway)
      }
    })
    // Points of two roads at one junction, a road's end and the split it joins at among them.
    const cells = new Map<string, number[]>()
    const cellOf = (x: number, y: number): [number, number] => [Math.floor(x / JOIN_M), Math.floor(y / JOIN_M)]
    this.xy.forEach(([x, y], id) => {
      const [cx, cy] = cellOf(x, y)
      const key = `${cx},${cy}`
      const ids = cells.get(key)
      if (ids) ids.push(id)
      else cells.set(key, [id])
    })
    const ends = new Set(list.flatMap((road, r) => [this.base[r]!, this.base[r]! + this.points[r]!.length - 1]))
    const splitPoints = new Set(splits.flatMap(m => [...m.values()].flat().map(s => `${s.point[0]},${s.point[1]}`)))
    this.xy.forEach(([x, y], id) => {
      const [cx, cy] = cellOf(x, y)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const other of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (other <= id || this.roadOf[other] === this.roadOf[id]) continue
            const d = Math.hypot(this.xy[other]![0] - x, this.xy[other]![1] - y)
            // Within NODE_M, one junction; within JOIN_M, a road's end and the split it joins.
            const joined = d <= NODE_M || (d <= JOIN_M && (
              (ends.has(id) && splitPoints.has(`${this.xy[other]![0]},${this.xy[other]![1]}`))
              || (ends.has(other) && splitPoints.has(`${x},${y}`))
            ))
            if (!joined) continue
            link(id, other, -1, false)
            link(other, id, -1, false)
          }
        }
      }
    })
  }

  private cost(road: number, brt: boolean): number {
    if (road < 0) return 1
    const r = this.roads.roads[road]!
    return (brt && r.busway ? BUSWAY_COST : 1) * (r.bridge ? BRIDGE_COST : 1) * (r.motorway ? MOTORWAY_COST : 1)
  }

  /**
   * The roads' way from match [from] to match [to], each on its road, no more than [limit] metres; null
   * when there's none. One-way roads only their way, unless [anyWay].
   */
  route(from: Match, to: Match, { brt, anyWay, limit }: { brt: boolean, anyWay: boolean, limit: number }): [number, number][] | null {
    const segmentOf = (m: Match): number => {
      const at = this.alongs[m.road]!
      let k = 0
      while (k < at.length - 2 && at[k + 1]! <= m.at) k++
      return k
    }
    const fromRoad = this.roads.roads[from.road]!
    const toRoad = this.roads.roads[to.road]!
    const fromAt = this.alongs[from.road]!
    const toAt = this.alongs[to.road]!
    const fk = segmentOf(from)
    const tk = segmentOf(to)
    const fw = this.cost(from.road, brt)
    const tw = this.cost(to.road, brt)
    let best = Infinity
    let path: [number, number][] | null = null
    // Along the one road, when both are on it and it runs that way.
    if (from.road === to.road && (to.at >= from.at || !fromRoad.oneway || anyWay)) {
      const lo = Math.min(from.at, to.at)
      const hi = Math.max(from.at, to.at)
      const between = this.points[from.road]!.filter((_, k) => fromAt[k]! > lo && fromAt[k]! < hi)
      best = (hi - lo) * fw
      path = [from.point, ...(from.at <= to.at ? between : between.reverse()), to.point]
    }
    const goals = new Map<number, number>()
    goals.set(this.base[to.road]! + tk, (to.at - toAt[tk]!) * tw)
    if (!toRoad.oneway || anyWay) goals.set(this.base[to.road]! + tk + 1, (toAt[tk + 1]! - to.at) * tw)
    const cost = new Map<number, number>()
    const previous = new Map<number, number>()
    const queue = new Queue()
    const seed = (id: number, c: number): void => {
      if (c < (cost.get(id) ?? Infinity)) {
        cost.set(id, c)
        queue.push([c, id])
      }
    }
    seed(this.base[from.road]! + fk + 1, (fromAt[fk + 1]! - from.at) * fw)
    if (!fromRoad.oneway || anyWay) seed(this.base[from.road]! + fk, (from.at - fromAt[fk]!) * fw)
    // Costs run below metres only on a busway: a route over [limit] metres costs at least this.
    const bound = limit * BUSWAY_COST
    let reached = -1
    while (queue.size > 0) {
      const [c, id] = queue.pop()
      if (c > (cost.get(id) ?? Infinity)) continue
      if (c >= best || c > bound) break
      const goal = goals.get(id)
      if (goal !== undefined && c + goal < best) {
        best = c + goal
        reached = id
      }
      for (const l of this.next[id]!) {
        if (l.against && !anyWay) continue
        const through = c + l.m * this.cost(l.road, brt)
        if (through < (cost.get(l.to) ?? Infinity)) {
          cost.set(l.to, through)
          previous.set(l.to, id)
          queue.push([through, l.to])
        }
      }
    }
    if (reached >= 0) {
      const nodes: [number, number][] = []
      let walk: number | undefined = reached
      while (walk !== undefined) {
        nodes.push(this.xy[walk]!)
        walk = previous.get(walk)
      }
      path = [from.point, ...nodes.reverse(), to.point]
    }
    return path && lengthOf(path) <= limit ? path : null
  }
}

/**
 * Whether one of [road] and [other] has an end on the other's way, within JOIN_M: one leads on from
 * the other there. Either way round: Purworejo ends partway along its slip road onto Latuharhari.
 */
function joins(road: Road, other: Road): boolean {
  return endsOn(road, other) || endsOn(other, road)
}

/** Whether [road] has an end on [other]'s way, within JOIN_M. */
function endsOn(road: Road, other: Road): boolean {
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
 * meet and must go on meeting. With [heading] (a unit vector in metres), only
 * onto a road running that way, either way: a node a bundle goes straight
 * through stays on its street, not pulled onto the side road meeting it there
 * (4 and 6 back up onto Jl. Galunggung, its straight bundle dipping 10 m).
 */
export function snapPoint(p: LngLat, roads: Roads, heading?: [number, number]): LngLat {
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
    if (heading && Math.abs(heading[0] * dx + heading[1] * dy) / Math.sqrt(l2) < ALONGSIDE_COS) continue
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
