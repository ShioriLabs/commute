import * as fs from 'node:fs'
import { decodePolyline, type LngLat } from '../../utils/polyline'
import { straightnessAt, strokeKeys, strokePlaces, type BusMapEdge } from './busMapBundle'

/*
 * How tidy Peta Bus's network is, from the edges as shipped: the yardstick for
 * the drawing (bundling, ordering) between runs. Topology is rebuilt from the
 * edges' ends, which meet exactly at their shared nodes.
 *
 *   pnpm --filter api exec tsx src/db/scripts/busMapStats.ts [path to bus-map.json]
 *
 * Crossings are counted only at nodes, where a line's place across a street can
 * change: two lines carrying on along the same edges in swapped order (same),
 * or two lines parting with the one going left on the right (split).
 */

const KX = Math.cos((-6.2 * Math.PI) / 180) * 111_320
const KY = 110_574

export interface NetworkStats {
  edges: number
  shortEdges: number
  nodes: number
  junctions: number
  sameCrossings: number
  splitCrossings: number
}

interface End {
  edge: number
  /** Whether the edge starts here (else it ends here). */
  start: boolean
  /** Unit direction leaving the node along the edge. */
  dx: number
  dy: number
}

const key = ([lng, lat]: LngLat): string => `${lng.toFixed(5)},${lat.toFixed(5)}`

/** The edge's lines left to right as seen travelling along it away from the node, or towards it. */
function across(edge: BusMapEdge, end: End, leaving: boolean): string[] {
  // Stored left to right along the shape; leaving from its start or arriving at its end is that way.
  const along = end.start === leaving
  return along ? edge.lines : [...edge.lines].reverse()
}

/**
 * [edges]' counts; with [strokeOf], two lines of one stroke (13 and L13E, one purple) are drawn as
 * one, and their order within it crosses nothing.
 */
export function networkStats(edges: readonly BusMapEdge[], strokeOf: ReadonlyMap<string, string> = new Map()): NetworkStats {
  const shapes = edges.map(e => decodePolyline(e.shape))
  const at = new Map<string, End[]>()
  let shortEdges = 0
  shapes.forEach((pts, i) => {
    let m = 0
    for (let k = 1; k < pts.length; k++) m += Math.hypot((pts[k]![0] - pts[k - 1]![0]) * KX, (pts[k]![1] - pts[k - 1]![1]) * KY)
    if (m < 50) shortEdges++
    for (const start of [true, false]) {
      const here = start ? pts[0]! : pts[pts.length - 1]!
      // The direction away from the node, over the edge's first ~30 m.
      const seq = start ? pts : [...pts].reverse()
      let to = seq[seq.length - 1]!
      for (const p of seq.slice(1)) {
        if (Math.hypot((p[0] - here[0]) * KX, (p[1] - here[1]) * KY) >= 30) {
          to = p
          break
        }
      }
      const dx = (to[0] - here[0]) * KX
      const dy = (to[1] - here[1]) * KY
      const d = Math.hypot(dx, dy) || 1
      const list = at.get(key(here)) ?? []
      list.push({ edge: i, start, dx: dx / d, dy: dy / d })
      at.set(key(here), list)
    }
  })

  let same = 0
  let split = 0
  let junctions = 0
  for (const ends of at.values()) {
    if (ends.length >= 3) junctions++
    // Each line's two ends here: where it comes from and where it goes. A line on more ends is skipped.
    const ofLine = new Map<string, End[]>()
    for (const end of ends) {
      for (const line of edges[end.edge]!.lines) ofLine.set(line, [...(ofLine.get(line) ?? []), end])
    }
    const through = [...ofLine].filter(([, e]) => e.length === 2)
    for (let i = 0; i < through.length; i++) {
      for (let j = i + 1; j < through.length; j++) {
        const [a, [a1, a2]] = through[i]!
        const [b, [b1, b2]] = through[j]!
        if (strokeOf.has(a) && strokeOf.get(a) === strokeOf.get(b)) continue
        // Look from each edge they share into the node.
        for (const [inA, outA, inB, outB] of [[a1!, a2!, b1!, b2!], [a2!, a1!, b2!, b1!]] as const) {
          if (inA.edge !== inB.edge) continue
          const arriving = across(edges[inA.edge]!, inA, false)
          const aLeftOfB = arriving.indexOf(a) < arriving.indexOf(b)
          if (outA.edge === outB.edge) {
            const leaving = across(edges[outA.edge]!, outA, true)
            if ((leaving.indexOf(a) < leaving.indexOf(b)) !== aLeftOfB) same++
          } else {
            // Arriving along -in, is A's way out to the left of B's? Compare the turn angles.
            const hx = -inA.dx
            const hy = -inA.dy
            const turn = (o: End): number => Math.atan2(hx * o.dy - hy * o.dx, hx * o.dx + hy * o.dy)
            const aGoesLeft = turn(outA) > turn(outB)
            if (aGoesLeft !== aLeftOfB) split++
          }
        }
      }
    }
  }
  // Each same-edge pair was seen from both of its sides: count it once.
  return {
    edges: edges.length,
    shortEdges,
    nodes: at.size,
    junctions,
    sameCrossings: Math.round(same / 2),
    splitCrossings: split
  }
}

