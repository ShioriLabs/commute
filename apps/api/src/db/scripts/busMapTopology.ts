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

/**
 * A track passing a halte twice within this, along it, turns round a hairpin at
 * it; further apart (6 round Latuharhari back past Flyover Kuningan) is a loop
 * the next leg takes.
 */
const HAIRPIN_M = 400

/** A halte set back from every shape (a temporary halte, a B-code) is looked for this far out. */
const FAR_M = 150

/** A run that starts within this of where the one before it ended is driven on to from there. */
const TERMINAL_LINK_M = 1000

/**
 * A trip starting or ending within FAR_M of a terminus, and within this along it of where the line
 * there is, starts or ends where the buses wait: its way between is the line's, a loop to turn included.
 */
const TERMINAL_EXTRA_M = 300

/** Shorter than this, the way from where a trip starts or ends is the feed shuffling about a bay (2 at Pulo Gadung). */
const TERMINAL_MIN_M = 20

/** A run ending this near where the next starts, within TERMINAL_JOIN_COS of straight on, is joined on to it. */
const TERMINAL_JOIN_M = 50
const TERMINAL_JOIN_COS = Math.cos((60 * Math.PI) / 180)

/**
 * The way a bus comes out from where it waits at terminus [h] to [p] on the line: the start of a trip
 * starting within FAR_M of [h], to where it first passes [p], within TERMINAL_EXTRA_M. Null when none.
 */
function lead(trips: readonly Track[], h: [number, number], p: [number, number]): [number, number][] | null {
  let best: [number, number][] | null = null
  for (const t of trips) {
    if (Math.hypot(t.xy[0]![0] - h[0], t.xy[0]![1] - h[1]) > FAR_M) continue
    const at = passes(t, p, NEAR_M).find(m => m <= TERMINAL_EXTRA_M)
    if (at === undefined || at < 1) continue
    const way = slice(t, 0, at)
    if (lengthOf(way) >= TERMINAL_MIN_M && (!best || lengthOf(way) > lengthOf(best))) best = way
  }
  if (best) best[best.length - 1] = p
  return best
}

/** The way a bus goes on from [p] on the line to where it waits at terminus [h]: lead, the other way. */
function tail(trips: readonly Track[], h: [number, number], p: [number, number]): [number, number][] | null {
  let best: [number, number][] | null = null
  for (const t of trips) {
    const end = t.at[t.at.length - 1]!
    if (Math.hypot(t.xy[t.xy.length - 1]![0] - h[0], t.xy[t.xy.length - 1]![1] - h[1]) > FAR_M) continue
    const ats = passes(t, p, NEAR_M).filter(m => end - m <= TERMINAL_EXTRA_M)
    if (ats.length === 0) continue
    const at = ats[ats.length - 1]!
    if (end - at < 1) continue
    const way = slice(t, at, end)
    if (lengthOf(way) >= TERMINAL_MIN_M && (!best || lengthOf(way) > lengthOf(best))) best = way
  }
  if (best) best[0] = p
  return best
}

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
  /**
   * Its trips' shapes whole, as the feed has them, each the way it runs: where [pieces] (deduped,
   * so a street once whichever way) only run a leg backwards, the trip that runs it.
   */
  feed?: LngLat[][]
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

