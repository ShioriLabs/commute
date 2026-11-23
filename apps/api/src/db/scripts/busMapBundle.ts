import highsLoader, { type LegacyHighs } from 'highs'
import { decodePolyline, encodePolyline, simplify, type LngLat } from '../../utils/polyline'

/*
 * Peta Bus's lines laid side by side where they share a street, as Transit
 * draws them, rather than each painted over the last: on Thamrin, koridor 1
 * vanished under 6A and 6B.
 *
 * The lines are first turned into one network (buildNetwork): every line is
 * walked in BUNDLE ORDER (koridors first, by number, then the other lines), a
 * point every SAMPLE_M along it, and each point snaps onto a point of the
 * network already drawn when one lies within SNAP_M and runs the same way (or
 * the opposite way: a street is shared whichever way the buses go). Otherwise
 * it becomes a new point. So the first line down a street draws it, every
 * later line on it rides the same points, and every edge of the network
 * knows exactly which lines run along it.
 *
 * Edges carrying the same lines are then joined end to end (chains), and the
 * chains meeting straight on at a junction are turned to run the same way, so
 * the order across them holds through the junction instead of flipping. Each
 * chain ships once, with its lines in bundle order from left to right along
 * its direction: a client draws line i of n at offset (i - (n - 1) / 2) line
 * widths, MapLibre's `line-offset`, and lines keep their places street to
 * street.
 */

/*
 * A point every SAMPLE_M along each line. Fine enough that a corner stays a
 * corner after the chains are simplified, coarse enough to keep the network
 * small.
 */
const SAMPLE_M = 10

/*
 * How close a line must run to a street already drawn, and how nearly the same
 * way, to share it. Wide enough for both carriageways of an arterial: a line
 * whose shape goes up one and back down the other (koridor 1 on Thamrin, 31 m
 * apart, one out-and-back piece the pattern dedupe can't split) is drawn once,
 * as Transit draws it. A street a block over (1H and 1R, 200 m west of
 * Thamrin) stays its own.
 */
const SNAP_M = 40
const SNAP_COS = Math.cos((35 * Math.PI) / 180)

/*
 * A piece's own last OWN_REACH_M are not a street for it to snap onto: every
 * point lies within SNAP_M of the one before it, and legs closing in on each
 * other that soon are a hairpin, not two carriageways of one street. Koridor 2
 * goes up the park road to Gambir 2, turns round and comes back down the road
 * beside it, 40 m over; merged, those legs drew a knot. A piece going out and
 * back for kilometres (koridor 1 up Thamrin) still merges, but for its tip.
 */
const OWN_REACH_M = 500
const OWN_TAIL = Math.ceil(OWN_REACH_M / SAMPLE_M)

/** An edge leaving a node and coming back to it shorter than this is a hook, not a loop to draw. */
const LOOP_EDGE_MIN_M = 150

/**
 * [list]'s chains cut at the termini along them (Network.termini), each part its own chain, so the
 * lines ending there may take each side in their own order (pairRules). Last, once the network's
 * shape is settled: a loop's two halves would read as a bubble.
 */
export function splitAtTermini(network: Network, list: readonly Chain[]): Chain[] {
  return list.flatMap((chain) => {
    const parts: Chain[] = []
    let from = 0
    for (let k = 1; k < chain.path.length - 1; k++) {
      if (!network.termini?.has(chain.path[k]!)) continue
      parts.push({ path: chain.path.slice(from, k + 1), lines: chain.lines })
      from = k
    }
    parts.push({ path: chain.path.slice(from), lines: chain.lines })
    return parts
  })
}

/**
 * [list] without its short loops: a chain off the network and back to the point it left, under
 * LOOP_EDGE_MIN_M round, is no street but a short-turn pattern hooking off the road at its end (9
 * toward Cawang Sentral, a 73 m teardrop off the bundle by Transjakarta Pintu 1, no halte on it). A
 * terminal loop round a block runs far longer.
 */
export function dropShortLoops(network: Network, list: readonly Chain[]): Chain[] {
  return list.filter(chain => chain.path[0] !== chain.path[chain.path.length - 1] || chainLength(network, chain) >= LOOP_EDGE_MIN_M)
}

/** A piece within SNAP_M of what's drawn for less than this, and off it either side, is beside it, not on it. */
const SHARED_MIN_M = 100

/*
 * A rail line and a bus line share a stretch only where they run as one, as
 * Transit draws Metrobus 3 beside Metro 3 down Av. Universidad: the track under
 * or over the road itself, LRT Jabodebek over Rasuna Said with 6 (6 to 10 m
 * apart, at the middle), MRT M under Sudirman and Thamrin between koridor 1's
 * carriageways (18 m). A track beside the road is its own way, though within
 * SNAP_M: the Cikarang line on the canal bank by Jl. Galunggung, 21 m from 6 and
 * 13E, drew into their bundle, and along Jl. Bekasi Timur 30 m from 11. Judged
 * on the whole stretch, its median distance, so a viaduct edging off the median
 * for a block doesn't break away.
 */
const RAIL_SHARE_M = 20

/** And for this long at least: shorter, a track and a road brush past or cross (12 by Kampung Bandan, 100 m). */
const RAIL_SHARE_MIN_M = 300

/*
 * A piece coming back onto what's drawn after a stretch of its own, at a link
 * doubling back on its way (sharper than OVERSHOOT_TURN), ran past the corner it
 * turns at: koridor 1 west along Trunojoyo past Sisingamangaraja at CSW, 20 m on,
 * then back to it, a V off the junction. Its last points, up to OVERSHOOT_M of
 * them, are taken back until it joins from where the turn is a turn.
 */
const OVERSHOOT_M = 30
const OVERSHOOT_TURN_COS = Math.cos((110 * Math.PI) / 180)

/** Two snapped points not yet joined are bridged along the network when it has a path this short. */
const BRIDGE_HOPS = 6
const BRIDGE_STRETCH = 2.5

/** Chains meeting at a junction within this of straight on keep one direction through it. */
const STRAIGHT_COS = Math.cos((40 * Math.PI) / 180)

/** The same tolerance the line shapes are simplified with. */
const SIMPLIFY_M = 4

const KX = Math.cos((-6.2 * Math.PI) / 180) * 111_320
const KY = 110_574

export interface BundleLine {
  code: string
  /** A koridor, an Angkutan Umum Integrasi line, or a rail line (code `KCI:C`), bundled as a koridor's equal. */
  kind: 'BRT' | 'AUI' | 'RAIL'
  /** The line's pieces, as drawn: each a polyline. */
  pieces: LngLat[][]
  /**
   * Its route colour: lines of one colour on a street are one stroke there (strokesOf), as Transit
   * draws New York's A, C and E as one blue. Absent, the line is a stroke of its own.
   */
  color?: string
  /**
   * Where its trips turn round: the ends of its runs. Lines ending at one may change places there,
   * under the halte's mark, at no cost (TERMINUS_M).
   */
  termini?: LngLat[]
}

/*
 * Lines drawn as one stroke where they share a street: those of one route
 * colour. 13, 13E and L13E are one purple along the Ciledug busway; three
 * stripes of it said nothing a reader could tell apart. Line order and the
 * bundles' shifts are worked out over strokes, so a stroke's lines sit side by
 * side in an edge's `lines`, and a client draws each run of one colour there
 * as one line width.
 */

/** Each line's stroke: its colour, or the line itself without one. */
export function strokeKeys(lines: readonly Pick<BundleLine, 'code' | 'color'>[]): Map<string, string> {
  return new Map(lines.map(l => [l.code, l.color ? `#${l.color.replace(/^#/, '').toUpperCase()}` : l.code]))
}

/** How many strokes [lines] make, by [strokeOf]. */
export function strokeCount(lines: readonly string[], strokeOf: ReadonlyMap<string, string>): number {
  return new Set(lines.map(l => strokeOf.get(l) ?? l)).size
}

export interface BusMapEdge {
  /** Encoded polyline (Google, precision 5). Its direction is what left and right mean. */
  shape: string
  /** Line codes from left to right along the shape. */
  lines: string[]
  /** The bundle moved this many line widths right of the shape (bundleShifts); absent when centred. */
  shift?: number
}

/**
 * Koridors and rail lines before the other lines, as equals, then by code: `1`, `1A`, `1B`, `2`, ...
 * `13`, `KCI:B`, `KCI:C`, `MRTJ:M`.
 */
export function bundleOrder(lines: readonly Pick<BundleLine, 'code' | 'kind'>[]): string[] {
  const first = (kind: BundleLine['kind']): boolean => kind !== 'AUI'
  return [...lines]
    .sort((a, b) => {
      if (first(a.kind) !== first(b.kind)) return first(a.kind) ? -1 : 1
      return a.code.localeCompare(b.code, 'en', { numeric: true })
    })
    .map(l => l.code)
}

/**
 * A rail line's width against a bus line's, as clients draw it (Android's RAIL_LINE_WEIGHT in
 * BusMap.kt; change them together): a halte's bar is placed across the strokes by these widths.
 */
export const RAIL_WEIGHT = 1.5

/** A rail line's code: its line key, `KCI:C`; no bus code has a colon. */
export function isRailCode(code: string): boolean {
  return code.includes(':')
}

interface Point {
  x: number
  y: number
  /** Unit direction of the line that drew it. */
  ux: number
  uy: number
  /** The piece that drew it, and how far along: its own last few points aren't snapped onto. */
  piece: number
  index: number
  /** Drawn by a rail line: a bus line shares it only where they run as one (RAIL_SHARE_M). */
  rail: boolean
}

/** Points every SAMPLE_M along a polyline, with every vertex kept, in metres. */
function resample(coords: readonly LngLat[]): [number, number][] {
  const xy = coords.map(([lng, lat]) => [lng * KX, lat * KY] as [number, number])
  const out: [number, number][] = []
  for (let i = 0; i < xy.length; i++) {
    const [bx, by] = xy[i]!
    if (i > 0) {
      const [ax, ay] = xy[i - 1]!
      const length = Math.hypot(bx - ax, by - ay)
      const parts = Math.floor(length / SAMPLE_M)
      for (let p = 1; p < parts; p++) out.push([ax + ((bx - ax) * p) / parts, ay + ((by - ay) * p) / parts])
    }
    const last = out[out.length - 1]
    if (!last || last[0] !== bx || last[1] !== by) out.push([bx, by])
  }
  return out
}

const edgeKey = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

export interface Network {
  points: Point[]
  /** Undirected edge `a|b` -> the lines along it. */
  edges: Map<string, Set<string>>
  adjacency: Map<number, Set<number>>
  /** The point each line's termini lie on -> the lines ending there, each where it ends (BundleLine.termini). */
  termini?: Map<number, Map<string, [number, number]>>
}

/*
 * A line's terminus lies on the point of the network carrying it nearest, within
 * this. There a chain ends, and lines ending there may swap sides for nothing:
 * two lines round one terminal loop, both ways along the street to it, must
 * cross once somewhere (4 and 6 round Galunggung's block), and are best crossed
 * under the terminus's mark, not where the loop leaves the street.
 */
const TERMINUS_M = 30

/*
 * Lines ending this far apart or more at one terminus end in lanes of their own,
 * and lie there as they do: 6 on Galunggung's south busway, 4 on the north (12 m),
 * as the street zoom draws them (each line's own lane, by its GTFS platform). They
 * cross on the street instead, where it goes straight on round the loop: there a
 * line passing twice (passesThrough) crosses for SPLIT_CROSSING, under its way
 * back landing on the street (roundJunctions moves the node there).
 */
const LANES_APART_M = 4

/** Whether two points, in metres, of a line heading [heading] lie either side of something keeping their streets apart. */
export type KeptApart = (a: [number, number], b: [number, number], heading: [number, number]) => boolean

/**
 * How the network is built. [railApart]: two rail lines share a stretch only as a rail line and a bus
 * line do (RAIL_SHARE_M for RAIL_SHARE_MIN_M), not wherever they pass within SNAP_M: a subway's lines
 * crossing at a shallow angle (New York's 1/2/3 and N/Q/R/W at Times Sq, 150 m within 20 m) cross,
 * where Jakarta's few rail lines sharing a track run as one either way.
 */
export interface NetworkOptions { railApart?: boolean }