/*
 * The drawing's score: what the network asks of a reader, from the edges as
 * shipped (what clients draw), summed over all of it so a change is judged
 * everywhere at once rather than at the spots looked at. Lower is better.
 *
 *   - jog: at each node a line passes through, how far its place across the
 *     street moves, in line widths (a rail line RAIL_WEIGHT wide, as drawn), in
 *     full going straight on and TURN_JOG of it turning, as bundleShifts weighs
 *     them; and by how straight the line runs there (straightnessAt over
 *     STRAIGHT_WINDOW_M): a step on a straight run shows, on a bendy one it hides
 *     (VISIBLE_FLOOR of it at the bendiest).
 *   - crossings: two strokes going on together in swapped order (same), or
 *     parting with the one going left on the right (split), as networkStats
 *     counts them, a pair of strokes once.
 *   - separations: two strokes side by side coming in that go on along the same
 *     edge with another between them: the LOOM paper's (Bast, Brosi, Storandt)
 *     partners parting.
 *   - overlap: metres where two edges run alongside closer than their bundles
 *     are wide, away from the nodes they meet at: one street drawn twice (KCI A
 *     up into Duri on C's track and back out on T's).
 *
 * The composite weighs a same crossing SAME_WEIGHT, a split SPLIT_WEIGHT
 * (LOOM's 4:1, the bundler's own), a separation SEPARATION_WEIGHT (LOOM's 3),
 * against a line width of jog, and OVERLAP_PER_M a metre of overlap. Edges along
 * one way (a crossing's pieces, a stroke apiece) are taken as one, each line at
 * its own place on it.
 *
 *   pnpm --filter api exec tsx src/db/scripts/busMapStats.ts [bus-map.json]
 *   pnpm --filter api exec tsx src/db/scripts/busMapStats.ts --compare before.json after.json
 *   pnpm --filter api exec tsx src/db/scripts/busMapStats.ts [bus-map.json] --json score.json
 */

/** A line as the score reads it: its colour (its stroke) and its own way, as drawn. */
export interface ScoreLine {
  code: string
  color: string
  shapes?: string[]
  drawn?: string[]
}

export interface ScoredMap {
  edges: BusMapEdge[]
  lines: ScoreLine[]
}

/** One line's share: its jog (weighted, and widths moved), its length, its crossings and separations. */
export interface LineScore {
  jog: number
  moved: number
  km: number
  crossings: number
  separations: number
}

/** A place the score is charged at: a node, or a stretch of overlap. */
export interface Spot {
  lng: number
  lat: number
  score: number
  what: string
  lines: string[]
}

export interface NetworkScore {
  composite: number
  jog: number
  /** Line widths moved across, unweighted. */
  moved: number
  sameCrossings: number
  splitCrossings: number
  separations: number
  overlapM: number
  lines: Record<string, LineScore>
  worst: Spot[]
}