/** How long [path] is, in metres. */
function lengthOf(path: readonly [number, number][]): number {
  let m = 0
  for (let i = 1; i < path.length; i++) m += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1])
  return m
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
  /** Whether the leg ran along the track; one run back up it has no way on to keep to. */
  forward: boolean
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
    // On the track the last leg ran along, only its next pass of [a]: a later one skips what's between.
    // A leg run back up a track (a trip the dedupe folded into the other way) has no next pass to keep
    // to: 9 from Pluit runs up the feed's round trip backwards to Jembatan Besi, and held to that pass,
    // Kali Grogol Arah Selatan was only reached back round by Cawang, 34 km, not 1 km on down the other
    // carriageway.
    // Of those passes from just before where it ended on, the nearest: a leg that went round a hairpin
    // to [a]'s second pass (8 at Grogol Reformasi, grazing it on Kyai Tapa, then past it on S. Parman
    // 93 m on) carries on from there, not back at the first to go round the corner twice.
    const carried = after?.track === t && after.forward ? fromA.filter(m => m >= after.at - 2 * NEAR_M) : []
    const starts = carried.length > 0 ? [carried.reduce((p, q) => (Math.abs(q - after!.at) < Math.abs(p - after!.at) ? q : p))] : fromA
    for (const from of starts) {
      for (const to of toB) {
        const length = Math.abs(to - from)
        if (length > limit) continue
        if (avoided.some(m => m > Math.min(from, to) + NEAR_M && m < Math.max(from, to) - NEAR_M)) continue
        const forward = to > from
        // How far on from the last leg's end this starts; Infinity when it doesn't carry on.
        const onward = after && after.track === t && after.forward && forward && from >= after.at - 2 * NEAR_M ? Math.abs(from - after.at) : Infinity
        const better = !best
          || (forward && !best.forward)
          || (forward === best.forward && onward < best.onward)
          || (forward === best.forward && onward === best.onward && length < best.length)
        if (better) best = { length, forward, onward, track: t, from, to }
      }
    }
  }
  if (!best) return null
  // A track passing [b] again soon after is turning round a hairpin at it (Koridor 2 at Gambir 2,
  // up one road and back down the next): the leg goes round, to the last such pass.
  if (best.forward) {
    const to = best.to
    const again = passes(best.track, b, near).filter(m => m > to && m - to <= HAIRPIN_M)
    if (again.length > 0) best = { ...best, to: Math.max(...again) }
  }
  return { path: slice(best.track, best.from, best.to), track: best.track, at: best.to, forward: best.forward }
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
    const trips = (line.feed ?? []).filter(p => p.length >= 2).map(p => track(line.code, p))
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
    const runs = topo.runs.map(run => run.filter(code => haltes[code]))
    for (const placed of runs) for (const code of placed) if (!calls.includes(code)) calls.push(code)
    // A run starting near but not where the one before it ended (round from the last to the first):
    // the bus drives on from the one to the other to turn, 14 from Senen TOYOTA Rangga round by Senen
    // Raya. That leg goes at the start of the run.
    const linked = runs.map((placed, r) => {
      const before = runs[(r + runs.length - 1) % runs.length]!
      const end = before[before.length - 1]
      if (runs.length < 2 || !end || !placed[0] || end === placed[0]) return placed
      const [, eLng, eLat] = haltes[end]!
      const [, sLng, sLat] = haltes[placed[0]]!
      const [ex, ey] = toXY([eLng, eLat])
      const [sx, sy] = toXY([sLng, sLat])
      return Math.hypot(sx - ex, sy - ey) <= TERMINAL_LINK_M ? [end, ...placed] : placed
    })
    for (const placed of linked) {
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
          // One of its trips, the way it runs, from [a] to [b] calling at no halte the posters dropped
          // nor any other of the run's: the bus's own way, a loop to turn included (4 round by Manggarai).
          const trip = (): [number, number][] | null => {
            const between = placed.filter((_, j) => j !== i - 1 && j !== i).map(code => toXY([haltes[code]![1], haltes[code]![2]]))
            const find = (near: number): Picked | null => {
              const found = stretch(trips, a, b, { near, detours: true, avoid: [...dropped, ...between] })
              return found?.forward && lengthOf(found.path) <= Math.hypot(b[0] - a[0], b[1] - a[1]) * OWN_REACH + 2 * FAR_M ? found : null
            }
            // Out of a terminus, its trips may start off from the halte, where the buses wait: 9's at
            // Pluit 1, 97 m on past Pluit.
            return (find(NEAR_M) ?? (i === 1 && k === 1 ? find(FAR_M) : null))?.path ?? null
          }
          const elsewhere = (way: [number, number][] | null | undefined): [number, number][] | null => {
            if (way) cursor = null
            return way ?? null
          }
          const ownWay = (options: Parameters<typeof stretch>[3] = {}): [number, number][] | null => {
            const picked = stretch(own, a, b, { ...options, after: cursor })
            // Run back up a piece: the street kept the other way by the pattern dedupe, which folds a trip
            // into the opposite direction of the same streets. A trip running it has the bus's own turns:
            // 6 from Galunggung down Gembira and its ramp onto Rasuna Said, not back over the bridge to
            // the far carriageway; 4 to Pasar Rumput round its loop by Manggarai.
            if (picked && !picked.forward) {
              const way = trip()
              if (way) return elsewhere(way)
            }
            if (picked) cursor = picked
            return picked?.path ?? null
          }
          // Out of a terminus, the way a trip starting there goes: one passing it on the way out isn't
          // there yet (13E from Flyover Kuningan, round by Cokroaminoto before it comes back past on the
          // flyover, 33 m off).
          const outOf = (): [number, number][] | null => {
            if (i !== 1 || k !== 1) return null
            const between = placed.filter((_, j) => j !== i - 1 && j !== i).map(code => toXY([haltes[code]![1], haltes[code]![2]]))
            const limit = Math.hypot(b[0] - a[0], b[1] - a[1]) * OWN_REACH + 2 * FAR_M
            let best: [number, number][] | null = null
            for (const t of trips) {
              if (Math.hypot(t.xy[0]![0] - a[0], t.xy[0]![1] - a[1]) > NEAR_M) continue
              // From where it passes nearest the halte on its way out, not the bay it pulls out of (1's at
              // Blok M, 13 m off the street: a tick on the map).
              const from = passes(t, a, NEAR_M)[0] ?? 0
              const to = passes(t, b, NEAR_M).find(m => m > from + NEAR_M)
              if (to === undefined || to - from > limit) continue
              if ([...dropped, ...between].some(p => passes(t, p, NEAR_M).some(m => m > from + NEAR_M && m < to - NEAR_M))) continue
              if (!best || to - from < lengthOf(best)) best = slice(t, from, to)
            }
            return best
          }
          let piece = elsewhere(outOf())
            ?? ownWay()
            // Its own long way round, calling at no halte the posters dropped: a loop to turn, as 6's
            // from Flyover Kuningan by Latuharhari back down Rasuna Said to Gembira. A reroute (1 via
            // Petojo, 6 via Halimun) calls at haltes its line no longer serves, and isn't taken.
            ?? ownWay({ detours: true, avoid: dropped })
            // The same across its own pieces, each the way it runs: a loop the feed split from the
            // trunk it rejoins (6 back down Rasuna Said and into Gembira).
            ?? elsewhere((ownGraph ??= new StreetGraph(own, { directed: true })).route(a, b, { near: NEAR_M, avoid: dropped }))
            // A trip the pattern dedupe folded into the opposite direction of the same streets, whole in
            // the feed: 6 from Galunggung down Gembira and its ramp onto Rasuna Said.
            ?? elsewhere(trip())
            // Its own pieces either way: a trip folded into the other direction that no trip runs whole.
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
          // At a terminus, the way its buses go on to where they wait, or come from it: 9 on past Pluit to
          // Pluit 1; 6 on past Ragunan, and back out round its loop.
          if (i === placed.length - 1 && k === stops.length - 1) {
            const on = tail(trips, b, piece[piece.length - 1]!)
            if (on) piece = [...piece, ...on.slice(1)]
          }
          if (i === 1 && k === 1) {
            const out = lead(trips, a, piece[0]!)
            if (out) piece = [...out.slice(0, -1), ...piece]
          }
          const last = path[path.length - 1]
          // A way found from the halte itself (a graph route, a straight line) starts at its
          // coordinate, off the street; the leg before already reached it, so join on from there.
          const fromHalte = last && piece.length > 1 && piece[0]![0] === a[0] && piece[0]![1] === a[1]
          const same = last && last[0] === piece[0]![0] && last[1] === piece[0]![1]
          path.push(...(same || fromHalte ? piece.slice(1) : piece))
        }
      }
      const clean = despike(path)
      if (clean.length >= 2) drawn.push(clean.map(toLngLat))
    }
    // A run ending just short of where the next starts, on ahead (6 in to Ragunan, out from its loop 25 m
    // on), goes on to it. One beside it (1's out of Blok M's bay, 12 m off the street) is left.
    if (drawn.length >= 2) {
      drawn.forEach((piece, r) => {
        const next = drawn[(r + 1) % drawn.length]![0]!
        const [ex, ey] = toXY(piece[piece.length - 1]!)
        const [px, py] = toXY(piece[Math.max(0, piece.length - 2)]!)
        const [nx, ny] = toXY(next)
        const gap = Math.hypot(nx - ex, ny - ey)
        const run = Math.hypot(ex - px, ey - py)
        const ahead = run > 0 && ((ex - px) * (nx - ex) + (ey - py) * (ny - ey)) / (run * gap) >= TERMINAL_JOIN_COS
        if (gap > 0.5 && gap <= TERMINAL_JOIN_M && ahead) piece.push([...next] as LngLat)
      })
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