export function buildNetwork(lines: readonly BundleLine[], keptApart: KeptApart = () => false, options: NetworkOptions = {}): Network {
  const order = bundleOrder(lines)
  const byCode = new Map(lines.map(l => [l.code, l]))
  const points: Point[] = []
  const grid = new Map<string, number[]>()
  const edges = new Map<string, Set<string>>()
  const adjacency = new Map<number, Set<number>>()
  const cell = (x: number, y: number): string => `${Math.floor(x / SNAP_M)},${Math.floor(y / SNAP_M)}`

  const addPoint = (p: Point): number => {
    const id = points.length
    points.push(p)
    const key = cell(p.x, p.y)
    const list = grid.get(key)
    if (list) list.push(id)
    else grid.set(key, [id])
    return id
  }

  /** Takes back a point a piece has just made: its links, and its place for later pieces to snap onto. */
  const unmake = (id: number): void => {
    for (const n of adjacency.get(id) ?? []) {
      edges.delete(edgeKey(id, n))
      adjacency.get(n)?.delete(id)
    }
    adjacency.delete(id)
    const p = points[id]!
    const key = cell(p.x, p.y)
    grid.set(key, (grid.get(key) ?? []).filter(k => k !== id))
  }

  const link = (a: number, b: number, code: string): void => {
    const key = edgeKey(a, b)
    const set = edges.get(key)
    if (set) set.add(code)
    else edges.set(key, new Set([code]))
    if (!adjacency.has(a)) adjacency.set(a, new Set())
    if (!adjacency.has(b)) adjacency.set(b, new Set())
    adjacency.get(a)!.add(b)
    adjacency.get(b)!.add(a)
  }

  /** The network's shortest path a..b in hops, if within BRIDGE_HOPS and not much longer than the gap. */
  const bridge = (a: number, b: number): number[] | null => {
    const pa = points[a]!
    const pb = points[b]!
    const limit = Math.hypot(pb.x - pa.x, pb.y - pa.y) * BRIDGE_STRETCH + SAMPLE_M
    const previous = new Map<number, number>([[a, -1]])
    let frontier = [a]
    for (let hop = 0; hop < BRIDGE_HOPS && frontier.length > 0; hop++) {
      const next: number[] = []
      for (const at of frontier) {
        for (const to of adjacency.get(at) ?? []) {
          if (previous.has(to)) continue
          previous.set(to, at)
          if (to === b) {
            const path = [b]
            let walk = at
            while (walk !== -1) {
              path.push(walk)
              walk = previous.get(walk)!
            }
            path.reverse()
            let length = 0
            for (let i = 1; i < path.length; i++) {
              const p = points[path[i - 1]!]!
              const q = points[path[i]!]!
              length += Math.hypot(q.x - p.x, q.y - p.y)
            }
            return length <= limit ? path : null
          }
          next.push(to)
        }
      }
      frontier = next
    }
    return null
  }

  let pieceId = 0
  // Each piece's line, and its end points, for joining a loose end to its line after.
  const pieceCode: string[] = []
  const ends: { id: number, piece: number }[] = []
  for (const code of order) {
    const line = byCode.get(code)!
    const rail = line.kind === 'RAIL'
    for (const piece of line.pieces) {
      pieceCode[pieceId] = code
      const samples = resample(piece)
      if (samples.length < 2) {
        pieceId++
        continue
      }
      const heading = (i: number): [number, number] => {
        const [nx, ny] = samples[Math.min(i + 1, samples.length - 1)]!
        const [px, py] = samples[Math.max(i - 1, 0)]!
        const dl = Math.hypot(nx - px, ny - py) || 1
        return [(nx - px) / dl, (ny - py) / dl]
      }
      /**
       * The nearest point within SNAP_M running the same way (either way) that sample [i] may snap
       * onto; with [across], one drawn by the other kind (rail for a bus line, bus for a rail line)
       * alone, and without, one of the other kind only where [acrossOk] lets it.
       */
      const nearest = (i: number, othersOnly: boolean, across = false): number => {
        const [x, y] = samples[i]!
        const [ux, uy] = heading(i)
        let best = -1
        let bestD = SNAP_M
        const cx = Math.floor(x / SNAP_M)
        const cy = Math.floor(y / SNAP_M)
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (const id of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
              const p = points[id]!
              if (p.piece === pieceId && (othersOnly || i - p.index < OWN_TAIL)) continue
              const other = p.rail !== rail || (options.railApart === true && rail && pieceCode[p.piece] !== code)
              if (across ? !other : other && !acrossOk[i]) continue
              if (Math.abs(p.ux * ux + p.uy * uy) < SNAP_COS) continue
              // Either side of a toll road: a split road's two sides, drawn as two (Yos Sudarso).
              if (keptApart([x, y], [p.x, p.y], [ux, uy])) continue
              const d = Math.hypot(p.x - x, p.y - y)
              if (d <= bestD) {
                bestD = d
                best = id
              }
            }
          }
        }
        return best
      }
      // Where it runs by the other kind's lines, each stretch as a whole: shared if, at its middle,
      // they're as one (RAIL_SHARE_M).
      const acrossOk = samples.map(() => true)
      const acrossD = samples.map((_, i) => {
        const id = nearest(i, true, true)
        return id < 0 ? Infinity : Math.hypot(points[id]!.x - samples[i]![0], points[id]!.y - samples[i]![1])
      })
      for (let a = 0; a < acrossD.length;) {
        if (acrossD[a] === Infinity) {
          a++
          continue
        }
        let b = a
        while (b < acrossD.length && acrossD[b] !== Infinity) b++
        const run = acrossD.slice(a, b).sort((m, n) => m - n)
        const median = run[Math.floor(run.length / 2)]!
        if (median > RAIL_SHARE_M || (b - a) * SAMPLE_M < RAIL_SHARE_MIN_M) for (let k = a; k < b; k++) acrossOk[k] = false
        a = b
      }
      // The stretches where the piece would snap onto what's drawn before it, measured first: one
      // shorter than SHARED_MIN_M, the piece off it on both sides, is a street running close by, not
      // the same one (the one-way pair either side of the canal from Harmoni to Pecenongan, 35 m
      // apart for a few dozen metres): there the piece keeps its own way.
      const sharing = samples.map((_, i) => nearest(i, true) >= 0)
      const apart = sharing.map(() => false)
      for (let a = 0; a < sharing.length;) {
        if (!sharing[a]) {
          a++
          continue
        }
        let b = a
        while (b < sharing.length && sharing[b]) b++
        if (a > 0 && b < sharing.length && (b - a) * SAMPLE_M < SHARED_MIN_M) for (let k = a; k < b; k++) apart[k] = true
        a = b
      }

      let previous = -1
      // The points this piece has made since it was last on what's drawn, in order.
      let own: number[] = []
      for (let i = 0; i < samples.length; i++) {
        const [x, y] = samples[i]!
        const [ux, uy] = heading(i)
        let best = nearest(i, false)
        if (apart[i] && best >= 0 && points[best]!.piece !== pieceId) best = -1
        const at = best >= 0 ? best : addPoint({ x, y, ux, uy, piece: pieceId, index: i, rail })
        if (best < 0) own.push(at)
        else {
          // Back onto the network: past the corner first? Then from where it turns.
          let taken = 0
          while (own.length >= 2 && own[own.length - 1] === previous && taken < OVERSHOOT_M) {
            const tip = points[own[own.length - 1]!]!
            const before = points[own[own.length - 2]!]!
            const target = points[at]!
            const ix = tip.x - before.x
            const iy = tip.y - before.y
            const jx = target.x - tip.x
            const jy = target.y - tip.y
            const il = Math.hypot(ix, iy)
            const jl = Math.hypot(jx, jy)
            if (il === 0 || jl === 0 || (ix * jx + iy * jy) / (il * jl) >= OVERSHOOT_TURN_COS) break
            unmake(own.pop()!)
            previous = own[own.length - 1]!
            taken += il
          }
          own = []
        }
        if (previous >= 0 && at !== previous) {
          const known = adjacency.get(previous)?.has(at)
          const path = known ? null : bridge(previous, at)
          if (path) for (let k = 1; k < path.length; k++) link(path[k - 1]!, path[k]!, code)
          else link(previous, at, code)
        }
        if (i === 0) ends.push({ id: at, piece: pieceId })
        previous = at
      }
      if (previous >= 0) ends.push({ id: previous, piece: pieceId })
      pieceId++
    }
  }
  // A piece's end left loose beside its own line, across it rather than along it, so not snapped,
  // joins it: 4 and 6 back up onto the canal road at Galunggung, deduped where they turn east onto
  // it, stubbed 9 m past it. The nearest point of the line's other pieces within SNAP_M.
  for (const { id, piece } of ends) {
    const p = points[id]!
    if (p.piece !== piece || adjacency.get(id)?.size !== 1) continue
    const code = pieceCode[piece]!
    let best = -1
    let bestD = SNAP_M
    const cx = Math.floor(p.x / SNAP_M)
    const cy = Math.floor(p.y / SNAP_M)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const q = points[other]!
          if (q.piece === piece || pieceCode[q.piece] !== code || !adjacency.has(other)) continue
          if (keptApart([p.x, p.y], [q.x, q.y], [p.ux, p.uy])) continue
          const d = Math.hypot(q.x - p.x, q.y - p.y)
          if (d <= bestD) {
            bestD = d
            best = other
          }
        }
      }
    }
    // With every line on the end's edge: a line snapped onto this piece ends here too (6 onto 4's).
    if (best < 0) continue
    const [next] = adjacency.get(id)!
    for (const line of edges.get(edgeKey(id, next!)) ?? [code]) link(id, best, line)
  }
  const termini = new Map<number, Map<string, [number, number]>>()
  for (const line of lines) {
    for (const [lng, lat] of line.termini ?? []) {
      const [x, y] = [lng * KX, lat * KY]
      let best = -1
      let bestD = TERMINUS_M
      const cx = Math.floor(x / SNAP_M)
      const cy = Math.floor(y / SNAP_M)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const id of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (![...adjacency.get(id) ?? []].some(n => edges.get(edgeKey(id, n))?.has(line.code))) continue
            const d = Math.hypot(points[id]!.x - x, points[id]!.y - y)
            if (d <= bestD) {
              bestD = d
              best = id
            }
          }
        }
      }
      if (best < 0) continue
      const here = termini.get(best) ?? new Map<string, [number, number]>()
      if (!here.has(line.code)) here.set(line.code, [x, y])
      termini.set(best, here)
    }
  }
  return { points, edges, adjacency, termini }
}

const sameLines = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every(c => b.has(c))

export interface Chain {
  /** Point ids, end to end. */
  path: number[]
  lines: Set<string>
}

/** The network's edges joined end to end wherever a point joins exactly two edges carrying the same lines. */
export function chains(network: Network): Chain[] {
  const { edges, adjacency } = network
  const linesOf = (a: number, b: number): Set<string> => edges.get(edgeKey(a, b))!
  const isJoint = (n: number): boolean => {
    const next = [...(adjacency.get(n) ?? [])]
    return next.length === 2 && sameLines(linesOf(n, next[0]!), linesOf(n, next[1]!))
  }
  const used = new Set<string>()
  const out: Chain[] = []
  const walk = (from: number, to: number): number[] => {
    const path = [from, to]
    used.add(edgeKey(from, to))
    let previous = from
    let at = to
    while (isJoint(at)) {
      const next = [...adjacency.get(at)!].find(n => n !== previous)!
      const key = edgeKey(at, next)
      if (used.has(key)) break
      used.add(key)
      path.push(next)
      previous = at
      at = next
    }
    return path
  }
  // From every end and junction first, then whatever is left: loops of joints.
  for (const [n, next] of adjacency) {
    if (isJoint(n)) continue
    for (const m of next) {
      if (used.has(edgeKey(n, m))) continue
      out.push({ path: walk(n, m), lines: linesOf(n, m) })
    }
  }
  for (const key of edges.keys()) {
    if (used.has(key)) continue
    const [a, b] = key.split('|').map(Number) as [number, number]
    out.push({ path: walk(a, b), lines: linesOf(a, b) })
  }
  return out
}

/**
 * Turns chains so the ones meeting straight on at a junction run the same way:
 * left and right then mean the same on both, and the lines along them keep
 * their order through it. Greedy, straightest pairs first; a junction that
 * can't be satisfied keeps the first choice.
 */
export function orient(network: Network, list: Chain[]): void {
  const { points } = network
  // Union-find with parity: flip[i] relative to its root.
  const parent = list.map((_, i) => i)
  const parity = list.map(() => 0)
  const find = (i: number): [number, number] => {
    let p = 0
    let at = i
    while (parent[at] !== at) {
      p ^= parity[at]!
      at = parent[at]!
    }
    return [at, p]
  }
  const join = (a: number, b: number, differ: number): void => {
    const [ra, pa] = find(a)
    const [rb, pb] = find(b)
    if (ra === rb) return
    parent[rb] = ra
    parity[rb] = pa ^ pb ^ differ
  }

  // The direction a chain leaves a point it ends at, over its first ~30 m.
  const leaving = (chain: Chain, atStart: boolean): [number, number] => {
    const path = atStart ? chain.path : [...chain.path].reverse()
    const from = points[path[0]!]!
    let to = points[path[path.length - 1]!]!
    for (const id of path.slice(1)) {
      const p = points[id]!
      if (Math.hypot(p.x - from.x, p.y - from.y) >= 30) {
        to = p
        break
      }
    }
    const d = Math.hypot(to.x - from.x, to.y - from.y) || 1
    return [(to.x - from.x) / d, (to.y - from.y) / d]
  }

  const ends = new Map<number, { chain: number, atStart: boolean }[]>()
  list.forEach((chain, i) => {
    for (const atStart of [true, false]) {
      const n = atStart ? chain.path[0]! : chain.path[chain.path.length - 1]!
      const at = ends.get(n) ?? []
      at.push({ chain: i, atStart })
      ends.set(n, at)
    }
  })
  const pairs: { a: number, b: number, differ: number, straightness: number }[] = []
  for (const at of ends.values()) {
    for (let i = 0; i < at.length; i++) {
      for (let j = i + 1; j < at.length; j++) {
        const ea = at[i]!
        const eb = at[j]!
        if (ea.chain === eb.chain) continue
        const [ax, ay] = leaving(list[ea.chain]!, ea.atStart)
        const [bx, by] = leaving(list[eb.chain]!, eb.atStart)
        const dot = ax * bx + ay * by
        if (dot > -STRAIGHT_COS) continue
        // Straight on: one should arrive and the other leave. Both start (or both end) here: flip one.
        pairs.push({ a: ea.chain, b: eb.chain, differ: ea.atStart === eb.atStart ? 1 : 0, straightness: -dot })
      }
    }
  }
  pairs.sort((p, q) => q.straightness - p.straightness)
  for (const { a, b, differ } of pairs) join(a, b, differ)
  list.forEach((chain, i) => {
    if (find(i)[1] === 1) chain.path.reverse()
  })
}

/*
 * A chain shorter than this, between two chains carrying the same lines as each
 * other, is a snap that missed (a line dropping out of its bundle for a few
 * points, or one slipping in), not a street the lines part on: it takes their
 * lines, so the bundle doesn't shuffle sideways and back.
 */
const FLICKER_M = 60

function chainLength(network: Network, chain: Chain): number {
  let m = 0
  for (let i = 1; i < chain.path.length; i++) {
    const a = network.points[chain.path[i - 1]!]!
    const b = network.points[chain.path[i]!]!
    m += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return m
}

/** Settles short flickers (FLICKER_M); whether any changed. */
export function smooth(network: Network, list: Chain[]): boolean {
  const at = new Map<number, number[]>()
  list.forEach((chain, i) => {
    for (const n of [chain.path[0]!, chain.path[chain.path.length - 1]!]) {
      const here = at.get(n) ?? []
      here.push(i)
      at.set(n, here)
    }
  })
  let changed = false
  for (const [i, chain] of list.entries()) {
    if (chainLength(network, chain) >= FLICKER_M) continue
    const start = (at.get(chain.path[0]!) ?? []).filter(j => j !== i)
    const end = (at.get(chain.path[chain.path.length - 1]!) ?? []).filter(j => j !== i)
    if (start.length !== 1 || end.length !== 1 || start[0] === end[0]) continue
    const around = list[start[0]!]!.lines
    if (!sameLines(around, list[end[0]!]!.lines) || sameLines(around, chain.lines)) continue
    for (let k = 1; k < chain.path.length; k++) network.edges.set(edgeKey(chain.path[k - 1]!, chain.path[k]!), new Set(around))
    chain.lines = new Set(around)
    changed = true
  }
  return changed
}

/*
 * Two chains joining the same two points are one street drawn twice: a line
 * that missed its snaps for a stretch went round beside the bundle and came
 * back. Not far apart, since anything further than BUBBLE_GAP_M from the other
 * chain is a real second street (a one-way pair, a loop round a block).
 */
const BUBBLE_GAP_M = 60

/** The furthest any point of [from] lies from the polyline [to], in metres. */
function gap(network: Network, from: Chain, to: Chain): number {
  let worst = 0
  for (const id of from.path) {
    const p = network.points[id]!
    let best = Infinity
    for (let i = 1; i < to.path.length; i++) {
      const a = network.points[to.path[i - 1]!]!
      const b = network.points[to.path[i]!]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const l2 = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
      best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)))
    }
    worst = Math.max(worst, best)
  }
  return worst
}

/** Folds each bubble into its fuller side (BUBBLE_GAP_M); whether any was folded. */
export function popBubbles(network: Network, list: Chain[]): boolean {
  const between = new Map<string, number[]>()
  list.forEach((chain, i) => {
    const a = chain.path[0]!
    const b = chain.path[chain.path.length - 1]!
    if (a === b) return
    const key = edgeKey(a, b)
    const here = between.get(key) ?? []
    here.push(i)
    between.set(key, here)
  })
  let changed = false
  for (const group of between.values()) {
    if (group.length < 2) continue
    // The side most lines take keeps its geometry; ties go to the earlier-drawn (koridor) side.
    const sorted = [...group].sort((i, j) => list[j]!.lines.size - list[i]!.lines.size || Math.min(...list[i]!.path) - Math.min(...list[j]!.path))
    const keep = list[sorted[0]!]!
    for (const i of sorted.slice(1)) {
      const fold = list[i]!
      // Either way: a short link across the ends of a loop round a block is no street drawn twice.
      if (gap(network, fold, keep) > BUBBLE_GAP_M || gap(network, keep, fold) > BUBBLE_GAP_M) continue
      const merged = new Set([...keep.lines, ...fold.lines])
      for (let k = 1; k < keep.path.length; k++) network.edges.set(edgeKey(keep.path[k - 1]!, keep.path[k]!), merged)
      keep.lines = merged
      for (let k = 1; k < fold.path.length; k++) {
        const a = fold.path[k - 1]!
        const b = fold.path[k]!
        network.edges.delete(edgeKey(a, b))
        network.adjacency.get(a)?.delete(b)
        network.adjacency.get(b)?.delete(a)
      }
      changed = true
    }
  }
  for (const [n, next] of network.adjacency) if (next.size === 0) network.adjacency.delete(n)
  return changed
}