const TURN_JOG = 0.2
const STRAIGHT_TURN = (30 * Math.PI) / 180
const STRAIGHT_WINDOW_M = 400
/** Straightness from which a step starts to show, and by which it shows in full. */
const STRAIGHT_FROM = 0.9
const STRAIGHT_TO = 0.98
const VISIBLE_FLOOR = 0.25
const SAME_WEIGHT = 4
const SPLIT_WEIGHT = 1
const SEPARATION_WEIGHT = 3
const OVERLAP_PER_M = 1 / 25
const OVERLAP_STEP_M = 5
/** Overlap is looked for this far from an edge's ends on, where edges meeting at a node draw together anyway. */
const OVERLAP_CLEAR_M = 30
/** Two ways this near parallel run alongside; more across, they cross. */
const ALONGSIDE_COS = Math.cos((25 * Math.PI) / 180)
/** A bus line's width at z15 in dp: Android's BUS_LINE_W_15_DP. */
const LINE_DP_15 = 3.5

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/** How much a step shows on a line [s] straight there. */
const visible = (s: number): number => VISIBLE_FLOOR + (1 - VISIBLE_FLOOR) * clamp01((s - STRAIGHT_FROM) / (STRAIGHT_TO - STRAIGHT_FROM))

/** The distance from [p] to the polyline [path], and the unit way of its nearest leg. */
function nearestOn(path: readonly [number, number][], p: readonly [number, number]): { d: number, ux: number, uy: number } {
  let best = { d: Infinity, ux: 1, uy: 0 }
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1]!
    const [bx, by] = path[i]!
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy
    if (l2 === 0) continue
    const t = clamp01(((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)
    const d = Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy))
    if (d < best.d) {
      const l = Math.sqrt(l2)
      best = { d, ux: dx / l, uy: dy / l }
    }
  }
  return best
}

const lengthOf = (path: readonly [number, number][]): number =>
  path.reduce((m, p, i) => (i ? m + Math.hypot(p[0] - path[i - 1]![0], p[1] - path[i - 1]![1]) : 0), 0)

