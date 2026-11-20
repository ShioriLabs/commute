import type { LngLat } from '../../utils/polyline'

/*
 * Peta Bus draws each koridor where it normally runs, not where the feed last
 * sent it. The GTFS shapes carry TransJakarta's reroutes as if they were the
 * line: koridor 1 via Petojo (the feed's Monas/Thamrin diversion), its western
 * protest-day loop, 6 via Halimun, 8's old Grogol/Roxy alignment. The routing
 * graph already ignores them, its koridors taken from the official route
 * posters (db/data/topology.tj.overrides.ts over the feed-derived topology).
 *
 * So a koridor with a topology is redrawn along it: between each pair of its
 * consecutive haltes, the stretch of a GTFS shape that really runs from one to
 * the other, its own where it has one and else another line's down the same
 * street (Harmoni -> Monas -> Kebon Sirih for koridor 1, from the lines that
 * still run past Monas). A stretch is only taken when it is not much longer
 * than the haltes are apart, which is exactly what rules out a detour. Lines
 * with no topology (the branches and Angkutan Umum Integrasi) keep their
 * shapes.
 */

/** How close a shape must pass a halte to serve it: haltes sit in the median or at the kerb. */
const NEAR_M = 50

/** A stretch between two haltes may be this much longer than the straight line, and no more. */
const DETOUR_FACTOR = 2
const DETOUR_SLACK_M = 400

/** A halte set back from every shape (a temporary halte, a B-code) is looked for this far out. */
const FAR_M = 150

const KX = Math.cos((-6.2 * Math.PI) / 180) * 111_320
const KY = 110_574

export interface TopologyLine {
  code: string
  /** The koridor's runs as halte codes: `path`, and `pathReverse` where it differs. */
  runs: string[][]
  /**
   * Points a halte pair's way must pass, by `from->to` halte code: for a way the
   * shapes can't tell, where the only street there is (6 from Galunggung onto
   * Rasuna Said, by Jl. Gembira) isn't the one the search would find.
   */
  via?: Record<string, LngLat[]>
}

export interface AlignInput {
  code: string
  pieces: LngLat[][]
  /** The haltes the feed has the line call at: the ones its topology drops mark a reroute. */
  stops?: string[]
}

export interface Aligned {
  /** Each line's pieces: redrawn for a koridor with a topology, as given otherwise. */
  pieces: Map<string, LngLat[][]>
  /** Each redrawn koridor's haltes, in run order. */
  stops: Map<string, string[]>
  /** Halte pairs no shape ran between, drawn straight: worth a look after a feed change. */
  straight: string[]
}

interface Track {
  code: string
  xy: [number, number][]
  /** Metres along the track at each point. */
  at: number[]
}

const toXY = ([lng, lat]: LngLat): [number, number] => [lng * KX, lat * KY]
const toLngLat = ([x, y]: [number, number]): LngLat => [x / KX, y / KY]

function track(code: string, piece: readonly LngLat[]): Track {
  const xy = piece.map(toXY)
  const at = [0]
  for (let i = 1; i < xy.length; i++) at.push(at[i - 1]! + Math.hypot(xy[i]![0] - xy[i - 1]![0], xy[i]![1] - xy[i - 1]![1]))
  return { code, xy, at }
}

/** Where along [t] it passes within NEAR_M of [p]: the nearest point of each pass. */
function passes(t: Track, [px, py]: [number, number], near: number): number[] {
  const out: number[] = []
  let best = Infinity
  let bestAt = -1
  for (let i = 1; i < t.xy.length; i++) {
    const [ax, ay] = t.xy[i - 1]!
    const [bx, by] = t.xy[i]!
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy || 1
    const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
    const d = Math.hypot(px - (ax + u * dx), py - (ay + u * dy))
    const along = t.at[i - 1]! + u * Math.sqrt(l2)
    if (d <= near) {
      if (d < best) {
        best = d
        bestAt = along
      }
    } else if (bestAt >= 0) {
      out.push(bestAt)
      best = Infinity
      bestAt = -1
    }
  }
  if (bestAt >= 0) out.push(bestAt)
  return out
}