/*
 * Line order, street by street. Each chain draws its lines in one order, left to
 * right along it, and where two lines change places it's at a node, never along
 * a street. At a node, two lines passing through cost:
 *
 *   - SAME_CROSSING when they come in and go on along the same two chains but
 *     swap sides: a crossing a rider sees and nothing explains;
 *   - SPLIT_CROSSING when they come in together and part, the one turning off
 *     to the left having come in on the right of the other: a crossing the
 *     split itself forces only if nothing else is to give.
 *
 * These score Transit's own four cases (its technical follow-up's penalty
 * figure) as it marks them: a pair crossing is one SAME_CROSSING; a line merging
 * across two lines, two SPLIT_CROSSINGs; one merging in between, one; one
 * merging on its own side, none. A line turning left then comes to the left of
 * the others before the turn, as Transit draws it, without a rule saying so.
 *
 * The order is solved for exactly (orderLinesExact): one crossing put right can
 * force another elsewhere, so it is the whole network's least cost, as Transit
 * solves it, by integer linear programming. orderLinesLocal, which moves one
 * line at a time while that helps, is kept as its fallback.
 */
const SAME_CROSSING = 4
const SPLIT_CROSSING = 1

/*
 * Two lines side by side coming into a node that go on together with another
 * between them part, though they ran as one: SEPARATION, the LOOM paper's
 * (Bast, Brosi, Storandt) penalty for partners parting, at its weight against
 * its crossings' (4 and 1). The LRT's BK and CB, or 13 and 13E, stay together
 * where a line could as well join between them.
 */
const SEPARATION = 3
const ORDER_PASSES = 30

export interface PairRule {
  /** The two lines, by code. */
  a: string
  b: string
  /** The chain they come in on, and whether the node is at its start. */
  inChain: number
  inAtStart: boolean
  /** Same: the chain both go on along. */
  outChain?: number
  outAtStart?: boolean
  /** Split: whether a's way on is to the left of b's. */
  aGoesLeft?: boolean
  weight: number
}

/**
 * A line's ways through a node, from its chain ends there: in along one, on along the other. One
 * here three times passes twice, along its street and out round a loop and back (4 and 6 at
 * Galunggung): the loop's two ends are the two whose chains come round to the same point. With no
 * loop, it goes every way: each pair of ends.
 */
function passesThrough<E extends { chain: number, atStart: boolean }>(list: readonly Chain[], ends: readonly E[]): [E, E][] {
  if (ends.length === 2) return ends[0]!.chain !== ends[1]!.chain ? [[ends[0]!, ends[1]!]] : []
  if (ends.length !== 3) return []
  const farOf = (end: E): number => {
    const path = list[end.chain]!.path
    return end.atStart ? path[path.length - 1]! : path[0]!
  }
  const street = ends.filter(x => ends.every(y => y === x || farOf(y) !== farOf(x)))
  if (street.length === 1) return ends.filter(end => end !== street[0]).map(side => [street[0]!, side])
  // No loop: it goes every way, as 6 by the Setiabudi reservoir (up the bundle and back, off it to
  // the reservoir road, and from there down it). Each pair is a way through.
  if (street.length === 3) return [[ends[0]!, ends[1]!], [ends[1]!, ends[2]!], [ends[0]!, ends[2]!]]
  return []
}

/** The pairs of lines passing through each node, and what crossing there costs (see above). */
export function pairRules(network: Network, list: readonly Chain[]): PairRule[] {
  const { points } = network

  // Where each chain's ends are, and the way it leaves each, over its first ~30 m.
  interface End { chain: number, atStart: boolean, dx: number, dy: number }
  const ends = new Map<number, End[]>()
  list.forEach((chain, c) => {
    for (const atStart of [true, false]) {
      const path = atStart ? chain.path : [...chain.path].reverse()
      const from = points[path[0]!]!
      let to = points[path[path.length - 1]!]!
      for (const id of path.slice(1)) {
        const p = points[id]!
        if (Math.hypot(p.x - from.x, p.y - from.y) >= 30) {
          to = p
          break
        }
      }
      const d = Math.hypot(to.x - from.x, to.y - from.y) || 1
      const here = ends.get(path[0]!) ?? []
      here.push({ chain: c, atStart, dx: (to.x - from.x) / d, dy: (to.y - from.y) / d })
      ends.set(path[0]!, here)
    }
  })

  const rules: PairRule[] = []
  for (const [node, here] of ends) {
    const ending = network.termini?.get(node)
    const laned = new Set<string>()
    // Just a street and a loop off it, all with the same lines: there roundJunctions lands the
    // loop's way back on the street, over where its lines may cross.
    const linesHere = here.map(end => list[end.chain]!.lines)
    const loopOff = here.length === 3 && linesHere.every(l => l.size === linesHere[0]!.size && [...l].every(x => linesHere[0]!.has(x)))
    const endsOf = new Map<string, End[]>()
    for (const end of here) {
      for (const line of list[end.chain]!.lines) endsOf.set(line, [...(endsOf.get(line) ?? []), end])
    }
    // Lines passing through: in on one chain, out on another. A line ending here crosses nothing.
    // Each with whether its line is here three times, and whether it goes every way (no loop).
    const through: [string, [End, End], boolean, boolean][] = []
    for (const [line, e] of endsOf) {
      const passes = passesThrough(list, e)
      for (const pass of passes) through.push([line, pass, e.length === 3, passes.length === 3])
    }
    for (let i = 0; i < through.length; i++) {
      for (let j = i + 1; j < through.length; j++) {
        const [a, [a1, a2], twiceA, everyA] = through[i]!
        const [b, [b1, b2], twiceB, everyB] = through[j]!
        if (a === b) continue
        // Two lines both going every way round a node can't keep their places through all three ways.
        if (everyA && everyB) continue
        const shared = [a1, a2].filter(e => e === b1 || e === b2)
        const endA = ending?.get(a)
        const endB = ending?.get(b)
        if (endA && endB) {
          // Both end here: in one place, they change places under the terminus's mark, for nothing.
          if (Math.hypot(endA[0] - endB[0], endA[1] - endB[1]) < LANES_APART_M) continue
          // In lanes of their own, each side lies as they do (LANES_APART_M).
          const pair = `${a}|${b}`
          if (!laned.has(pair) && shared.length === 2) {
            laned.add(pair)
            for (const end of shared) {
              // Coming in along the chain: a's lane to the left of b's?
              const [hx, hy] = [-end.dx, -end.dy]
              const aGoesLeft = -hy * (endA[0] - endB[0]) + hx * (endA[1] - endB[1]) > 0
              rules.push({ a, b, inChain: end.chain, inAtStart: end.atStart, aGoesLeft, weight: SAME_CROSSING })
            }
          }
        }
        // A line passing twice parts from itself here, so it is only held to keep its place along one way.
        if ((twiceA || twiceB) && shared.length !== 2) continue
        if (shared.length === 2) {
          // Off a loop, a line passing twice crosses where the street goes straight on, under its way
          // back landing on the street (roundJunctions): crossed in the turn, it would land beside its line.
          const straightOn = loopOff && (twiceA || twiceB) && -a1.dx * a2.dx - a1.dy * a2.dy >= Math.cos(STRAIGHT_TURN)
          rules.push({ a, b, inChain: a1.chain, inAtStart: a1.atStart, outChain: a2.chain, outAtStart: a2.atStart, weight: straightOn ? SPLIT_CROSSING : SAME_CROSSING })
        } else if (shared.length === 1) {
          const into = shared[0]!
          const outA = into === a1 ? a2! : a1!
          const outB = into === b1 ? b2! : b1!
          // Coming in along `into`, which way on turns further left?
          const hx = -into.dx
          const hy = -into.dy
          const turn = (o: End): number => Math.atan2(hx * o.dy - hy * o.dx, hx * o.dx + hy * o.dy)
          rules.push({ a, b, inChain: into.chain, inAtStart: into.atStart, aGoesLeft: turn(outA) > turn(outB), weight: SPLIT_CROSSING })
        }
      }
    }
  }
  return rules
}

/** The chains a rule reads: both a pair's, or the one a split comes in on. */
const chainsOf = (rule: PairRule): number[] => (rule.outChain !== undefined ? [rule.inChain, rule.outChain] : [rule.inChain])

/** Whether [rule] crosses with each chain's lines placed at [position]. */
function crosses(rule: PairRule, position: readonly ReadonlyMap<string, number>[]): boolean {
  const before = (chain: number, a: string, b: string): boolean => position[chain]!.get(a)! < position[chain]!.get(b)!
  // Left to right as seen coming in to the node along a chain, or going on away from it.
  const aLeft = rule.inAtStart ? !before(rule.inChain, rule.a, rule.b) : before(rule.inChain, rule.a, rule.b)
  if (rule.outChain === undefined) return aLeft !== rule.aGoesLeft
  const aLeftOn = rule.outAtStart ? before(rule.outChain, rule.a, rule.b) : !before(rule.outChain, rule.a, rule.b)
  return aLeft !== aLeftOn
}

const positionsOf = (orders: readonly string[][]): Map<string, number>[] => orders.map(order => new Map(order.map((line, i) => [line, i])))

/** What [orders] (each chain's lines, left to right) cost under [rules]. */
export function orderCost(rules: readonly PairRule[], orders: readonly string[][]): number {
  const position = positionsOf(orders)
  return rules.reduce((sum, rule) => sum + (crosses(rule, position) ? rule.weight : 0), 0)
}

/** Each chain's lines in bundle order: where both orderings start. */
const inBundleOrder = (list: readonly Chain[], rank: ReadonlyMap<string, number>): string[][] =>
  list.map(chain => [...chain.lines].sort((a, b) => rank.get(a)! - rank.get(b)!))

/**
 * Each chain's lines, left to right along it, by local search: every chain in
 * bundle order, then each line in turn moved to wherever on its chain costs the
 * nodes at its ends least, until no move helps. Only a strictly better place is
 * taken, so the result is the same run to run. It can settle where only two
 * lines moving at once would help: orderLinesExact's fallback.
 */
export function orderLinesLocal(list: readonly Chain[], rules: readonly PairRule[], rank: ReadonlyMap<string, number>): string[][] {
  const orders = inBundleOrder(list, rank)
  // The rules, kept by chain and line, for the moves that can change them.
  const rulesOf = new Map<string, PairRule[]>()
  for (const rule of rules) {
    for (const c of chainsOf(rule)) {
      for (const line of [rule.a, rule.b]) {
        const key = `${c}|${line}`
        const here = rulesOf.get(key)
        if (here) here.push(rule)
        else rulesOf.set(key, [rule])
      }
    }
  }
  const position = positionsOf(orders)
  const cost = (rule: PairRule): number => (crosses(rule, position) ? rule.weight : 0)
  const place = (c: number, order: string[]): void => {
    orders[c] = order
    position[c] = new Map(order.map((line, i) => [line, i]))
  }

  for (let pass = 0; pass < ORDER_PASSES; pass++) {
    let moved = false
    for (let c = 0; c < orders.length; c++) {
      if (orders[c]!.length < 2) continue
      for (const line of [...orders[c]!]) {
        const rules = rulesOf.get(`${c}|${line}`)
        if (!rules) continue
        const others = orders[c]!.filter(l => l !== line)
        const at = orders[c]!.indexOf(line)
        const score = (): number => rules.reduce((sum, r) => sum + cost(r), 0)
        let best = score()
        let bestAt = at
        for (let p = 0; p <= others.length; p++) {
          if (p === at) continue
          place(c, [...others.slice(0, p), line, ...others.slice(p)])
          const s = score()
          if (s < best) {
            best = s
            bestAt = p
          }
        }
        place(c, [...others.slice(0, bestAt), line, ...others.slice(bestAt)])
        if (bestAt !== at) moved = true
      }
    }
    if (!moved) break
  }
  return orders
}

/** How the ordering went: crossings' cost by local search and solved exactly, and how often the solver gave up. */
export interface OrderReport {
  local: number
  exact: number
  components: number
  fallbacks: number
}

/** A component the solver may take this long over before its local order stands. */
const SOLVE_SECONDS = 10

/**
 * Each chain's lines, left to right along it, at the least cost the rules allow
 * across the whole network: an integer linear program, solved by HiGHS, for
 * each set of chains the rules tie together.
 *
 * On each chain, a binary per pair of its lines (bundle order first): 1 when the
 * earlier is left of the later, the other way round its complement, and every
 * three kept consistent (0 <= x_ij + x_jk - x_ik <= 1), so the pairs are one
 * order. A split costs its weight when its pair is the wrong way round coming
 * in; a pair crossing costs its weight through a binary forced to 1 when its two
 * chains disagree. Each pair out of bundle order costs 1, the crossings scaled
 * above all of those together: among equally good orders the one nearest bundle
 * order wins, so a regenerated file changes only where the network did.
 */
export function orderLinesExact(
  list: readonly Chain[],
  rules: readonly PairRule[],
  rank: ReadonlyMap<string, number>,
  highs: LegacyHighs,
  report?: OrderReport
): string[][] {
  const orders = inBundleOrder(list, rank)
  // Chains a pair crossing ties together are solved together.
  const parent = list.map((_, i) => i)
  const find = (i: number): number => {
    let at = i
    while (parent[at] !== at) {
      parent[at] = parent[parent[at]!]!
      at = parent[at]!
    }
    return at
  }
  for (const rule of rules) {
    if (rule.outChain !== undefined) parent[find(rule.outChain)] = find(rule.inChain)
  }
  const groups = new Map<number, PairRule[]>()
  for (const rule of rules) {
    const root = find(rule.inChain)
    const here = groups.get(root)
    if (here) here.push(rule)
    else groups.set(root, [rule])
  }

  let local: string[][] | undefined
  for (const group of groups.values()) {
    const here = [...new Set(group.flatMap(chainsOf))].sort((a, b) => a - b)
    const solved = solveOrders(here, orders, group, highs)
    if (report) report.components++
    if (solved) {
      for (const [c, order] of solved) orders[c] = order
      continue
    }
    if (report) report.fallbacks++
    local ??= orderLinesLocal(list, rules, rank)
    for (const c of here) orders[c] = local[c]!
  }
  return orders
}

/** A term of the program: a pair's binary, or its complement (1 - x). */
interface Literal {
  name: string
  positive: boolean
}