/** [map]'s score (see above), its [worstN] worst places listed. */
export function networkScore(map: ScoredMap, worstN = 20): NetworkScore {
  const strokeOf = strokeKeys(map.lines)
  const strokeOfLine = (line: string): string => strokeOf.get(line) ?? line
  // Metres at the map's own latitude: Jakarta's or New York's.
  const corners = map.edges.flatMap((edge) => {
    const p = decodePolyline(edge.shape)
    return p.length ? [p[0]!, p[p.length - 1]!] : []
  })
  const lat0 = corners.reduce((m, p) => m + p[1], 0) / Math.max(1, corners.length)
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111_320
  const ky = 110_574
  const xy = ([lng, lat]: LngLat): [number, number] => [lng * kx, lat * ky]
  const lineM = (LINE_DP_15 * 40_075_016.686 * Math.cos((lat0 * Math.PI) / 180)) / (512 * 2 ** 15)

  // Edges along one way as one, each line at its place on it.
  interface Way {
    pts: [number, number][]
    lngLats: LngLat[]
    place: Map<string, number>
    slots: number[]
    width: number
    lines: string[]
  }
  const ways: Way[] = []
  const byShape = new Map<string, Way>()
  for (const edge of map.edges) {
    let way = byShape.get(edge.shape)
    if (!way) {
      const lngLats = decodePolyline(edge.shape)
      if (lngLats.length < 2) continue
      way = { pts: lngLats.map(xy), lngLats, place: new Map(), slots: [], width: 0, lines: [] }
      byShape.set(edge.shape, way)
      ways.push(way)
    }
    for (const stroke of strokePlaces(edge, strokeOf)) {
      way.slots.push(stroke.slot)
      way.width += stroke.width
      for (const line of stroke.lines) {
        way.place.set(line, stroke.slot)
        way.lines.push(line)
      }
    }
  }
  for (const way of ways) way.slots.sort((a, b) => a - b)
  /** Whether no stroke on [way] lies between places [a] and [b]. */
  const adjacent = (way: Way, a: number, b: number): boolean => {
    const [lo, hi] = a < b ? [a, b] : [b, a]
    return !way.slots.some(s => s > lo + 1e-6 && s < hi - 1e-6)
  }

  // Each way's ends at each node, and the way it leaves the node (over its first ~30 m).
  interface End { way: number, start: boolean, dx: number, dy: number }
  const at = new Map<string, { node: LngLat, ends: End[] }>()
  ways.forEach((way, w) => {
    for (const start of [true, false]) {
      const seq = start ? way.pts : [...way.pts].reverse()
      const here = seq[0]!
      const to = seq.find(p => Math.hypot(p[0] - here[0], p[1] - here[1]) >= 30) ?? seq[seq.length - 1]!
      const d = Math.hypot(to[0] - here[0], to[1] - here[1]) || 1
      const node = start ? way.lngLats[0]! : way.lngLats[way.lngLats.length - 1]!
      const k = key(node)
      const atNode = at.get(k) ?? { node, ends: [] }
      atNode.ends.push({ way: w, start, dx: (to[0] - here[0]) / d, dy: (to[1] - here[1]) / d })
      at.set(k, atNode)
    }
  })

  // Each line's own way, as drawn, for how straight it runs at a node.
  const pathsOf = new Map(map.lines.map((line) => {
    const pieces = line.drawn?.length ? line.drawn.map(s => decodePolyline(s, 6)) : (line.shapes ?? []).map(s => decodePolyline(s))
    return [line.code, pieces.map(p => p.map(xy))] as const
  }))
  const straightCache = new Map<string, number>()
  const straightness = (line: string, node: [number, number], nodeKey: string): number => {
    const cached = straightCache.get(`${line}|${nodeKey}`)
    if (cached !== undefined) return cached
    let nearest: [number, number][] | undefined
    let best = Infinity
    for (const path of pathsOf.get(line) ?? []) {
      const { d } = nearestOn(path, node)
      if (d < best) {
        best = d
        nearest = path
      }
    }
    const s = nearest ? straightnessAt(nearest, node, STRAIGHT_WINDOW_M) : 1
    straightCache.set(`${line}|${nodeKey}`, s)
    return s
  }

  const lines: Record<string, LineScore> = {}
  const lineScore = (code: string): LineScore => (lines[code] ??= { jog: 0, moved: 0, km: 0, crossings: 0, separations: 0 })
  for (const [code, paths] of pathsOf) lineScore(code).km = paths.reduce((m, p) => m + lengthOf(p), 0) / 1000
  const spots: Spot[] = []
  let jog = 0
  let moved = 0
  let same = 0
  let split = 0
  let separations = 0

  for (const [nodeKey, { node, ends }] of at) {
    const nodeXY = xy(node)
    // Each line's ends here, paired straightest first: where it comes in and where it goes on.
    const ofLine = new Map<string, End[]>()
    for (const end of ends) for (const line of ways[end.way]!.place.keys()) ofLine.set(line, [...(ofLine.get(line) ?? []), end])
    const passes: { line: string, a: End, b: End }[] = []
    for (const [line, here] of ofLine) {
      if (here.length < 2) continue
      const pairs: [number, number, number][] = []
      for (let i = 0; i < here.length; i++) for (let j = i + 1; j < here.length; j++) pairs.push([i, j, here[i]!.dx * here[j]!.dx + here[i]!.dy * here[j]!.dy])
      const used = new Set<number>()
      for (const [i, j] of pairs.sort((p, q) => p[2] - q[2])) {
        if (used.has(i) || used.has(j)) continue
        used.add(i)
        used.add(j)
        passes.push({ line, a: here[i]!, b: here[j]! })
      }
    }
    // A line's place right of its way, coming in to the node along [end]'s way, or going out along it.
    const placeIn = (line: string, end: End): number => (end.start ? -1 : 1) * ways[end.way]!.place.get(line)!
    const placeOut = (line: string, end: End): number => (end.start ? 1 : -1) * ways[end.way]!.place.get(line)!

    let nodeJog = 0
    let nodeSame = 0
    let nodeSplit = 0
    let nodeSep = 0
    const involved = new Set<string>()
    for (const { line, a, b } of passes) {
      const step = Math.abs(placeOut(line, b) - placeIn(line, a))
      if (step < 1e-6) continue
      // In along a (against its way out of the node), on along b.
      const turn = Math.acos(Math.max(-1, Math.min(1, -(a.dx * b.dx + a.dy * b.dy))))
      const weighed = step * (turn < STRAIGHT_TURN ? 1 : TURN_JOG) * visible(straightness(line, nodeXY, nodeKey))
      nodeJog += weighed
      moved += step
      lineScore(line).jog += weighed
      lineScore(line).moved += step
      involved.add(line)
    }

    // Pairs of strokes through here: a pair once, seen from each way they share coming in.
    const seen = new Set<string>()
    for (let i = 0; i < passes.length; i++) {
      for (let j = i + 1; j < passes.length; j++) {
        const p = passes[i]!
        const q = passes[j]!
        const [sp, sq] = [strokeOfLine(p.line), strokeOfLine(q.line)]
        if (sp === sq) continue
        for (const [inP, outP, inQ, outQ] of [[p.a, p.b, q.a, q.b], [p.b, p.a, q.b, q.a]] as const) {
          if (inP !== inQ) continue
          const pair = `${sp < sq ? sp : sq}|${sp < sq ? sq : sp}|${inP.way}${inP.start}|${outP.way}${outP.start}|${outQ.way}${outQ.start}`
          if (seen.has(pair)) continue
          seen.add(pair)
          const pIn = placeIn(p.line, inP)
          const qIn = placeIn(q.line, inP)
          const leftIn = pIn < qIn
          if (outP === outQ) {
            const pOut = placeOut(p.line, outP)
            const qOut = placeOut(q.line, outP)
            // Seen from both ways it's shared: half each time.
            if ((pOut < qOut) !== leftIn) nodeSame += 0.5
            if (adjacent(ways[inP.way]!, pIn, qIn) && !adjacent(ways[outP.way]!, pOut, qOut)) nodeSep++
          } else {
            const hx = -inP.dx
            const hy = -inP.dy
            const turnOf = (o: End): number => Math.atan2(hx * o.dy - hy * o.dx, hx * o.dx + hy * o.dy)
            if ((turnOf(outP) > turnOf(outQ)) !== leftIn) nodeSplit++
          }
        }
      }
    }
    // Charged to the lines too, as crossings and separations happen between them.
    if (nodeSame + nodeSplit + nodeSep > 0) for (const line of ofLine.keys()) involved.add(line)
    jog += nodeJog
    same += nodeSame
    split += nodeSplit
    separations += nodeSep
    const score = nodeJog + SAME_WEIGHT * nodeSame + SPLIT_WEIGHT * nodeSplit + SEPARATION_WEIGHT * nodeSep
    if (score > 0) {
      spots.push({
        lng: node[0],
        lat: node[1],
        score,
        what: [nodeJog > 0 ? `jog ${nodeJog.toFixed(2)}` : '', nodeSame ? `same ${nodeSame}` : '', nodeSplit ? `split ${nodeSplit}` : '', nodeSep ? `sep ${nodeSep}` : ''].filter(Boolean).join(', '),
        lines: [...involved].sort()
      })
    }
    for (const line of involved) {
      if (nodeSame + nodeSplit > 0) lineScore(line).crossings += nodeSame + nodeSplit
      if (nodeSep > 0) lineScore(line).separations += nodeSep
    }
  }

  // Overlap: each way's points, away from its ends, near another way running alongside, closer than
  // the two bundles' half widths; a stretch of it one place.
  const CELL = 50
  const grid = new Map<string, number[]>()
  const cellOf = (x: number, y: number): string => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`
  const lengths = ways.map(w => lengthOf(w.pts))
  ways.forEach((way, w) => {
    if (lengths[w]! < OVERLAP_CLEAR_M) return
    // Every cell each leg passes through, stepped half a cell at a time.
    const cells = new Set<string>()
    for (const [x, y] of way.pts) cells.add(cellOf(x, y))
    for (let i = 1; i < way.pts.length; i++) {
      const [ax, ay] = way.pts[i - 1]!
      const [bx, by] = way.pts[i]!
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL / 2))
      for (let k = 1; k < steps; k++) cells.add(cellOf(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps))
    }
    for (const c of cells) grid.set(c, [...(grid.get(c) ?? []), w])
  })
  const strokeSets = new Map<Way, string>()
  const strokeSet = (way: Way): string => {
    let set = strokeSets.get(way)
    if (set === undefined) {
      set = [...new Set(way.lines.map(strokeOfLine))].sort().join(' ')
      strokeSets.set(way, set)
    }
    return set
  }
  let overlapM = 0
  ways.forEach((way, w) => {
    const total = lengths[w]!
    if (total < 2 * OVERLAP_CLEAR_M) return
    let run: { from: number, to: number, with: Set<number> } | undefined
    const close = (): void => {
      if (!run) return
      const m = (run.to - run.from + OVERLAP_STEP_M) / 2
      overlapM += m
      const mid = pointAlong(way.pts, (run.from + run.to) / 2)
      const lines = new Set(way.lines)
      for (const v of run.with) for (const l of ways[v]!.lines) lines.add(l)
      spots.push({ lng: mid[0] / kx, lat: mid[1] / ky, score: m * OVERLAP_PER_M, what: `overlap ${m.toFixed(0)} m`, lines: [...lines].sort() })
      run = undefined
    }
    for (let d = OVERLAP_CLEAR_M; d <= total - OVERLAP_CLEAR_M; d += OVERLAP_STEP_M) {
      const p = pointAlong(way.pts, d)
      const ahead = pointAlong(way.pts, Math.min(total, d + 1))
      const ul = Math.hypot(ahead[0] - p[0], ahead[1] - p[1]) || 1
      const [ux, uy] = [(ahead[0] - p[0]) / ul, (ahead[1] - p[1]) / ul]
      const candidates = new Set<number>()
      const [cx, cy] = [Math.floor(p[0] / CELL), Math.floor(p[1] / CELL)]
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) for (const v of grid.get(`${gx},${gy}`) ?? []) if (v !== w) candidates.add(v)
      const near: number[] = []
      for (const v of candidates) {
        // The same strokes on both (a line's two ways on a street's two carriageways) read as one line.
        if (strokeSet(way) === strokeSet(ways[v]!)) continue
        const { d: gap, ux: vx, uy: vy } = nearestOn(ways[v]!.pts, p)
        if (gap < ((way.width + ways[v]!.width) / 2) * lineM && Math.abs(ux * vx + uy * vy) >= ALONGSIDE_COS) near.push(v)
      }
      if (near.length) {
        run ??= { from: d, to: d, with: new Set() }
        run.to = d
        for (const v of near) run.with.add(v)
      } else {
        close()
      }
    }
    close()
  })

  const composite = jog + SAME_WEIGHT * same + SPLIT_WEIGHT * split + SEPARATION_WEIGHT * separations + OVERLAP_PER_M * overlapM
  return {
    composite,
    jog,
    moved,
    sameCrossings: same,
    splitCrossings: split,
    separations,
    overlapM,
    lines,
    worst: spots.sort((a, b) => b.score - a.score).slice(0, worstN)
  }
}

/** The point [d] metres along [path]. */
function pointAlong(path: readonly [number, number][], d: number): [number, number] {
  let walked = 0
  for (let i = 1; i < path.length; i++) {
    const leg = Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1])
    if (walked + leg >= d) {
      const t = leg ? (d - walked) / leg : 0
      return [path[i - 1]![0] + (path[i]![0] - path[i - 1]![0]) * t, path[i - 1]![1] + (path[i]![1] - path[i - 1]![1]) * t]
    }
    walked += leg
  }
  return path[path.length - 1]!
}

const round = (v: number, digits = 1): string => v.toFixed(digits)

/** [score] as a few lines: its components, then its worst places. */
export function formatScore(score: NetworkScore, title = 'score'): string {
  const out = [
    `${title}: composite ${round(score.composite)} = jog ${round(score.jog)} (${round(score.moved)} widths moved)`
    + ` + crossings ${round(score.sameCrossings, 1)} same, ${score.splitCrossings} split + separations ${score.separations} + overlap ${round(score.overlapM, 0)} m`
  ]
  score.worst.forEach((spot, i) => {
    out.push(`  ${String(i + 1).padStart(2)}. ${round(spot.score, 2).padStart(6)}  ${spot.lat.toFixed(5)},${spot.lng.toFixed(5)}  ${spot.what}  [${spot.lines.join(' ')}]`)
  })
  return out.join('\n')
}

/** [after] against [before]: each component, the lines whose jog moved most either way, and places new to the worst or gone from it. */
export function formatComparison(before: NetworkScore, after: NetworkScore): string {
  const row = (name: string, a: number, b: number): string => {
    const pct = a ? ((b - a) / a) * 100 : b ? Infinity : 0
    return `  ${name.padEnd(12)} ${round(a).padStart(9)} -> ${round(b).padStart(9)}  ${pct === 0 ? '' : `${pct > 0 ? '+' : ''}${round(pct)}%`}`
  }
  const out = [
    'component        before       after',
    row('composite', before.composite, after.composite),
    row('jog', before.jog, after.jog),
    row('moved', before.moved, after.moved),
    row('same', before.sameCrossings, after.sameCrossings),
    row('split', before.splitCrossings, after.splitCrossings),
    row('separations', before.separations, after.separations),
    row('overlap m', before.overlapM, after.overlapM)
  ]
  const codes = [...new Set([...Object.keys(before.lines), ...Object.keys(after.lines)])]
  const deltas = codes.map(c => [c, (after.lines[c]?.jog ?? 0) - (before.lines[c]?.jog ?? 0)] as const).filter(([, d]) => Math.abs(d) > 0.01)
  const worse = [...deltas].sort((a, b) => b[1] - a[1]).filter(([, d]) => d > 0).slice(0, 10)
  const better = [...deltas].sort((a, b) => a[1] - b[1]).filter(([, d]) => d < 0).slice(0, 10)
  out.push(`  jog worse:  ${worse.map(([c, d]) => `${c} +${round(d, 2)}`).join(', ') || '-'}`)
  out.push(`  jog better: ${better.map(([c, d]) => `${c} ${round(d, 2)}`).join(', ') || '-'}`)
  const near = (a: Spot, b: Spot): boolean => Math.hypot((a.lng - b.lng) * 110_000, (a.lat - b.lat) * 110_000) < 50
  const fresh = after.worst.filter(s => !before.worst.some(b => near(s, b)))
  const gone = before.worst.filter(s => !after.worst.some(a => near(s, a)))
  out.push('  new in worst:')
  for (const s of fresh) out.push(`    ${round(s.score, 2).padStart(6)}  ${s.lat.toFixed(5)},${s.lng.toFixed(5)}  ${s.what}  [${s.lines.join(' ')}]`)
  out.push('  gone from worst:')
  for (const s of gone) out.push(`    ${round(s.score, 2).padStart(6)}  ${s.lat.toFixed(5)},${s.lng.toFixed(5)}  ${s.what}  [${s.lines.join(' ')}]`)
  return out.join('\n')
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const read = (file: string): ScoredMap => JSON.parse(fs.readFileSync(file, 'utf-8')) as ScoredMap
  const shipped = `${__dirname}/../../../../web/app/data/bus-map.json`
  if (args[0] === '--compare') {
    console.log(formatComparison(networkScore(read(args[1]!)), networkScore(read(args[2] ?? shipped))))
  } else {
    const jsonAt = args.indexOf('--json')
    const file = args.find((a, i) => !a.startsWith('--') && !(jsonAt >= 0 && i === jsonAt + 1)) ?? shipped
    const map = read(file)
    const score = networkScore(map)
    console.log(networkStats(map.edges, strokeKeys(map.lines)))
    console.log(formatScore(score))
    if (jsonAt >= 0) fs.writeFileSync(args[jsonAt + 1]!, JSON.stringify(score, null, 2) + '\n')
  }
}