/** The piece of [t] from [from] to [to] metres along it, turned round when [to] comes first. */
function slice(t: Track, from: number, to: number): [number, number][] {
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const point = (m: number): [number, number] => {
    let i = 1
    while (i < t.at.length - 1 && t.at[i]! < m) i++
    const a = t.xy[i - 1]!
    const b = t.xy[i]!
    const span = t.at[i]! - t.at[i - 1]! || 1
    const u = Math.max(0, Math.min(1, (m - t.at[i - 1]!) / span))
    return [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])]
  }
  const out: [number, number][] = [point(lo)]
  for (let i = 0; i < t.xy.length; i++) if (t.at[i]! > lo && t.at[i]! < hi) out.push(t.xy[i]!)
  out.push(point(hi))
  return from <= to ? out : out.reverse()
}

/** Where the last leg left a koridor's own track: the next leg carries on from there. */
interface Cursor {
  track: Track
  at: number
}

interface Picked extends Cursor {
  path: [number, number][]
}

/**
 * The shortest stretch of any of [tracks] from [a] to [b] that isn't a detour;
 * one running the right way first, then one running the other way. With
 * [detours], any length will do, but not a stretch passing any of [avoid].
 *
 * After [after], a stretch carrying on along the same track from there comes
 * first, the nearest pass of [a] after it: a track that passes a halte twice
 * (6 by Flyover Kuningan, then back down the other carriageway beside it)
 * would otherwise skip the loop between the two.
 */
function stretch(
  tracks: readonly Track[],
  a: [number, number],
  b: [number, number],
  { near = NEAR_M, detours = false, avoid = [], after = null }:
  { near?: number, detours?: boolean, avoid?: readonly [number, number][], after?: Cursor | null } = {}
): Picked | null {
  const straight = Math.hypot(b[0] - a[0], b[1] - a[1])
  const limit = detours ? Infinity : Math.max(straight * DETOUR_FACTOR, straight + DETOUR_SLACK_M)
  let best: { length: number, forward: boolean, onward: number, track: Track, from: number, to: number } | null = null
  for (const t of tracks) {
    const fromA = passes(t, a, near)
    if (fromA.length === 0) continue
    const toB = passes(t, b, near)
    const avoided = avoid.flatMap(p => passes(t, p, NEAR_M))
    // On the track the last leg ended on, only its next pass of [a]: a later one skips what's between.
    const carried = after?.track === t ? fromA.filter(m => m >= after.at - 2 * NEAR_M) : []
    const starts = carried.length > 0 ? [Math.min(...carried)] : fromA
    for (const from of starts) {
      for (const to of toB) {
        const length = Math.abs(to - from)
        if (length > limit) continue
        if (avoided.some(m => m > Math.min(from, to) + NEAR_M && m < Math.max(from, to) - NEAR_M)) continue
        const forward = to > from
        // How far on from the last leg's end this starts; Infinity when it doesn't carry on.
        const onward = after && after.track === t && forward && from >= after.at - 2 * NEAR_M ? Math.abs(from - after.at) : Infinity
        const better = !best
          || (forward && !best.forward)
          || (forward === best.forward && onward < best.onward)
          || (forward === best.forward && onward === best.onward && length < best.length)
        if (better) best = { length, forward, onward, track: t, from, to }
      }
    }
  }
  return best ? { path: slice(best.track, best.from, best.to), track: best.track, at: best.to } : null
}

/** Points along the street graph's tracks at most this far apart, so crossing lines find each other. */
const GRAPH_STEP_M = 20

/** Tracks running within this of each other are joined there: a bus can turn from one street onto the other. */
const GRAPH_JOIN_M = 25

/**
 * How far round a line's own pieces may go between two haltes, as a multiple of
 * how far apart they are: its loops to turn are long for the haltes they join
 * (6 from Flyover Kuningan round by Latuharhari to Galunggung, 2.5 km for 510 m).
 */
const OWN_REACH = 8

/**
 * Every line's shapes as one street graph, for the last resort: the shortest
 * way between two haltes along streets some line drives, hopping from one line
 * to another where they meet. Only ever asked for a few pairs, so built once,
 * on first use.
 */