/** One component's orders, by chain, solved from bundle-order [orders]; null when HiGHS doesn't prove one. */
function solveOrders(
  here: readonly number[],
  orders: readonly string[][],
  rules: readonly PairRule[],
  highs: LegacyHighs
): Map<number, string[]> | null {
  const indexOf = new Map(here.map(c => [c, new Map(orders[c]!.map((line, i) => [line, i]))]))
  const pair = (c: number, i: number, j: number): string => `x${c}_${i}_${j}`
  // [a] left of [b] on chain [c].
  const before = (c: number, a: string, b: string): Literal => {
    const i = indexOf.get(c)!.get(a)!
    const j = indexOf.get(c)!.get(b)!
    return i < j ? { name: pair(c, i, j), positive: true } : { name: pair(c, j, i), positive: false }
  }
  const not = (l: Literal): Literal => ({ ...l, positive: !l.positive })

  const binaries: string[] = []
  const objective = new Map<string, number>()
  const cost = (name: string, weight: number): void => {
    objective.set(name, (objective.get(name) ?? 0) + weight)
  }
  // A literal's weight: on x, or on 1 - x (the constant left out).
  const costOf = (l: Literal, weight: number): void => cost(l.name, l.positive ? weight : -weight)
  const rows: string[] = []
  // sum(terms) >= bound, a literal's constant moved across.
  const atLeast = (terms: [Literal | string, number][], bound: number): void => {
    let rhs = bound
    const parts: string[] = []
    for (const [term, k] of terms) {
      if (typeof term === 'string') {
        parts.push(`${k >= 0 ? '+' : '-'} ${Math.abs(k)} ${term}`)
        continue
      }
      if (!term.positive) rhs -= k
      const coef = term.positive ? k : -k
      parts.push(`${coef >= 0 ? '+' : '-'} ${Math.abs(coef)} ${term.name}`)
    }
    rows.push(`${parts.join(' ')} >= ${rhs}`)
  }

  let pairs = 0
  for (const c of here) {
    const n = orders[c]!.length
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        binaries.push(pair(c, i, j))
        pairs++
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        for (let k = j + 1; k < n; k++) {
          const ij = { name: pair(c, i, j), positive: true }
          const jk = { name: pair(c, j, k), positive: true }
          const ik = { name: pair(c, i, k), positive: true }
          atLeast([[ij, 1], [jk, 1], [ik, -1]], 0)
          atLeast([[ij, -1], [jk, -1], [ik, 1]], -1)
        }
      }
    }
  }
  // Every crossing outweighs all the tie-breaks together.
  const scale = pairs + 1
  for (const name of binaries) cost(name, -1)
  rules.forEach((rule, r) => {
    const ab = before(rule.inChain, rule.a, rule.b)
    const aLeft = rule.inAtStart ? not(ab) : ab
    const weight = rule.weight * scale
    if (rule.outChain === undefined) {
      costOf(rule.aGoesLeft ? not(aLeft) : aLeft, weight)
      return
    }
    const on = before(rule.outChain, rule.a, rule.b)
    const aLeftOn = rule.outAtStart! ? on : not(on)
    const crossed = `y${r}`
    binaries.push(crossed)
    cost(crossed, weight)
    atLeast([[crossed, 1], [aLeft, -1], [aLeftOn, 1]], 0)
    atLeast([[crossed, 1], [aLeftOn, -1], [aLeft, 1]], 0)

    // Partners parting (see SEPARATION): side by side coming in, another between them going on.
    // Whether [d] lies between a and b on chain [c]: left of one and not of the other.
    const between = (c: number, d: string, name: string): string => {
      const u = before(c, rule.a, d)
      const v = before(c, rule.b, d)
      binaries.push(name)
      atLeast([[name, 1], [u, -1], [v, 1]], 0)
      atLeast([[name, 1], [v, -1], [u, 1]], 0)
      atLeast([[u, 1], [v, 1], [name, -1]], 0)
      atLeast([[name, -1], [u, -1], [v, -1]], -2)
      return name
    }
    const others = (c: number): string[] => orders[c]!.filter(l => l !== rule.a && l !== rule.b)
    const outOthers = others(rule.outChain)
    if (outOthers.length === 0) return
    const inBetween = others(rule.inChain).map((d, k) => between(rule.inChain, d, `bi${r}_${k}`))
    const partners = `p${r}`
    binaries.push(partners)
    // Nothing between them coming in: partners.
    atLeast([[partners, 1], ...inBetween.map((name): [string, number] => [name, 1])], 1)
    const parted = `s${r}`
    binaries.push(parted)
    cost(parted, SEPARATION * scale)
    outOthers.forEach((d, k) => {
      const name = between(rule.outChain!, d, `bo${r}_${k}`)
      atLeast([[parted, 1], [partners, -1], [name, -1]], -1)
    })
  })

  const terms = [...objective].filter(([, k]) => k !== 0).map(([name, k]) => `${k >= 0 ? '+' : '-'} ${Math.abs(k)} ${name}`)
  const lp = [
    'Minimize',
    ` obj: ${terms.length > 0 ? terms.join('\n  ') : `0 ${binaries[0]}`}`,
    'Subject To',
    ...rows.map((row, i) => ` r${i}: ${row}`),
    'Binary',
    ...binaries.map(name => ` ${name}`),
    'End',
    ''
  ].join('\n')
  const solution = highs.solve(lp, { time_limit: SOLVE_SECONDS })
  if (solution.Status !== 'Optimal') return null

  const out = new Map<number, string[]>()
  for (const c of here) {
    const lines = orders[c]!
    // A line's place: how many of the chain's others it is left of, most first.
    const leftOf = lines.map((_, i) => lines.reduce((sum, __, j) => {
      if (i === j) return sum
      const l = i < j ? { name: pair(c, i, j), positive: true } : { name: pair(c, j, i), positive: false }
      const x = solution.Columns[l.name]?.Primal ?? 0
      return sum + ((l.positive ? x : 1 - x) > 0.5 ? 1 : 0)
    }, 0))
    out.set(c, lines.map((line, i) => ({ line, left: leftOf[i]! })).sort((p, q) => q.left - p.left).map(p => p.line))
  }
  return out
}

/*
 * Each bundle moved across its street so the lines going on through a node
 * keep their place, where centring every bundle on its street moved them: the
 * 13s along Trunojoyo stepped half a line south where 1 joined them at CSW, and
 * back where it left. Transit's penalty figure draws it so: a line joining comes
 * in beside the lines going straight on, which don't move.
 *
 * Line i of n on a chain lies at i - (n - 1) / 2 + shift line widths right of
 * the chain's way. A line going on through a node from one chain to the next
 * should lie as far right of the way it travels on both; how far it doesn't is
 * the cost, in full for one going straight on (within STRAIGHT_TURN) and
 * TURNING_WEIGHT of it for one turning, whose step across a corner hardly
 * shows (1 coming off Sisingamangaraja onto Trunojoyo, where the 13s go
 * straight on), and SHIFT_COST a line width moved off the street's middle. A linear
 * program, solved by HiGHS, finds the shifts; a chain of one line stays centred,
 * so its halte dots stay on it. Shifts are kept within SHIFT_MAX line widths.
 * Places are as clients draw them, a rail line RAIL_WEIGHT wide: counted a
 * width apiece, a shift holding the lines going on held the bus lines and
 * left a rail line beside them stepping across.
 */
const SHIFT_MAX = 1
const SHIFT_COST = 0.25
const STRAIGHT_TURN = (30 * Math.PI) / 180
const TURNING_WEIGHT = 0.2

/** The unit way [chain] leaves the node at its start (or its end), over its first ~30 m. */
function leaving(network: Network, chain: Chain, atStart: boolean): [number, number] {
  const path = atStart ? chain.path : [...chain.path].reverse()
  const from = network.points[path[0]!]!
  let to = network.points[path[path.length - 1]!]!
  for (const id of path.slice(1)) {
    const p = network.points[id]!
    if (Math.hypot(p.x - from.x, p.y - from.y) >= 30) {
      to = p
      break
    }
  }
  const d = Math.hypot(to.x - from.x, to.y - from.y) || 1
  return [(to.x - from.x) / d, (to.y - from.y) / d]
}

/** Each chain's shift, in line widths right of its way (see above). */
export function bundleShifts(
  network: Network,
  list: readonly Chain[],
  orders: readonly string[][],
  highs: LegacyHighs,
  /** A stroke's width as clients draw it: RAIL_WEIGHT for a rail line's, 1 for a bus line's. */
  widthOf: (key: string) => number = () => 1
): number[] {
  const shifts = list.map(() => 0)
  const free = (c: number): boolean => orders[c]!.length >= 2
  const ends = new Map<number, { chain: number, atStart: boolean }[]>()
  list.forEach((chain, c) => {
    for (const atStart of [true, false]) {
      const node = atStart ? chain.path[0]! : chain.path[chain.path.length - 1]!
      const here = ends.get(node) ?? []
      here.push({ chain: c, atStart })
      ends.set(node, here)
    }
  })
  // Each stroke's middle across its chain as clients draw it: side by side, each its own width, centred.
  const places = orders.map((order) => {
    const widths = order.map(widthOf)
    let left = -widths.reduce((m, w) => m + w, 0) / 2
    return new Map(order.map((key, i) => {
      const middle = left + widths[i]! / 2
      left += widths[i]!
      return [key, middle] as const
    }))
  })
  const place = (c: number, line: string): number => places[c]!.get(line)!

  const rows: string[] = []
  const objective: string[] = []
  const term = (k: number, name: string): string => `${k >= 0 ? '+' : '-'} ${Math.abs(k)} ${name}`
  let gaps = 0
  for (const here of ends.values()) {
    const endsOf = new Map<string, { chain: number, atStart: boolean }[]>()
    for (const end of here) {
      for (const line of orders[end.chain]!) endsOf.set(line, [...(endsOf.get(line) ?? []), end])
    }
    for (const [line, at] of endsOf) for (const [a, b] of passesThrough(list, at)) {
      if (!free(a.chain) && !free(b.chain)) continue
      // Travelling in along a and on along b: right of that way is right of a chain run with it.
      const sa = a.atStart ? -1 : 1
      const sb = b.atStart ? 1 : -1
      // gap = sa (place_a + shift_a) - sb (place_b + shift_b), and the cost |gap|.
      const constant = sa * place(a.chain, line) - sb * place(b.chain, line)
      const vars: string[] = []
      if (free(a.chain)) vars.push(term(sa, `s${a.chain}`))
      if (free(b.chain)) vars.push(term(-sb, `s${b.chain}`))
      const negated = vars.map(v => (v.startsWith('+') ? `-${v.slice(1)}` : `+${v.slice(1)}`))
      // Straight on (coming in against a's way out of the node, going on along b's), or turning.
      const [ax, ay] = leaving(network, list[a.chain]!, a.atStart)
      const [bx, by] = leaving(network, list[b.chain]!, b.atStart)
      const straight = Math.acos(Math.max(-1, Math.min(1, -ax * bx - ay * by))) < STRAIGHT_TURN
      const gap = `g${gaps++}`
      rows.push(`+ 1 ${gap} ${negated.join(' ')} >= ${constant}`, `+ 1 ${gap} ${vars.join(' ')} >= ${-constant}`)
      objective.push(`+ ${straight ? 1 : TURNING_WEIGHT} ${gap}`)
    }
  }
  if (gaps === 0) return shifts
  const chainsFree = list.map((_, c) => c).filter(free)
  for (const c of chainsFree) {
    rows.push(`+ 1 u${c} - 1 s${c} >= 0`, `+ 1 u${c} + 1 s${c} >= 0`)
    objective.push(`+ ${SHIFT_COST} u${c}`)
  }
  const lp = [
    'Minimize',
    ` obj: ${objective.join('\n  ')}`,
    'Subject To',
    ...rows.map((row, i) => ` r${i}: ${row}`),
    'Bounds',
    ...chainsFree.map(c => ` -${SHIFT_MAX} <= s${c} <= ${SHIFT_MAX}`),
    'End',
    ''
  ].join('\n')
  const solution = highs.solve(lp, { time_limit: SOLVE_SECONDS })
  if (solution.Status !== 'Optimal') {
    console.warn(`  bundle shifts: ${solution.Status}; bundles left centred`)
    return shifts
  }
  // To a quarter line width: a shift a hair off a round one from the solver reads the same next run.
  for (const c of chainsFree) shifts[c] = Math.round((solution.Columns[`s${c}`]?.Primal ?? 0) * 4) / 4 || 0
  return shifts
}

let solver: Promise<LegacyHighs> | undefined
/** HiGHS, loaded once. */
export const loadSolver = (): Promise<LegacyHighs> => (solver ??= highsLoader())

/** Peta Bus's lines as the edges of one network, each with its lines in order across it. */
export async function bundle(lines: readonly BundleLine[], report?: OrderReport, keptApart?: KeptApart, options?: NetworkOptions): Promise<BusMapEdge[]> {
  const network = buildNetwork(lines, keptApart, options)
  let list = chains(network)
  for (let pass = 0; pass < 6; pass++) {
    const popped = popBubbles(network, list)
    if (popped) list = chains(network)
    const smoothed = smooth(network, list)
    if (smoothed) list = chains(network)
    if (!popped && !smoothed) break
  }
  list = splitAtTermini(network, dropShortLoops(network, list))
  orient(network, list)
  const order = bundleOrder(lines)
  const rank = new Map(order.map((code, i) => [code, i]))
  // Ordered and shifted as strokes, each ranked as its first line.
  const strokeOf = strokeKeys(lines)
  const strokeRank = new Map<string, number>()
  for (const code of order) {
    const key = strokeOf.get(code)!
    if (!strokeRank.has(key)) strokeRank.set(key, rank.get(code)!)
  }
  const strokes: Chain[] = list.map(chain => ({ path: chain.path, lines: new Set([...chain.lines].map(l => strokeOf.get(l)!)) }))
  // The termini too, as the strokes ending there.
  const termini = new Map([...network.termini ?? []].map(([n, ls]) => [n, new Map([...ls].map(([l, xy]) => [strokeOf.get(l)!, xy]))]))
  const rules = pairRules({ ...network, termini }, strokes)
  const localOrders = orderLinesLocal(strokes, rules, strokeRank)
  const exactOrders = orderLinesExact(strokes, rules, strokeRank, await loadSolver(), report)
  const local = orderCost(rules, localOrders)
  const exact = orderCost(rules, exactOrders)
  if (report) {
    report.local += local
    report.exact += exact
  }
  // Exact can't do worse; if it ever reads so, the program is wrong, and the local order stands.
  if (exact > local) console.warn(`  line order: solved ${exact} against local search's ${local}; keeping local`)
  const strokeOrders = exact > local ? localOrders : exactOrders
  // A stroke's width as clients draw it: a rail line's heavier (RAIL_WEIGHT).
  const railStroke = new Set(lines.filter(l => isRailCode(l.code)).map(l => strokeOf.get(l.code)!))
  const shifts = bundleShifts(network, strokes, strokeOrders, await loadSolver(), key => (railStroke.has(key) ? RAIL_WEIGHT : 1))
  // Each stroke back to its lines on the chain, in bundle order.
  const orders = list.map((chain, c) => strokeOrders[c]!.flatMap(key =>
    [...chain.lines].filter(l => strokeOf.get(l) === key).sort((a, b) => rank.get(a)! - rank.get(b)!)))
  return list
    .map((chain, i): BusMapEdge => {
      const coords = chain.path.map((id) => {
        const p = network.points[id]!
        return [p.x / KX, p.y / KY] as LngLat
      })
      const shift = shifts[i]!
      return {
        shape: encodePolyline(simplify(coords, SIMPLIFY_M)),
        lines: orders[i]!,
        ...(shift !== 0 ? { shift } : {})
      }
    })
    // Stable output: a regenerated file diffs only where the network changed.
    .sort((a, b) => a.lines.join(' ').localeCompare(b.lines.join(' ')) || a.shape.localeCompare(b.shape))
}

/*
 * Where a halte's mark goes on the network: on the nearest edge carrying one of
 * its lines, within STOP_MARK_M, centred across the edge's bundle and turned to
 * its way, so a client draws Transit's bar across all the strokes there (one
 * stroke: a dot in its colour). A halte with no such edge near has no mark.
 */
const STOP_MARK_M = 60

/**
 * A halte's mark: code, [lng, lat] on the edge, the edge's bearing (degrees from north), its stroke
 * count, its one stroke's first line, and the edge's shift when it has one, for the bar to move with
 * its lines.
 */
export type StopMark = [string, number, number, number, number, string, number?]

export interface StopIn {
  code: string
  lng: number
  lat: number
  lines: readonly string[]
}

export function placeStops(
  edges: readonly BusMapEdge[],
  stops: readonly StopIn[],
  strokeOf: ReadonlyMap<string, string> = new Map(),
  /** Lines a halte's bar doesn't cross (rail beside a busway): it spans the others' strokes alone. */
  passesBy: (code: string) => boolean = () => false
): StopMark[] {
  const shapes = edges.map(e => decodePolyline(e.shape).map(([lng, lat]) => [lng * KX, lat * KY] as [number, number]))
  const out: StopMark[] = []
  for (const stop of stops) {
    const px = stop.lng * KX
    const py = stop.lat * KY
    const wanted = new Set(stop.lines)
    let best: { d: number, x: number, y: number, bearing: number, edge: number } | null = null
    for (let e = 0; e < edges.length; e++) {
      const edge = edges[e]!
      if (!edge.lines.some(l => wanted.has(l))) continue
      const pts = shapes[e]!
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1]!
        const [bx, by] = pts[i]!
        const dx = bx - ax
        const dy = by - ay
        const l2 = dx * dx + dy * dy
        if (l2 === 0) continue
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
        const x = ax + t * dx
        const y = ay + t * dy
        const d = Math.hypot(px - x, py - y)
        if (d <= STOP_MARK_M && (!best || d < best.d)) {
          best = { d, x, y, bearing: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360, edge: e }
        }
      }
    }
    if (!best) continue
    const { x, y, bearing, edge } = best
    const { lines, shift } = edges[edge]!
    // Across the strokes, not the lines: 13, 13E and L13E are one. Left to right, each with its first line.
    const strokes: { key: string, first: string, passes: boolean }[] = []
    for (const line of lines) {
      const key = strokeOf.get(line) ?? line
      const last = strokes[strokes.length - 1]
      if (last?.key === key) last.passes &&= passesBy(line)
      else strokes.push({ key, first: line, passes: passesBy(line) })
    }
    // Only from the first stroke it crosses to the last: a rail line at the bundle's side runs past.
    // Each as wide as clients draw it (a rail line RAIL_WEIGHT), the bar's middle theirs.
    const from = Math.max(0, strokes.findIndex(st => !st.passes))
    const to = strokes.length - 1 - Math.max(0, [...strokes].reverse().findIndex(st => !st.passes))
    const count = Math.max(1, to - from + 1)
    const widths = strokes.map(st => (isRailCode(st.first) ? RAIL_WEIGHT : 1))
    const total = widths.reduce((a, b) => a + b, 0)
    const before = (k: number): number => widths.slice(0, k).reduce((a, b) => a + b, 0)
    const middle = (before(from) + before(to + 1)) / 2 - total / 2
    const moved = Math.round(((shift ?? 0) + middle) * 1e3) / 1e3
    const mark: StopMark = [stop.code, Math.round((x / KX) * 1e5) / 1e5, Math.round((y / KY) * 1e5) / 1e5, Math.round(bearing), count, count === 1 ? strokes[from]?.first ?? lines[0]! : '']
    if (moved) mark.push(moved)
    out.push(mark)
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]))
}

/*
 * Corners as circular arcs, as Transit draws them: a line offset beside an arc
 * is an arc too, so every line of a bundle turns cleanly round the same centre.
 * The radius grows with the bundle (ARC_BASE_M, then ARC_PER_LINE_M a line, the
 * width a line takes around z14, where bundles are drawn), so the inner lines
 * of a wide one don't fold over themselves on a turn.
 *
 * The radius is kept by simplifying the shape, as Transit's follow-up does
 * (easeCorners): a corner the roads draw as a few short cuts (a chamfer, a
 * tight curve sampled every few metres) is one bend, and is turned on one
 * circle between its two long legs, at the full radius, where rounding each cut
 * on its own would leave arcs a few metres wide and the bundle bunched on the
 * inside of the bend. A corner where edges meet is turned too (roundJunctions).
 * Only where neither can be done is a corner as wide as its legs allow.
 */
const ARC_BASE_M = 15
const ARC_PER_LINE_M = 14
const ARC_MIN_TURN = (20 * Math.PI) / 180
/** Sharper than this is a hairpin (a U-turn, a spike where a line doubles back): rounded, it would loop. */
const ARC_MAX_TURN = (120 * Math.PI) / 180
const ARC_STEP = (15 * Math.PI) / 180
/** A jog sideways (a lane shift, a kerb build-out) of up to this is straightened rather than turned twice. */
const JOG_M = 15
/** A corner may run this much short of its tangent before it counts as squeezed. */
const FIT_SLACK_M = 0.5

/**
 * How the corners went: eased (cuts merged into one bend), turned at a node,
 * left narrower than their radius, and of those, folded: so tight that the
 * innermost line of a bundle of two or more turns on less than nothing (the
 * bundle's half-width at z14, where it is drawn widest for its streets).
 */
export interface CornerTally {
  eased: number
  junctions: number
  squeezed: number
  folded: number
}

/** The radius a bundle of [lines] turns on. */
const arcRadius = (lines: number): number => ARC_BASE_M + ARC_PER_LINE_M * lines

/** Tallies a corner of [turn] rounded with [tangent] where it wanted [wanted], for a bundle of [lines]. */
function tallyCorner(tally: CornerTally | undefined, turn: number, wanted: number, tangent: number, lines: number): void {
  if (!tally || wanted <= tangent + FIT_SLACK_M) return
  tally.squeezed++
  if (lines >= 2 && tangent / Math.tan(Math.abs(turn) / 2) < (lines * ARC_PER_LINE_M) / 2) tally.folded++
}

const toXYs = (path: readonly LngLat[]): XY[] => path.map(([lng, lat]) => [lng * KX, lat * KY])
const toLngLats = (xy: readonly XY[]): LngLat[] => xy.map(([x, y]) => [x / KX, y / KY] as LngLat)

/** The turn at [p] coming from [a] and going on to [b], radians, left positive. */
function turnAt(a: XY, p: XY, b: XY): number {
  const ux = p[0] - a[0]
  const uy = p[1] - a[1]
  const vx = b[0] - p[0]
  const vy = b[1] - p[1]
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
}

/** What a corner of [turn] takes of each leg to turn on [radius]: none when it isn't rounded (a hairpin). */
const tangentFor = (turn: number, radius: number): number => (Math.abs(turn) > ARC_MAX_TURN ? 0 : radius * Math.tan(Math.abs(turn) / 2))

/** How far [p] is from the segment [a]..[b]. */
function distanceTo([px, py]: XY, [ax, ay]: XY, [bx, by]: XY): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** How far each leg of [xy] falls short of what the corners at its two ends take; a path end takes nothing. */
function shortfalls(xy: readonly XY[], radius: number): number[] {
  const need = xy.map((p, i) => (i === 0 || i === xy.length - 1 ? 0 : tangentFor(turnAt(xy[i - 1]!, p, xy[i + 1]!), radius)))
  return xy.slice(1).map((p, i) => need[i]! + need[i + 1]! - Math.hypot(p[0] - xy[i]![0], p[1] - xy[i]![1]))
}

/**
 * [path] simplified until each corner fits its radius for a bundle of [lines]:
 * while a leg is shorter than the corners at its ends take, worst first, its two
 * corners become one. Turning the same way, they are replaced by where the legs
 * either side meet (the chamfer's corner, rounded whole). Turning opposite ways,
 * a jog of under JOG_M, the leg goes and the legs either side are joined
 * straight. Its ends stay put, a hairpin stays as it is, and a corner is not
 * moved further than its radius from where the road turns; a leg that can't be
 * fixed so is left for filletCorners to squeeze.
 */
export function easeCorners(path: readonly LngLat[], lines: number, tally?: CornerTally): LngLat[] {
  if (path.length < 4) return [...path]
  const radius = arcRadius(lines)
  const xy = toXYs(path)
  const stuck = new Set<string>()
  const keyOf = (i: number): string => `${xy[i]![0]},${xy[i]![1]}|${xy[i + 1]![0]},${xy[i + 1]![1]}`
  for (let guard = path.length * 2; guard > 0; guard--) {
    const short = shortfalls(xy, radius)
    let worst = -1
    for (let i = 0; i < short.length; i++) {
      if (short[i]! > FIT_SLACK_M && !stuck.has(keyOf(i)) && (worst < 0 || short[i]! > short[worst]!)) worst = i
    }
    if (worst < 0) break
    // The leg xy[worst]..xy[worst + 1]; both its corners must be inside the path to merge.
    const merged = worst >= 1 && worst + 2 <= xy.length - 1 ? mergeLeg(xy, worst, radius) : null
    if (!merged) {
      stuck.add(keyOf(worst))
      continue
    }
    xy.splice(worst, 2, ...merged)
    if (tally) tally.eased++
  }
  return toLngLats(xy)
}

/** The two corners at the ends of leg [i] of [xy] as one: the points to put in their place, or null. */
function mergeLeg(xy: readonly XY[], i: number, radius: number): XY[] | null {
  const a = xy[i - 1]!
  const p = xy[i]!
  const q = xy[i + 1]!
  const b = xy[i + 2]!
  const first = turnAt(a, p, q)
  const second = turnAt(p, q, b)
  if (Math.abs(first) > ARC_MAX_TURN || Math.abs(second) > ARC_MAX_TURN) return null
  if (Math.sign(first) !== Math.sign(second)) {
    // A jog: straight from a to b, when neither corner is far off that line.
    if (distanceTo(p, a, b) > JOG_M || distanceTo(q, a, b) > JOG_M) return null
    return []
  }
  if (Math.abs(first + second) > ARC_MAX_TURN) return null
  // Where the leg in (a -> p) and the leg out (q -> b) meet: ahead of p, behind q.
  const ux = p[0] - a[0]
  const uy = p[1] - a[1]
  const vx = b[0] - q[0]
  const vy = b[1] - q[1]
  const cross = ux * vy - uy * vx
  if (cross === 0) return null
  const wx = q[0] - p[0]
  const wy = q[1] - p[1]
  const s = (wx * vy - wy * vx) / cross
  const t = (ux * wy - uy * wx) / cross
  if (s < 0 || t < 0) return null
  const meet: XY = [p[0] + s * ux, p[1] + s * uy]
  if (distanceTo(meet, p, q) > radius) return null
  return [meet]
}

/**
 * The arc turning [turn] at corner [p], coming in along ([ux], [uy]) (a unit
 * vector), from [tangent] before p to as far after it, in [steps] even steps.
 */
function arcPoints(p: XY, ux: number, uy: number, turn: number, tangent: number, steps: number): XY[] {
  const r = tangent / Math.tan(Math.abs(turn) / 2)
  const sx = p[0] - ux * tangent
  const sy = p[1] - uy * tangent
  const left = turn > 0 ? 1 : -1
  const cx = sx - uy * r * left
  const cy = sy + ux * r * left
  const start = Math.atan2(sy - cy, sx - cx)
  const out: XY[] = []
  for (let k = 0; k <= steps; k++) {
    const angle = start + left * Math.abs(turn) * (k / steps)
    out.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)])
  }
  return out
}

/** What a corner filletCorners rounds takes of each leg for [radius]: none for one it leaves (gentle, or a hairpin). */
const roundedNeed = (turn: number, radius: number): number =>
  Math.abs(turn) < ARC_MIN_TURN || Math.abs(turn) > ARC_MAX_TURN ? 0 : radius * Math.tan(Math.abs(turn) / 2)

/**
 * How much of a leg of [length] a corner wanting [need] gets, the corner at its
 * other end wanting [other]: all it wants when both fit, else the leg shared in
 * proportion, so both are short of their radius by the same part of it.
 */
const share = (need: number, other: number, length: number): number =>
  need + other <= length ? need : (length * need) / (need + other)

/**
 * [path] with each loop it ties in itself, crossing its own way again within
 * [maxM] along it, cut off at the crossing. Laid onto roads the tiles don't join,
 * a line handed over at the next road's vertex round the corner: 6 up Gembira past
 * the end of the busway along Galunggung, and back across its own way onto it.
 * Too short for a bus to drive; a turning loop is hundreds of metres round.
 */
export function cutLoops(path: readonly LngLat[], maxM: number): LngLat[] {
  const xy = toXYs(path)
  const out: XY[] = []
  for (let i = 0; i < xy.length; i++) {
    out.push(xy[i]!)
    // The last leg drawn, against the legs before it within maxM: crossing one, the loop between goes.
    for (let changed = true; changed && out.length >= 4;) {
      changed = false
      const c = out[out.length - 2]!
      const d = out[out.length - 1]!
      // Round the loop from [b] to [c], before the bits of the two crossing legs it takes.
      let between = 0
      for (let k = out.length - 3; k >= 1 && between <= maxM; k--) {
        const a = out[k - 1]!
        const b = out[k]!
        between += Math.hypot(out[k + 1]![0] - b[0], out[k + 1]![1] - b[1])
        const hit = crossing(a, b, c, d)
        if (hit && between + Math.hypot(b[0] - hit[0], b[1] - hit[1]) + Math.hypot(c[0] - hit[0], c[1] - hit[1]) <= maxM) {
          out.splice(k, out.length - k, hit, d)
          changed = true
          break
        }
      }
    }
  }
  return toLngLats(out)
}

/** Where segment [a]-[b] crosses [c]-[d], their ends apart; null where they don't. */
function crossing(a: XY, b: XY, c: XY, d: XY): XY | null {
  const rx = b[0] - a[0]
  const ry = b[1] - a[1]
  const sx = d[0] - c[0]
  const sy = d[1] - c[1]
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-9) return null
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null
  return [a[0] + t * rx, a[1] + t * ry]
}

/** smoothPath resamples a line this often, in metres, before smoothing it. */
const SMOOTH_STEP_M = 2

/**
 * [path] smoothed: resampled every SMOOTH_STEP_M and each point moved to the
 * Gaussian-weighted mean of its neighbours along the line, [sigmaM] its spread.
 * A wobble much shorter than a few sigmas irons out (a busway the tiles draw as
 * uneven chords round a bend, 2 by Gambir 2) and a corner rounds, while a
 * straight stays straight. Near an end the window shrinks to what lies on both
 * sides, so the ends stay put. The caller simplifies what comes back.
 */
export function smoothPath(path: readonly LngLat[], sigmaM: number): LngLat[] {
  if (path.length < 3) return [...path]
  const xy = toXYs(path)
  const samples: XY[] = [xy[0]!]
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1]!
    const [bx, by] = xy[i]!
    const parts = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / SMOOTH_STEP_M))
    for (let k = 1; k <= parts; k++) samples.push([ax + ((bx - ax) * k) / parts, ay + ((by - ay) * k) / parts])
  }
  const sigma = sigmaM / SMOOTH_STEP_M
  const reach = Math.ceil(3 * sigma)
  const weights = Array.from({ length: reach + 1 }, (_, d) => Math.exp(-(d * d) / (2 * sigma * sigma)))
  const out: XY[] = samples.map((p, i) => {
    const r = Math.min(reach, i, samples.length - 1 - i)
    if (r === 0) return p
    let sx = 0
    let sy = 0
    let sw = 0
    for (let d = -r; d <= r; d++) {
      const w = weights[Math.abs(d)]!
      sx += samples[i + d]![0] * w
      sy += samples[i + d]![1] * w
      sw += w
    }
    return [sx / sw, sy / sw]
  })
  return toLngLats(out)
}