class StreetGraph {
  private readonly xy: [number, number][] = []
  private readonly next: { to: number, m: number }[][] = []
  private readonly cells = new Map<string, number[]>()

  private readonly directed: boolean
  /** One line's own pieces: joined only at their ends, and searched further round. */
  private readonly own: boolean

  /**
   * [own]: one line's pieces, joined to each other only at their ends, as they
   * join (a branch leaving the trunk, a loop rejoining it), never where they
   * merely cross: Galunggung crosses Rasuna Said, but 6 can only turn onto it by
   * Gembira. [directed]: each only the way it runs, as well. Without either, every
   * line's streets both ways, joined wherever they meet.
   */
  constructor(tracks: readonly Track[], { own = false, directed = false }: { own?: boolean, directed?: boolean } = {}) {
    this.own = own || directed
    this.directed = directed
    const cell = (x: number, y: number): string => `${Math.floor(x / GRAPH_JOIN_M)},${Math.floor(y / GRAPH_JOIN_M)}`
    const add = (p: [number, number]): number => {
      const id = this.xy.length
      this.xy.push(p)
      this.next.push([])
      const key = cell(p[0], p[1])
      const list = this.cells.get(key)
      if (list) list.push(id)
      else this.cells.set(key, [id])
      return id
    }
    const link = (a: number, b: number, bothWays: boolean): void => {
      const m = Math.hypot(this.xy[b]![0] - this.xy[a]![0], this.xy[b]![1] - this.xy[a]![1])
      this.next[a]!.push({ to: b, m })
      if (bothWays) this.next[b]!.push({ to: a, m })
    }
    const trackOf: number[] = []
    const ends: number[] = []
    tracks.forEach((t, ti) => {
      let previous = -1
      const added = (id: number): number => {
        trackOf[id] = ti
        return id
      }
      for (let i = 0; i < t.xy.length; i++) {
        const p = t.xy[i]!
        if (i > 0) {
          const q = t.xy[i - 1]!
          const parts = Math.floor(Math.hypot(p[0] - q[0], p[1] - q[1]) / GRAPH_STEP_M)
          for (let k = 1; k < parts; k++) {
            const id = added(add([q[0] + ((p[0] - q[0]) * k) / parts, q[1] + ((p[1] - q[1]) * k) / parts]))
            link(previous, id, !directed)
            previous = id
          }
        }
        const id = added(add(p))
        if (previous >= 0) link(previous, id, !directed)
        else ends.push(id)
        previous = id
      }
      ends.push(previous)
    })
    if (this.own) {
      // A piece's ends join the other pieces close by, both ways: where it leaves them and rejoins.
      for (const id of ends) {
        for (const other of this.near(this.xy[id]!, GRAPH_JOIN_M)) if (trackOf[other] !== trackOf[id]) link(id, other, true)
      }
    } else {
      // Joins between tracks: every point to the points of other tracks close by.
      for (let id = 0; id < this.xy.length; id++) {
        for (const other of this.near(this.xy[id]!, GRAPH_JOIN_M)) if (other > id && !this.next[id]!.some(e => e.to === other)) link(id, other, true)
      }
    }
  }

  private gap(id: number, [x, y]: [number, number]): number {
    return Math.hypot(this.xy[id]![0] - x, this.xy[id]![1] - y)
  }