/**
 * [path] simplified (Douglas-Peucker) to within [flatM] where a span runs
 * straight, but to within [bendM] where it bends: where a step of the path heads
 * more than [bendDeg] off the span's chord. A smoothed bend stays a curve at
 * street zoom (2's hairpin by Gambir 2 had gone back to 15-30 degree chords),
 * while a straight's sub-flatM flutter is still flattened. Both ends are kept.
 */
export function simplifyBends(path: readonly LngLat[], flatM: number, bendM: number, bendDeg: number): LngLat[] {
  if (path.length < 3) return [...path]
  const xy = toXYs(path)
  const bend = Math.cos((bendDeg * Math.PI) / 180)
  const keep = new Array<boolean>(xy.length).fill(false)
  keep[0] = true
  keep[xy.length - 1] = true
  const stack: [number, number][] = [[0, xy.length - 1]]
  while (stack.length > 0) {
    const [a, b] = stack.pop()!
    if (b - a < 2) continue
    const [ax, ay] = xy[a]!
    const [bx, by] = xy[b]!
    const dx = bx - ax
    const dy = by - ay
    const length = Math.hypot(dx, dy)
    let worst = 0
    let worstAt = -1
    let bends = false
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i]!
      const d = length === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * (px - ax) - dx * (py - ay)) / length
      if (d > worst) {
        worst = d
        worstAt = i
      }
    }
    for (let i = a; i < b && !bends && length > 0; i++) {
      const sx = xy[i + 1]![0] - xy[i]![0]
      const sy = xy[i + 1]![1] - xy[i]![1]
      const step = Math.hypot(sx, sy)
      if (step > 0 && (sx * dx + sy * dy) / (step * length) < bend) bends = true
    }
    if (worst > flatM || (worst > bendM && bends)) {
      keep[worstAt] = true
      stack.push([a, worstAt], [worstAt, b])
    }
  }
  return path.filter((_, i) => keep[i])
}

/**
 * [path] with each corner turning between ARC_MIN_TURN and ARC_MAX_TURN rounded
 * off for a bundle of [lines]; its ends stay put. Each leg goes to the corners at
 * its two ends (share), all of it to one whose neighbour isn't rounded (a path
 * end, an arc's own steps); a corner the legs leave short of its tangent is as
 * wide as they allow, and is tallied as squeezed.
 */
export function filletCorners(path: readonly LngLat[], lines: number, tally?: CornerTally): LngLat[] {
  if (path.length < 3) return [...path]
  const radius = arcRadius(lines)
  const xy = toXYs(path)
  const out: XY[] = [xy[0]!]
  const leg = (i: number): number => Math.hypot(xy[i + 1]![0] - xy[i]![0], xy[i + 1]![1] - xy[i]![1])
  const need = xy.map((p, i) => (i === 0 || i === xy.length - 1 ? 0 : roundedNeed(turnAt(xy[i - 1]!, p, xy[i + 1]!), radius)))
  for (let i = 1; i < xy.length - 1; i++) {
    const p = xy[i]!
    const inLen = leg(i - 1)
    const outLen = leg(i)
    if (inLen === 0 || outLen === 0) continue
    const turn = turnAt(xy[i - 1]!, p, xy[i + 1]!)
    if (Math.abs(turn) < ARC_MIN_TURN || Math.abs(turn) > ARC_MAX_TURN) {
      out.push(p)
      continue
    }
    const wanted = need[i]!
    const room = Math.min(share(wanted, need[i - 1]!, inLen), share(wanted, need[i + 1]!, outLen))
    tallyCorner(tally, turn, wanted, Math.min(wanted, room), lines)
    const ux = (p[0] - xy[i - 1]![0]) / inLen
    const uy = (p[1] - xy[i - 1]![1]) / inLen
    out.push(...arcPoints(p, ux, uy, turn, Math.min(wanted, room), Math.max(1, Math.ceil(Math.abs(turn) / ARC_STEP))))
  }
  out.push(xy[xy.length - 1]!)
  return toLngLats(out)
}

/*
 * Barbs off a line laid onto the roads: where the matched road runs a few
 * metres past a corner (its nearest point beyond the junction) and the line
 * goes out to it and comes back, a hook of 5 to 20 m at the corner (koridor 8 by
 * Gelanggang TB Simatupang, 1 by Flyover Karet). A point the line turns back at
 * by more than BARB_TURN, with a leg either side of it no longer than BARB_M,
 * goes; a real U-turn or hairpin runs legs of hundreds of metres and stays. So
 * does a zigzag: two points turning more than ZIGZAG_TURN, opposite ways, no
 * more than BARB_M apart (1 by Flyover Karet, 10 and 12 by Walikota Jakarta
 * Utara), where a street turns the one way and goes on.
 */
const BARB_M = 45
const BARB_TURN_COS = Math.cos((140 * Math.PI) / 180)
const ZIGZAG_TURN = (90 * Math.PI) / 180

/*
 * A zigzag whose middle leg runs back against the line's way, both its turns
 * sharper than BACKSTEP_TURN, is a line stepping from one carriageway across to
 * the other, and goes up to BACKSTEP_M long, two carriageways as far apart as
 * SNAP_M lets them merge: 10 and 12 at Walikota Jakarta Utara, from Yos
 * Sudarso's northbound side to its southbound, 34 m apart under the toll road.
 */
const BACKSTEP_TURN = (120 * Math.PI) / 180
const BACKSTEP_M = 2 * SNAP_M

/*
 * And a hook at an edge's end: leaving its node, the edge sets off one way and
 * within END_BARB_M folds back more than END_BARB_TURN, the node lying past the
 * corner the line turns at (where 9's or 12's own two ways part and meet again,
 * 2 and 14 by RSPAD). The point it folds back at goes, the edge setting off from
 * its node straight to the next; the node, which other edges share, stays.
 */
const END_BARB_M = 60
const END_BARB_TURN_COS = Math.cos((110 * Math.PI) / 180)

/**
 * A spike's tip this near a halte the edge's lines call at isn't trimmed: a line turning straight back
 * there is turning round at it (13 at CBD Ciledug, its terminus up a short spur), not overshooting a
 * corner. A hook or a zigzag by a halte still goes.
 */
const KEEP_NEAR_HALTE_M = 25

/** [path] without its barbs (see above); its ends stay put, and its points by any of [haltes]. */
/*
 * A line on its own streets going out and straight back along itself: koridor
 * 9's way north past Cawang ran 170 m south down MT Haryono and back, after a
 * short-turn pattern's U-turn there, with no halte where it turned. An
 * excursion from a point back to within RETRACE_CLOSE_M of it, reaching up to
 * RETRACE_MAX_M away, whose way back keeps within RETRACE_THIN_M of its way out,
 * is taken out when no halte the line calls at lies along it: a bus turning
 * round where no one gets on or off. One with a halte on it (a terminus up a
 * spur, 8N's) stays. A loop round a block, or a hairpin round to the next street (2 at
 * Gambir 2), keeps its legs further apart and stays too.
 */
const RETRACE_CLOSE_M = 20
const RETRACE_MAX_M = 250
const RETRACE_THIN_M = 25
const RETRACE_MIN_M = 60

/** [path] without its out-and-back excursions (see above); its ends stay put. */
export function dropRetraces(path: readonly LngLat[], haltes: readonly LngLat[] = []): LngLat[] {
  const xy = toXYs(path)
  const stops = toXYs(haltes)
  const near = (p: XY, q: XY): number => Math.hypot(p[0] - q[0], p[1] - q[1])
  const out: LngLat[] = []
  let i = 0
  while (i < xy.length) {
    out.push(path[i]!)
    // The first point after i, far enough round, that comes back to within RETRACE_CLOSE_M of it.
    let walked = 0
    let reach = 0
    let tip = i
    let back = -1
    for (let j = i + 1; j < xy.length; j++) {
      walked += near(xy[j]!, xy[j - 1]!)
      const away = near(xy[j]!, xy[i]!)
      if (away > reach) {
        reach = away
        tip = j
      }
      if (reach > RETRACE_MAX_M || walked > 2 * RETRACE_MAX_M + 2 * RETRACE_CLOSE_M) break
      if (walked >= RETRACE_MIN_M && away <= RETRACE_CLOSE_M && j > tip) {
        back = j
        break
      }
    }
    // No halte the line calls at anywhere along it: a rider is never carried there, so it's no part of
    // the line to them. One with a halte on it (8N up its spur) is the line's.
    const calls = (): boolean => stops.some(h => xy.slice(i, back + 1).some((q, k, way) => k > 0 && distanceTo(h, way[k - 1]!, q) <= KEEP_NEAR_HALTE_M))
    if (back > 0 && !calls()) {
      // Thin: every point of the way out lies near the way back.
      const wayBack = xy.slice(tip, back + 1)
      const thin = xy.slice(i, tip + 1).every(p => wayBack.some((q, k) => k > 0 && distanceTo(p, wayBack[k - 1]!, q) <= RETRACE_THIN_M))
      if (thin) {
        i = back
        continue
      }
    }
    i++
  }
  return out
}

export function trimBarbs(path: readonly LngLat[], haltes: readonly LngLat[] = []): LngLat[] {
  const xy = toXYs(path)
  const stops = toXYs(haltes)
  const byHalte = (p: XY): boolean => stops.some(h => Math.hypot(h[0] - p[0], h[1] - p[1]) <= KEEP_NEAR_HALTE_M)
  for (let changed = true; changed;) {
    changed = false
    for (let i = 1; i < xy.length - 1; i++) {
      const [ax, ay] = xy[i - 1]!
      const [px, py] = xy[i]!
      const [bx, by] = xy[i + 1]!
      const inLen = Math.hypot(px - ax, py - ay)
      const outLen = Math.hypot(bx - px, by - py)
      const same = inLen < 0.1 || outLen < 0.1
      const cos = same ? 1 : ((px - ax) * (bx - px) + (py - ay) * (by - py)) / (inLen * outLen)
      const back = !same && cos < BARB_TURN_COS
      // Next to an end, on a short end leg, a fold sharper than END_BARB_TURN will do.
      const endHook = !same && cos < END_BARB_TURN_COS
        && ((i === 1 && inLen <= END_BARB_M) || (i === xy.length - 2 && outLen <= END_BARB_M))
      // Only a spike turns round at a halte; a hook or a zigzag by one is still a kink.
      if (same || endHook || (back && Math.min(inLen, outLen) <= BARB_M && !byHalte(xy[i]!))) {
        xy.splice(i, 1)
        changed = true
        break
      }
      if (i + 2 < xy.length && outLen <= BACKSTEP_M) {
        const first = turnAt(xy[i - 1]!, xy[i]!, xy[i + 1]!)
        const second = turnAt(xy[i]!, xy[i + 1]!, xy[i + 2]!)
        const sharp = outLen <= BARB_M ? ZIGZAG_TURN : BACKSTEP_TURN
        if (Math.abs(first) > sharp && Math.abs(second) > sharp && first * second < 0) {
          xy.splice(i, 2)
          changed = true
          break
        }
      }
    }
  }
  return toLngLats(xy)
}

/** [path] eased (easeCorners), then its corners rounded (filletCorners), for a bundle of [lines]. */
export function roundCorners(path: readonly LngLat[], lines: number, tally?: CornerTally): LngLat[] {
  return filletCorners(easeCorners(path, lines, tally), lines, tally)
}

/** An edge for roundJunctions: its points, and its lines. */
export interface JunctionEdge {
  path: readonly LngLat[]
  lines: readonly string[]
  /** Rail lines' alone: its track is its own way, joined as it is, never curved onto a street. */
  rail?: boolean
}

/**
 * The network's corners at its nodes rounded, as along an edge: at each node,
 * the two edges sharing the most lines (the bigger turn between equals) turn on
 * one arc for the wider of them, when they turn by ARC_MIN_TURN to ARC_MAX_TURN.
 * Each takes half the arc, as far as its share of its end leg (share; half, on
 * an edge of one leg, whose other end may turn too); the node moves to the
 * arc's middle, for every edge ending there, so the edges go on meeting. Ends
 * that meet are one point, as laidOnRoads leaves them.
 *
 * A node a line goes straight through is left as it is: moved into a corner's
 * arc, it would put a notch in that line (koridor 1 straight down past Blok M,
 * where the 13E bundle turns off it). There a loop's way back, its lines the
 * street's both ways, curves onto the street on an arc of its own, ending along
 * it the less sharp way: 4 and 6 back up onto Jl. Galunggung, eastward. The
 * node moves along the street to where the arc lands, all three meeting there.
 */
export function roundJunctions(edges: readonly JunctionEdge[], tally?: CornerTally): LngLat[][] {
  /** An edge's end at a node: the way it leaves, its end leg, and what of that leg the corner at its far end takes. */
  interface End { edge: number, atStart: boolean, dx: number, dy: number, leg: number, other: number }
  const paths = edges.map(e => toXYs(e.path))
  const ends = new Map<string, End[]>()
  edges.forEach((edge, e) => {
    const xy = paths[e]!
    if (xy.length < 2) return
    for (const atStart of [true, false]) {
      const [lng, lat] = atStart ? edge.path[0]! : edge.path[edge.path.length - 1]!
      const from = atStart ? xy[0]! : xy[xy.length - 1]!
      const to = atStart ? xy[1]! : xy[xy.length - 2]!
      // An end of no length (an edge drawn to the point it starts at) turns nothing, but still moves with its node.
      const leg = Math.hypot(to[0] - from[0], to[1] - from[1])
      // The far end of the end leg: a corner of the edge, or (a one-leg edge) its other node, which may turn too.
      const beyond = atStart ? xy[2] : xy[xy.length - 3]
      const other = beyond ? roundedNeed(turnAt(from, to, beyond), arcRadius(edge.lines.length)) : Infinity
      const key = `${lng},${lat}`
      const here = ends.get(key) ?? []
      here.push({ edge: e, atStart, dx: leg > 0 ? (to[0] - from[0]) / leg : 0, dy: leg > 0 ? (to[1] - from[1]) / leg : 0, leg, other })
      ends.set(key, here)
    }
  })
  /** What of [end]'s leg a corner at the node wanting [wanted] gets: half of a one-leg edge, else its share. */
  const roomAt = (end: End, wanted: number): number => (end.other === Infinity ? Math.min(wanted, end.leg / 2) : share(wanted, end.other, end.leg))

  // Decided first, on the edges as they are, then applied: an end takes no more of its leg than its share.
  const cuts: { end: End, points: XY[] }[] = []
  const moves: { end: End, to: XY }[] = []
  /** Coming in along [a], the turn onto [b]: left positive. */
  const turnOf = (a: End, b: End): number => Math.atan2(-a.dx * b.dy + a.dy * b.dx, -a.dx * b.dx - a.dy * b.dy)
  /** At a node a street goes straight through, each loop's way back curved onto the street (see above). */
  const mergeOnto = (here: readonly End[]): void => {
    const street = new Set<End>()
    for (const a of here) {
      for (const b of here) {
        if (a.edge !== b.edge && a.leg > 0 && b.leg > 0 && Math.abs(turnOf(a, b)) < ARC_MIN_TURN) street.add(a).add(b)
      }
    }
    for (const side of here) {
      if (street.has(side) || side.leg === 0) continue
      const lines = edges[side.edge]!.lines
      if (edges[side.edge]!.rail) continue
      // The street's lines just the way back's, either side: a loop off it, all its lines round.
      const same = (other: readonly string[]): boolean => other.length === lines.length && lines.every(l => other.includes(l))
      const onto = [...street].filter(s => s.edge !== side.edge && same(edges[s.edge]!.lines))
      if (onto.length < 2) continue
      const b = onto.sort((p, q) => Math.abs(turnOf(side, p)) - Math.abs(turnOf(side, q)))[0]!
      const turn = turnOf(side, b)
      if (Math.abs(turn) < ARC_MIN_TURN || Math.abs(turn) > ARC_MAX_TURN) continue
      const width = Math.max(lines.length, edges[b.edge]!.lines.length)
      const wanted = tangentFor(turn, arcRadius(width))
      const tangent = Math.min(wanted, roomAt(side, wanted), roomAt(b, wanted))
      tallyCorner(tally, turn, wanted, tangent, width)
      const xy = paths[side.edge]!
      const node = side.atStart ? xy[0]! : xy[xy.length - 1]!
      const steps = 2 * Math.max(1, Math.ceil(Math.abs(turn) / ARC_STEP / 2))
      // The whole arc for the way back, from its own leg to the street's; the node along the street
      // to where it lands, so the street stays straight and any swap of its lines is under the arc.
      const arc = arcPoints(node, -side.dx, -side.dy, turn, tangent, steps)
      cuts.push({ end: side, points: arc })
      for (const end of here) if (end !== side) moves.push({ end, to: arc[arc.length - 1]! })
      if (tally) tally.junctions++
      return
    }
  }
  for (const here of ends.values()) {
    let best: { a: End, b: End, shared: number, turn: number } | null = null
    let straightThrough = false
    for (let i = 0; i < here.length; i++) {
      for (let j = i + 1; j < here.length; j++) {
        const a = here[i]!
        const b = here[j]!
        if (a.edge === b.edge || a.leg === 0 || b.leg === 0) continue
        const lines = new Set(edges[a.edge]!.lines)
        const shared = edges[b.edge]!.lines.filter(l => lines.has(l)).length
        if (shared === 0) continue
        // Coming in along a (against the way it leaves the node), going on along b.
        const turn = Math.atan2(-a.dx * b.dy + a.dy * b.dx, -a.dx * b.dx - a.dy * b.dy)
        if (Math.abs(turn) < ARC_MIN_TURN) straightThrough = true
        if (Math.abs(turn) < ARC_MIN_TURN || Math.abs(turn) > ARC_MAX_TURN) continue
        if (!best || shared > best.shared || (shared === best.shared && Math.abs(turn) > Math.abs(best.turn))) best = { a, b, shared, turn }
      }
    }
    if (straightThrough) mergeOnto(here)
    if (!best || straightThrough) continue
    const { a, b, turn } = best
    const radius = arcRadius(Math.max(edges[a.edge]!.lines.length, edges[b.edge]!.lines.length))
    const wanted = tangentFor(turn, radius)
    const tangent = Math.min(wanted, roomAt(a, wanted), roomAt(b, wanted))
    tallyCorner(tally, turn, wanted, tangent, Math.max(edges[a.edge]!.lines.length, edges[b.edge]!.lines.length))
    const xyA = paths[a.edge]!
    const node = a.atStart ? xyA[0]! : xyA[xyA.length - 1]!
    const half = Math.max(1, Math.ceil(Math.abs(turn) / ARC_STEP / 2))
    const arc = arcPoints(node, -a.dx, -a.dy, turn, tangent, half * 2)
    const middle = arc[half]!
    // Each run from the edge's inside to the node, now the arc's middle.
    cuts.push({ end: a, points: arc.slice(0, half + 1) }, { end: b, points: arc.slice(half).reverse() })
    for (const end of here) if (end !== a && end !== b) moves.push({ end, to: middle })
    if (tally) tally.junctions++
  }
  for (const { end, points } of cuts) {
    const xy = paths[end.edge]!
    if (end.atStart) xy.splice(0, 1, ...[...points].reverse())
    else xy.splice(xy.length - 1, 1, ...points)
  }
  for (const { end, to } of moves) {
    const xy = paths[end.edge]!
    xy[end.atStart ? 0 : xy.length - 1] = to
  }
  return paths.map(toLngLats)
}

/*
 * One way per line round a roundabout, as Transit's overview draws one: where a
 * line's two directions part round a small loop (Bundaran HI's two halves), only
 * one side is drawn. Each other piece of the line is walked every DENSE_M; a
 * stretch of it more than NEAR_M from what's kept of the line, leaving and
 * rejoining the same piece of it, is cut when it is short (LOCAL_MAX_M) and runs
 * the same way round as that piece (no more than STRETCH times longer, plus
 * SLACK_M). Kept as Transit keeps them: a one-way pair a block or more apart for
 * longer than that (two strands, Metrobús 4 through Centro), an end loop that
 * comes back where it left (rejoining under LOOP_MIN_M along), a branch, and a
 * stretch leaving or rejoining a kept piece at its end (within END_M): the line
 * goes on from there, round the rest of a terminal loop cut at its terminus (4
 * and 6 at Galunggung, back up to the canal road), with no other side to it. A
 * stretch within NEAR_M (the other carriageway) stays too: it bundles with the
 * rest. The line's own streets, both ways, are still drawn at street zoom and alone.
 */
const DENSE_M = 10
const NEAR_M = 40
const LOCAL_MAX_M = 600
const LOOP_MIN_M = 40
const STRETCH = 3
const SLACK_M = 150
const END_M = DENSE_M
/** A cut reaches back up to TRIM_REACH_M along what is still more than TRIM_M off the line. */
const TRIM_M = 10
const TRIM_REACH_M = 80

type XY = [number, number]

/** [pieces] (one line's, deduped) with the short stretches that bypass the rest cut out. */
export function dropBypasses(pieces: readonly LngLat[][], apart?: KeptApart): LngLat[][] {
  const toXY = (p: readonly LngLat[]): XY[] => p.map(([lng, lat]) => [lng * KX, lat * KY])
  const lengthOf = (p: readonly XY[]): number => {
    let m = 0
    for (let i = 1; i < p.length; i++) m += Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1])
    return m
  }
  const densify = (p: readonly XY[]): XY[] => {
    const out: XY[] = p.length ? [p[0]!] : []
    for (let i = 1; i < p.length; i++) {
      const [ax, ay] = p[i - 1]!
      const [bx, by] = p[i]!
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / DENSE_M))
      for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n])
    }
    return out
  }
  /** Where along [p] it passes nearest [q], and how near: metres along, distance. */
  const nearestOn = (p: readonly XY[], [qx, qy]: XY): [number, number] => {
    let bestD = Infinity
    let bestAt = 0
    let at = 0
    for (let i = 1; i < p.length; i++) {
      const [ax, ay] = p[i - 1]!
      const [bx, by] = p[i]!
      const dx = bx - ax
      const dy = by - ay
      const l = Math.hypot(dx, dy)
      if (l > 0) {
        const t = Math.max(0, Math.min(1, ((qx - ax) * dx + (qy - ay) * dy) / (l * l)))
        const d = Math.hypot(qx - (ax + t * dx), qy - (ay + t * dy))
        if (d < bestD) {
          bestD = d
          bestAt = at + t * l
        }
      }
      at += l
    }
    return [bestAt, bestD]
  }

  // The longest piece is the line's main path; the rest are walked against what's kept, longest first.
  const order = pieces.map((p, i) => ({ i, xy: toXY(p) })).sort((a, b) => lengthOf(b.xy) - lengthOf(a.xy))
  /** The point of [p] nearest [q]. */
  const footOn = (p: readonly XY[], [qx, qy]: XY): XY => {
    let best: XY = p[0]!
    let bestD = Infinity
    for (let i = 1; i < p.length; i++) {
      const [ax, ay] = p[i - 1]!
      const [bx, by] = p[i]!
      const dx = bx - ax
      const dy = by - ay
      const l2 = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((qx - ax) * dx + (qy - ay) * dy) / l2))
      const f: XY = [ax + t * dx, ay + t * dy]
      const d = Math.hypot(qx - f[0], qy - f[1])
      if (d < bestD) {
        bestD = d
        best = f
      }
    }
    return best
  }
  if (!order.length) return []
  const kept: XY[][] = [order[0]!.xy]
  /** Whether [at] metres along kept piece [k] is one of its ends. */
  const atEnd = (k: number, at: number): boolean => at <= END_M || at >= lengthOf(kept[k]!) - END_M
  const out: LngLat[][] = [[...pieces[order[0]!.i]!]]
  for (const { i, xy } of order.slice(1)) {
    const pts = densify(xy)
    const near = pts.map((q) => {
      let best = { k: -1, at: 0, d: Infinity }
      kept.forEach((piece, k) => {
        const [at, d] = nearestOn(piece, q)
        if (d < best.d) best = { k, at, d }
      })
      return best
    })
    const cut = pts.map(() => false)
    // Each stretch off the line, a..b-1: whether it would bypass, and whether the line goes on there.
    const stretches: { a: number, b: number, bypass: boolean, goesOn: boolean }[] = []
    for (let a = 0; a < pts.length;) {
      if (near[a]!.d <= NEAR_M) {
        a++
        continue
      }
      let b = a
      while (b < pts.length && near[b]!.d > NEAR_M) b++
      // A stretch off the line, a..b-1; it bypasses when it leaves and rejoins the same kept piece.
      if (a > 0 && b < pts.length) {
        const from = near[a - 1]!
        const to = near[b]!
        const run = lengthOf(pts.slice(a - 1, b + 1))
        const around = Math.abs(to.at - from.at)
        // The other side of a road split by a toll road isn't a bypass: it is drawn (10 down Yos Sudarso).
        const mid = pts[Math.floor((a + b) / 2)]!
        const split = apart !== undefined && (() => {
          const foot = footOn(kept[from.k]!, mid)
          const [hx, hy] = [pts[b - 1]![0] - pts[a]![0], pts[b - 1]![1] - pts[a]![1]]
          const hl = Math.hypot(hx, hy) || 1
          return apart(mid, foot, [hx / hl, hy / hl])
        })()
        const goesOn = atEnd(from.k, from.at) || atEnd(to.k, to.at)
        const bypass = !split && from.k === to.k && run <= LOCAL_MAX_M && around >= LOOP_MIN_M && around <= run * STRETCH + SLACK_M
        stretches.push({ a, b, bypass, goesOn })
      }
      a = b
    }
    // Round a terminal loop the line goes on, past where it only brushes the line (under
    // SHARED_MIN_M near it), either way: 13E round the block at Puri Beta 2, by the terminus and on.
    for (let s = 1; s < stretches.length; s++) {
      const [p, q] = [stretches[s - 1]!, stretches[s]!]
      if (p.goesOn && (q.a - p.b) * DENSE_M < SHARED_MIN_M) q.goesOn = true
    }
    for (let s = stretches.length - 2; s >= 0; s--) {
      const [p, q] = [stretches[s]!, stretches[s + 1]!]
      if (q.goesOn && (q.a - p.b) * DENSE_M < SHARED_MIN_M) p.goesOn = true
    }
    for (const { a, b, bypass, goesOn } of stretches) {
      if (bypass && !goesOn) {
        for (let k = a; k < b; k++) cut[k] = true
        // And back along where it is still parting from the line, so no stub splays off the bundle.
        for (let k = a - 1, m = 0; k >= 0 && near[k]!.d > TRIM_M && m <= TRIM_REACH_M; k--) {
          cut[k] = true
          m += DENSE_M
        }
        for (let k = b, m = 0; k < pts.length && near[k]!.d > TRIM_M && m <= TRIM_REACH_M; k++) {
          cut[k] = true
          m += DENSE_M
        }
      }
    }
    if (!cut.some(Boolean)) {
      kept.push(xy)
      out.push([...pieces[i]!])
      continue
    }
    let run: XY[] = []
    const flush = (): void => {
      if (run.length >= 2) {
        kept.push(run)
        out.push(run.map(([x, y]) => [x / KX, y / KY] as LngLat))
      }
      run = []
    }
    pts.forEach((p, k) => (cut[k] ? flush() : run.push(p)))
    flush()
  }
  return out
}

/**
 * The koridors Peta Bus draws, for now: the plain-number BRTs and 13E/L13E. The
 * other lines (branches, Angkutan Umum Integrasi) keep their data but aren't on
 * the map until the drawing holds up with them.
 */
export function isDrawn(code: string): boolean {
  return /^\d+$/.test(code) || code === '13E' || code === 'L13E' || isRailCode(code)
}

/** A stroke across an edge: its lines (a run of one colour), its middle in line widths right of the edge's way, its width. */
export interface StrokePlace {
  key: string
  lines: string[]
  slot: number
  width: number
}

/**
 * [edge]'s strokes left to right along it, as clients draw them: each run of lines of one stroke
 * ([strokeOf]: one colour) one stroke, as wide as it's drawn (a rail line RAIL_WEIGHT), side by side
 * across the middle, the edge's shift added.
 */
export function strokePlaces(edge: Pick<BusMapEdge, 'lines' | 'shift'>, strokeOf: ReadonlyMap<string, string>): StrokePlace[] {
  const runs: { key: string, lines: string[] }[] = []
  for (const line of edge.lines) {
    const key = strokeOf.get(line) ?? line
    const run = runs[runs.length - 1]
    if (run && run.key === key) run.lines.push(line)
    else runs.push({ key, lines: [line] })
  }
  const widths = runs.map(run => (run.lines.some(isRailCode) ? RAIL_WEIGHT : 1))
  let left = -widths.reduce((a, b) => a + b, 0) / 2
  return runs.map((run, i) => {
    const slot = left + widths[i]! / 2 + (edge.shift ?? 0)
    left += widths[i]!
    return { ...run, slot, width: widths[i]! }
  })
}

/**
 * How straight [path] (metres) runs about [at]: the chord over the length of the way, [windowM]
 * either side of the point on it nearest [at] (less at its ends). 1 is dead straight; a line turning
 * corners reads well under. A line's step sideways shows on a straight run and hides on a bendy one.
 */
export function straightnessAt(path: readonly [number, number][], at: readonly [number, number], windowM: number): number {
  if (path.length < 2) return 1
  const along = [0]
  for (let i = 1; i < path.length; i++) along.push(along[i - 1]! + Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]))
  // The point on the path nearest [at], as a distance along it.
  let best = Infinity
  let d0 = 0
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1]!
    const [bx, by] = path[i]!
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((at[0] - ax) * dx + (at[1] - ay) * dy) / l2)) : 0
    const d = Math.hypot(at[0] - (ax + t * dx), at[1] - (ay + t * dy))
    if (d < best) {
      best = d
      d0 = along[i - 1]! + t * (along[i]! - along[i - 1]!)
    }
  }
  const total = along[along.length - 1]!
  const lo = Math.max(0, d0 - windowM)
  const hi = Math.min(total, d0 + windowM)
  if (hi - lo < 1) return 1
  const pointAt = (d: number): [number, number] => {
    let i = 1
    while (i < along.length - 1 && along[i]! < d) i++
    const span = along[i]! - along[i - 1]!
    const t = span > 0 ? (d - along[i - 1]!) / span : 0
    return [path[i - 1]![0] + (path[i]![0] - path[i - 1]![0]) * t, path[i - 1]![1] + (path[i]![1] - path[i - 1]![1]) * t]
  }
  const [x0, y0] = pointAt(lo)
  const [x1, y1] = pointAt(hi)
  return Math.min(1, Math.hypot(x1 - x0, y1 - y0) / (hi - lo))
}