  private near([x, y]: [number, number], radius: number): number[] {
    const out: number[] = []
    const cx = Math.floor(x / GRAPH_JOIN_M)
    const cy = Math.floor(y / GRAPH_JOIN_M)
    const reach = Math.ceil(radius / GRAPH_JOIN_M)
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (const id of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const p = this.xy[id]!
          if (Math.hypot(p[0] - x, p[1] - y) <= radius) out.push(id)
        }
      }
    }
    return out
  }

  /**
   * The shortest way from [a] to [b] along the graph, from and to points within
   * [near] of each, passing none of [avoid].
   */
  route(
    a: [number, number],
    b: [number, number],
    { near = FAR_M, avoid = [] }: { near?: number, avoid?: readonly [number, number][] } = {}
  ): [number, number][] | null {
    // Directed, only the nearest point: a halte by both carriageways is called at from one, the
    // way the bus came, and starting on the other would skip the loop between them.
    const around = this.near(a, near)
    const starts = this.directed && around.length > 0
      ? [around.reduce((p, q) => (this.gap(q, a) < this.gap(p, a) ? q : p))]
      : around
    const goals = new Set(this.near(b, near))
    const blocked = new Set(avoid.flatMap(p => this.near(p, NEAR_M)))
    if (starts.length === 0 || goals.size === 0) return null
    const cost = new Map<number, number>()
    const previous = new Map<number, number>()
    // A plain array as the queue: the graph is searched for a handful of pairs, each local.
    const open: [number, number][] = []
    for (const s of starts) {
      const c = Math.hypot(this.xy[s]![0] - a[0], this.xy[s]![1] - a[1])
      cost.set(s, c)
      open.push([c, s])
    }
    const straight = Math.hypot(b[0] - a[0], b[1] - a[1])
    while (open.length > 0) {
      let best = 0
      for (let i = 1; i < open.length; i++) if (open[i]![0] < open[best]![0]) best = i
      const [c, at] = open.splice(best, 1)[0]!
      if (c > cost.get(at)!) continue
      if (c > straight * (this.own ? OWN_REACH : 4) + FAR_M * 2) return null
      if (goals.has(at)) {
        const path: [number, number][] = [b]
        let walk: number | undefined = at
        while (walk !== undefined) {
          path.push(this.xy[walk]!)
          walk = previous.get(walk)
        }
        path.push(a)
        return path.reverse()
      }
      for (const { to, m } of this.next[at]!) {
        if (blocked.has(to)) continue
        const through = c + m
        if (through < (cost.get(to) ?? Infinity)) {
          cost.set(to, through)
          previous.set(to, at)
          open.push([through, to])
        }
      }
    }
    return null
  }
}

/** Redraws each koridor with a topology along it (see the file comment). */
export function alignToTopology(
  lines: readonly AlignInput[],
  haltes: Record<string, [string, number, number]>,
  topology: readonly TopologyLine[]
): Aligned {
  const tracksOf = new Map<string, Track[]>()
  for (const line of lines) tracksOf.set(line.code, line.pieces.filter(p => p.length >= 2).map(p => track(line.code, p)))
  const everyTrack = [...tracksOf.values()].flat()
  const byCode = new Map(topology.map(t => [t.code, t]))

  const pieces = new Map<string, LngLat[][]>()
  const stops = new Map<string, string[]>()
  const straight: string[] = []
  let graph: StreetGraph | undefined
  for (const line of lines) {
    const topo = byCode.get(line.code)
    if (!topo) {
      pieces.set(line.code, line.pieces.map(p => [...p]))
      continue
    }
    const own = tracksOf.get(line.code) ?? []
    const others = everyTrack.filter(t => t.code !== line.code)
    // The haltes the feed has it call at that its topology doesn't: where a reroute went.
    const onTopology = new Set(topo.runs.flat())
    let ownGraph: StreetGraph | undefined
    let ownEitherWay: StreetGraph | undefined
    const dropped = (line.stops ?? [])
      .filter(code => !onTopology.has(code) && haltes[code])
      .map(code => toXY([haltes[code]![1], haltes[code]![2]]))
    const drawn: LngLat[][] = []
    const calls: string[] = []
    for (const run of topo.runs) {
      const placed = run.filter(code => haltes[code])
      for (const code of placed) if (!calls.includes(code)) calls.push(code)
      const path: [number, number][] = []
      // Where the last leg left the koridor's own track, for the next to carry on from.
      let cursor: Cursor | null = null
      for (let i = 1; i < placed.length; i++) {
        const [, aLng, aLat] = haltes[placed[i - 1]!]!
        const [, bLng, bLat] = haltes[placed[i]!]!
        // Through the pair's waypoints, if it has any: each leg found on its own.
        const via = topo.via?.[`${placed[i - 1]}->${placed[i]}`] ?? []
        const stops = [[aLng, aLat] as LngLat, ...via, [bLng, bLat] as LngLat].map(toXY)
        for (let k = 1; k < stops.length; k++) {
          const a = stops[k - 1]!
          const b = stops[k]!
          const ownWay = (options: Parameters<typeof stretch>[3] = {}): [number, number][] | null => {
            const picked = stretch(own, a, b, { ...options, after: cursor })
            if (picked) cursor = picked
            return picked?.path ?? null
          }
          const elsewhere = (way: [number, number][] | null | undefined): [number, number][] | null => {
            if (way) cursor = null
            return way ?? null
          }
          let piece = ownWay()
            // Its own long way round, calling at no halte the posters dropped: a loop to turn, as 6's
            // from Flyover Kuningan by Latuharhari back down Rasuna Said to Gembira. A reroute (1 via
            // Petojo, 6 via Halimun) calls at haltes its line no longer serves, and isn't taken.
            ?? ownWay({ detours: true, avoid: dropped })
            // The same across its own pieces, each the way it runs: a loop the feed split from the
            // trunk it rejoins (6 back down Rasuna Said and into Gembira).
            ?? elsewhere((ownGraph ??= new StreetGraph(own, { directed: true })).route(a, b, { near: NEAR_M, avoid: dropped }))
            // Its own pieces either way: a trip the pattern dedupe folded into the opposite direction of
            // the same street (6 from Galunggung by Gembira and Rasuna Said, drawn only the other way).
            ?? elsewhere((ownEitherWay ??= new StreetGraph(own, { own: true })).route(a, b, { near: NEAR_M, avoid: dropped }))
            ?? elsewhere(stretch(others, a, b)?.path)
            // No street runs there plainly: a halte set back from the road (FAR_M), else the line's own
            // way however roundabout, which is at least where its buses drive.
            ?? ownWay({ near: FAR_M }) ?? elsewhere(stretch(others, a, b, { near: FAR_M })?.path)
            ?? ownWay({ near: FAR_M, detours: true })
            // A koridor's new way no one shape covers yet (6 straight from Galunggung to Setiabudi):
            // across every line's streets, hopping between them where they meet.
            ?? elsewhere((graph ??= new StreetGraph(everyTrack)).route(a, b))
          if (!piece) {
            straight.push(`${line.code} ${placed[i - 1]}->${placed[i]}`)
            piece = [a, b]
          }
          const last = path[path.length - 1]
          path.push(...(last && last[0] === piece[0]![0] && last[1] === piece[0]![1] ? piece.slice(1) : piece))
        }
      }
      const clean = despike(path)
      if (clean.length >= 2) drawn.push(clean.map(toLngLat))
    }
    pieces.set(line.code, drawn.length > 0 ? drawn : line.pieces.map(p => [...p]))
    stops.set(line.code, calls)
  }
  return { pieces, stops, straight }
}

/** Whether [pieces] pass within NEAR_M of ([lng], [lat]): a halte a redrawn koridor still drives past. */
export function passesBy(pieces: readonly LngLat[][], lng: number, lat: number): boolean {
  const p = toXY([lng, lat])
  return pieces.some(piece => piece.length >= 2 && passes(track('', piece), p, NEAR_M).length > 0)
}

/** A path going a short way out and turning straight back is a spike, not a street. */
const SPIKE_M = 80
const SPIKE_COS = Math.cos((165 * Math.PI) / 180)

/**
 * [path] without its out-and-back spikes: where a leg ends at the tip of one of
 * the line's pieces and the next carries on from there back the way it came (6
 * off Gembira, up Rasuna Said to where its piece began, and back down). A tip
 * goes when the path reaches it within SPIKE_M and turns straight back.
 */
export function despike(path: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const p of path) {
    out.push(p)
    while (out.length >= 3) {
      const a = out[out.length - 3]!
      const tip = out[out.length - 2]!
      const back = out[out.length - 1]!
      const ox = tip[0] - a[0]
      const oy = tip[1] - a[1]
      const rx = back[0] - tip[0]
      const ry = back[1] - tip[1]
      const out1 = Math.hypot(ox, oy)
      const ret = Math.hypot(rx, ry)
      if (out1 === 0) {
        out.splice(out.length - 2, 1)
        continue
      }
      if (ret === 0 || out1 > SPIKE_M || (ox * rx + oy * ry) / (out1 * ret) > SPIKE_COS) break
      out.splice(out.length - 2, 1)
    }
  }
  return out
}