/*
 * Lines changing sides where their bundle goes straight on through a node,
 * crossing over: drawn as offsets from the street's middle, a swap there is a
 * jump, each line ending on one side and starting again on the other (4 and 6
 * on Jl. Galunggung, where the loop's way back lands). Over the first CROSS_M
 * of one side (the one the node's other edges don't go on along), in CROSS_STEPS pieces, each stroke is drawn alone at an offset
 * easing from where it comes in to where it goes on, so they cross as Transit
 * draws a crossing; a rail line's stroke as wide as clients draw it (RAIL_WEIGHT).
 */
const CROSS_M = 50
const CROSS_STEPS = 10
const CROSS_TURN_COS = Math.cos((20 * Math.PI) / 180)

/** A stroke moving over this many line widths straight through a node is eased over (crossOver's jumps). */
const JUMP_MIN = 0.5

/** Straight on, for a jump: a line bending this little through the node still jumps across it. */
const JUMP_TURN_COS = Math.cos((45 * Math.PI) / 180)

/**
 * [edges] with each straight-on change of sides drawn as a crossing (see above); with [jumps], a
 * stroke going straight on that moves over by JUMP_MIN or more eased over the same way too, as
 * Transit draws a line easing into its place where another joins (the E onto 53rd St beside B/D).
 */
export function crossOver(edges: readonly BusMapEdge[], strokeOf: ReadonlyMap<string, string>, jumps = false): BusMapEdge[] {
  const paths = edges.map(e => toXYs(decodePolyline(e.shape)))
  const lengthOf = (xy: readonly XY[]): number => xy.reduce((m, p, i) => (i ? m + Math.hypot(p[0] - xy[i - 1]![0], p[1] - xy[i - 1]![1]) : 0), 0)
  /** Each stroke (a run of lines of one colour) of [edge], left to right along it, at its offset from the middle. */
  const strokes = (edge: BusMapEdge): StrokePlace[] => strokePlaces(edge, strokeOf)
  // Each edge's ends at each node, and the way it leaves the node.
  interface End { edge: number, atStart: boolean, dx: number, dy: number }
  const ends = new Map<string, End[]>()
  paths.forEach((xy, e) => {
    if (xy.length < 2) return
    for (const atStart of [true, false]) {
      const way = atStart ? xy : [...xy].reverse()
      const from = way[0]!
      const to = way.find(p => Math.hypot(p[0] - from[0], p[1] - from[1]) >= 20) ?? way[way.length - 1]!
      const d = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1
      const key = `${from[0].toFixed(1)},${from[1].toFixed(1)}`
      ends.set(key, [...ends.get(key) ?? [], { edge: e, atStart, dx: (to[0] - from[0]) / d, dy: (to[1] - from[1]) / d }])
    }
  })
  const out = edges.map(e => [e])
  const crossed = new Set<number>()
  for (const here of ends.values()) {
    for (const a of here) {
      for (const b of here) {
        if (a.edge >= b.edge || crossed.has(a.edge) || crossed.has(b.edge)) continue
        if (-(a.dx * b.dx + a.dy * b.dy) < (jumps ? JUMP_TURN_COS : CROSS_TURN_COS)) continue
        // The crossing on the side the node's other edges don't go straight on along (a way back landing
        // on the street goes on along the side it lands facing), else the longer; out from the node.
        const goingOn = (x: End, y: End): number => here.filter(c => c !== a && c !== b && -(c.dx * x.dx + c.dy * x.dy) > -(c.dx * y.dx + c.dy * y.dy)).length
        const [onA, onB] = [goingOn(a, b), goingOn(b, a)]
        const [host, from] = onA !== onB ? (onB < onA ? [b, a] : [a, b]) : lengthOf(paths[b.edge]!) >= lengthOf(paths[a.edge]!) ? [b, a] : [a, b]
        const hostEdge = edges[host.edge]!
        // Offsets right of the way out: an edge run against it has its right on the left.
        const outward = strokes(hostEdge).map(s => ({ ...s, slot: host.atStart ? s.slot : -s.slot }))
        const inward = new Map(strokes(edges[from.edge]!).map(s => [s.key, from.atStart ? -s.slot : s.slot]))
        const moving = outward.filter(s => inward.has(s.key))
        const swapped = moving.some((s, i) => moving.some((t, j) => i < j && (inward.get(s.key)! - inward.get(t.key)!) * (s.slot - t.slot) < 0))
        const jumped = jumps && moving.some(s => Math.abs(inward.get(s.key)! - s.slot) >= JUMP_MIN)
        if (!swapped && !jumped) continue
        const xy = host.atStart ? paths[host.edge]! : [...paths[host.edge]!].reverse()
        const length = lengthOf(xy)
        const span = Math.min(CROSS_M, length / 3)
        /** The point [m] along [xy], and the index of the vertex after it. */
        const along = (m: number): [XY, number] => {
          let walked = 0
          for (let i = 1; i < xy.length; i++) {
            const leg = Math.hypot(xy[i]![0] - xy[i - 1]![0], xy[i]![1] - xy[i - 1]![1])
            if (walked + leg >= m) {
              const t = leg ? (m - walked) / leg : 0
              return [[xy[i - 1]![0] + (xy[i]![0] - xy[i - 1]![0]) * t, xy[i - 1]![1] + (xy[i]![1] - xy[i - 1]![1]) * t], i]
            }
            walked += leg
          }
          return [xy[xy.length - 1]!, xy.length - 1]
        }
        /** [xy] between [m0] and [m1] along it. */
        const between = (m0: number, m1: number): XY[] => {
          const [p0, i0] = along(m0)
          const [p1, i1] = along(m1)
          return [p0, ...xy.slice(i0, i1), p1]
        }
        const pieces: BusMapEdge[] = []
        for (let k = 0; k < CROSS_STEPS; k++) {
          const shape = encodePolyline(toLngLats(between((span * k) / CROSS_STEPS, (span * (k + 1)) / CROSS_STEPS)))
          const t = (k + 0.5) / CROSS_STEPS
          const ease = t * t * (3 - 2 * t)
          for (const s of outward) {
            const start = inward.get(s.key) ?? s.slot
            const shift = Math.round((start + (s.slot - start) * ease) * 1e3) / 1e3
            pieces.push({ shape, lines: s.lines, ...(shift !== 0 ? { shift } : {}) })
          }
        }
        // The rest of the side on from the crossing, as it was and the way it ran.
        const rest = between(span, length)
        const restShape = encodePolyline(toLngLats(host.atStart ? rest : [...rest].reverse()))
        out[host.edge] = [{ ...hostEdge, shape: restShape }, ...pieces]
        crossed.add(host.edge)
      }
    }
  }
  return out.flat()
}

/*
 * Knots of junctions drawn as one: where lines part and join again within a
 * bundle's width or so (the E leaving 8th Av and joining B/D on 53rd St, three
 * nodes 50 m apart; 1/2/3 and N/Q/R/W sharing 40 m where 7th Av and Broadway
 * cross), the short edges between are narrower than the strokes drawn on them,
 * and the lines kink through them. Each edge shorter than minM, from a junction
 * to a node that isn't a line's end, is drawn into one node, shortest first,
 * the edges there ending at it: the junction, or between two junctions their
 * middle. Not where that would close a longer edge between the two into a loop
 * (10's two one-way streets near Tanjung Priok, one taken in short pieces); a
 * short one so closed, a knot's last side, is dropped. Its lines go on through
 * the node.
 */
export function contractShortEdges(edges: readonly BusMapEdge[], minM: number): BusMapEdge[] {
  const keyOf = (p: XY): string => `${p[0].toFixed(1)},${p[1].toFixed(1)}`
  const lengthOf = (xy: readonly XY[]): number => xy.reduce((m, p, i) => (i ? m + Math.hypot(p[0] - xy[i - 1]![0], p[1] - xy[i - 1]![1]) : 0), 0)
  const middleOf = (xy: readonly XY[]): XY => {
    let left = lengthOf(xy) / 2
    for (let i = 1; i < xy.length; i++) {
      const leg = Math.hypot(xy[i]![0] - xy[i - 1]![0], xy[i]![1] - xy[i - 1]![1])
      if (leg >= left) {
        const t = leg ? left / leg : 0
        return [xy[i - 1]![0] + (xy[i]![0] - xy[i - 1]![0]) * t, xy[i - 1]![1] + (xy[i]![1] - xy[i - 1]![1]) * t]
      }
      left -= leg
    }
    return xy[xy.length - 1]!
  }
  let list: { edge: BusMapEdge, path: XY[] }[] = edges.map(e => ({ edge: e, path: toXYs(decodePolyline(e.shape)) })).filter(e => e.path.length >= 2)
  for (;;) {
    const degree = new Map<string, number>()
    for (const { path } of list) for (const p of [path[0]!, path[path.length - 1]!]) degree.set(keyOf(p), (degree.get(keyOf(p)) ?? 0) + 1)
    const lengths = list.map(({ path }) => lengthOf(path))
    /** Whether an edge but [i] runs between [a] and [b] at least [minM] long: drawn into one node, it would be a loop. */
    const closes = (i: number, a: string, b: string): boolean => list.some(({ path }, j) => {
      if (j === i || lengths[j]! < minM) return false
      const [c, d] = [keyOf(path[0]!), keyOf(path[path.length - 1]!)]
      return (c === a && d === b) || (c === b && d === a)
    })
    let shortest = -1
    let shortestM = minM
    list.forEach(({ path }, i) => {
      const [a, b] = [keyOf(path[0]!), keyOf(path[path.length - 1]!)]
      const [da, db] = [degree.get(a)!, degree.get(b)!]
      if (a === b || da < 2 || db < 2 || (da < 3 && db < 3)) return
      if (lengths[i]! < shortestM && !closes(i, a, b)) {
        shortest = i
        shortestM = lengths[i]!
      }
    })
    if (shortest < 0) break
    const gone = list[shortest]!.path
    const ends = new Set([keyOf(gone[0]!), keyOf(gone[gone.length - 1]!)])
    // The junction stays where it is, taking the short edge in; two junctions meet at its middle.
    const [startDegree, endDegree] = [degree.get(keyOf(gone[0]!))!, degree.get(keyOf(gone[gone.length - 1]!))!]
    const node = startDegree >= 3 && endDegree >= 3 ? middleOf(gone) : startDegree >= 3 ? gone[0]! : gone[gone.length - 1]!
    list = list
      .filter((_, i) => i !== shortest)
      .map(({ edge, path }) => {
        let moved = [...path]
        // Its points the knot covered dropped, so it leaves the node straight on rather than hooking back.
        const near = (p: XY): boolean => Math.hypot(p[0] - node[0], p[1] - node[1]) < shortestM
        if (ends.has(keyOf(moved[0]!))) {
          while (moved.length > 2 && near(moved[1]!)) moved = moved.slice(1)
          moved[0] = node
        }
        if (ends.has(keyOf(moved[moved.length - 1]!))) {
          while (moved.length > 2 && near(moved[moved.length - 2]!)) moved = moved.slice(0, -1)
          moved[moved.length - 1] = node
        }
        return { edge, path: moved }
      })
      .filter(({ path }) => keyOf(path[0]!) !== keyOf(path[path.length - 1]!) || lengthOf(path) >= 3 * minM)
  }
  // Two edges the knots left between the same two nodes, side by side (BUBBLE_M), one street drawn
  // twice: KCI A up into Duri on C's track and back out on T's, 20 m apart, whose ends 9 m apart
  // were one node only once the knot there was drawn in. Folded into the one with more lines, each
  // line of the other beside the line it ran beside there.
  const pairs = new Map<string, number[]>()
  list.forEach(({ path }, i) => {
    const [a, b] = [keyOf(path[0]!), keyOf(path[path.length - 1]!)]
    if (a === b) return
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    pairs.set(key, [...(pairs.get(key) ?? []), i])
  })
  const folded = new Set<number>()
  const widest = (from: readonly XY[], to: readonly XY[]): number => Math.max(...from.map(p => nearestOn(to, p)))
  for (const group of pairs.values()) {
    if (group.length < 2) continue
    const sorted = [...group].sort((i, j) => list[j]!.edge.lines.length - list[i]!.edge.lines.length || lengthOf(list[j]!.path) - lengthOf(list[i]!.path))
    const keep = list[sorted[0]!]!
    for (const i of sorted.slice(1)) {
      const fold = list[i]!
      // Tracks only: a bus line's two carriageways, or a loop round a block, stay two (folding them
      // parted lines side by side at Cawang).
      if (![...keep.edge.lines, ...fold.edge.lines].every(isRailCode)) continue
      const [lk, lf] = [lengthOf(keep.path), lengthOf(fold.path)]
      if (Math.max(lk, lf) > BUBBLE_STRETCH * Math.min(lk, lf)) continue
      if (widest(fold.path, keep.path) > BUBBLE_M || widest(keep.path, fold.path) > BUBBLE_M) continue
      // The fold's lines along keep's way: run against it, its left to right is the other way round.
      const same = keyOf(fold.path[0]!) === keyOf(keep.path[0]!)
      const order = same ? fold.edge.lines : [...fold.edge.lines].reverse()
      const lines = [...new Set([...keep.edge.lines, ...order])]
      // In the order of an edge going on from either end with them all (A, T and C south of Duri),
      // along keep's way; else each of the fold's beside the line it ran beside.
      const [start, end] = [keyOf(keep.path[0]!), keyOf(keep.path[keep.path.length - 1]!)]
      const alongKeep = list.flatMap((other, j): string[][] => {
        if (group.includes(j) || !lines.every(l => other.edge.lines.includes(l))) return []
        const [os, oe] = [keyOf(other.path[0]!), keyOf(other.path[other.path.length - 1]!)]
        const kept = other.edge.lines.filter(l => lines.includes(l))
        if (oe === start || os === end) return [kept]
        if (os === start || oe === end) return [[...kept].reverse()]
        return []
      })[0]
      const merged = alongKeep ?? [...keep.edge.lines]
      if (!alongKeep) {
        order.forEach((line, k) => {
          if (merged.includes(line)) return
          const before = order.slice(0, k).reverse().find(l => merged.includes(l))
          merged.splice(before === undefined ? 0 : merged.indexOf(before) + 1, 0, line)
        })
      }
      keep.edge = { ...keep.edge, lines: merged }
      folded.add(i)
    }
  }
  return list.filter((_, i) => !folded.has(i)).map(({ edge, path }) => ({ ...edge, shape: encodePolyline(toLngLats(path)) }))
}

/** Two edges between the same nodes this close all along, no longer than this many times each other, are one street. */
const BUBBLE_M = 40
const BUBBLE_STRETCH = 1.5

/** How far [p] lies from the polyline [path], in its own units. */
function nearestOn(path: readonly XY[], p: XY): number {
  let best = Infinity
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1]!
    const [bx, by] = path[i]!
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2))
    best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)))
  }
  return best
}
