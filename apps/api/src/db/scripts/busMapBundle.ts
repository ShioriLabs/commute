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
 * A line's own last few points are not a street to snap onto: every point lies
 * within SNAP_M of the one before it.
 */
const OWN_TAIL = Math.ceil((2 * SNAP_M) / SAMPLE_M) + 1

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
  kind: 'BRT' | 'AUI'
  /** The line's pieces, as drawn: each a polyline. */
  pieces: LngLat[][]
}

export interface BusMapEdge {
  /** Encoded polyline (Google, precision 5). Its direction is what left and right mean. */
  shape: string
  /** Line codes from left to right along the shape. */
  lines: string[]
}

/** Koridors before the other lines, then by number: `1`, `1A`, `1B`, `2`, ... `13`. */
export function bundleOrder(lines: readonly Pick<BundleLine, 'code' | 'kind'>[]): string[] {
  return [...lines]
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'BRT' ? -1 : 1
      return a.code.localeCompare(b.code, 'en', { numeric: true })
    })
    .map(l => l.code)
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
}

export function buildNetwork(lines: readonly BundleLine[]): Network {
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
  for (const code of order) {
    const line = byCode.get(code)!
    for (const piece of line.pieces) {
      const samples = resample(piece)
      if (samples.length < 2) {
        pieceId++
        continue
      }
      let previous = -1
      for (let i = 0; i < samples.length; i++) {
        const [x, y] = samples[i]!
        const [nx, ny] = samples[Math.min(i + 1, samples.length - 1)]!
        const [px, py] = samples[Math.max(i - 1, 0)]!
        const dl = Math.hypot(nx - px, ny - py) || 1
        const ux = (nx - px) / dl
        const uy = (ny - py) / dl

        let best = -1
        let bestD = SNAP_M
        const cx = Math.floor(x / SNAP_M)
        const cy = Math.floor(y / SNAP_M)
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (const id of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
              const p = points[id]!
              if (p.piece === pieceId && i - p.index < OWN_TAIL) continue
              if (Math.abs(p.ux * ux + p.uy * uy) < SNAP_COS) continue
              const d = Math.hypot(p.x - x, p.y - y)
              if (d <= bestD) {
                bestD = d
                best = id
              }
            }
          }
        }
        const at = best >= 0 ? best : addPoint({ x, y, ux, uy, piece: pieceId, index: i })
        if (previous >= 0 && at !== previous) {
          const known = adjacency.get(previous)?.has(at)
          const path = known ? null : bridge(previous, at)
          if (path) for (let k = 1; k < path.length; k++) link(path[k - 1]!, path[k]!, code)
          else link(previous, at, code)
        }
        previous = at
      }
      pieceId++
    }
  }
  return { points, edges, adjacency }
}

const sameLines = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every(c => b.has(c))

interface Chain {
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
      if (gap(network, fold, keep) > BUBBLE_GAP_M) continue
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
 * Every chain starts in bundle order and each line in turn is moved to wherever
 * on its chain costs the two nodes at its ends least, until no move helps. Only
 * a strictly better place is taken, so the result is the same run to run. A line
 * turning left then comes to the left of the others before the turn, as Transit
 * draws it, without a rule saying so.
 */
const SAME_CROSSING = 4
const SPLIT_CROSSING = 1
const ORDER_PASSES = 30

interface PairRule {
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

/** Each chain's lines, left to right along it, ordered to cross as little as they can. */
export function orderLines(network: Network, list: readonly Chain[], rank: ReadonlyMap<string, number>): string[][] {
  const { points } = network
  const orders = list.map(chain => [...chain.lines].sort((a, b) => rank.get(a)! - rank.get(b)!))

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

  // The rules, kept by chain and line, for the moves that can change them.
  const rulesOf = new Map<string, PairRule[]>()
  const file = (rule: PairRule, chains: number[]): void => {
    for (const c of chains) {
      for (const line of [rule.a, rule.b]) {
        const key = `${c}|${line}`
        const list = rulesOf.get(key)
        if (list) list.push(rule)
        else rulesOf.set(key, [rule])
      }
    }
  }
  for (const here of ends.values()) {
    const endsOf = new Map<string, End[]>()
    for (const end of here) {
      for (const line of list[end.chain]!.lines) endsOf.set(line, [...(endsOf.get(line) ?? []), end])
    }
    // Lines passing through: in on one chain, out on another. A line ending here crosses nothing.
    const through = [...endsOf].filter(([, e]) => e.length === 2 && e[0]!.chain !== e[1]!.chain)
    for (let i = 0; i < through.length; i++) {
      for (let j = i + 1; j < through.length; j++) {
        const [a, [a1, a2]] = through[i]!
        const [b, [b1, b2]] = through[j]!
        const shared = [a1!, a2!].filter(e => e === b1 || e === b2)
        if (shared.length === 2) {
          file({ a, b, inChain: a1!.chain, inAtStart: a1!.atStart, outChain: a2!.chain, outAtStart: a2!.atStart, weight: SAME_CROSSING }, [a1!.chain, a2!.chain])
        } else if (shared.length === 1) {
          const into = shared[0]!
          const outA = into === a1 ? a2! : a1!
          const outB = into === b1 ? b2! : b1!
          // Coming in along `into`, which way on turns further left?
          const hx = -into.dx
          const hy = -into.dy
          const turn = (o: End): number => Math.atan2(hx * o.dy - hy * o.dx, hx * o.dx + hy * o.dy)
          file({ a, b, inChain: into.chain, inAtStart: into.atStart, aGoesLeft: turn(outA) > turn(outB), weight: SPLIT_CROSSING }, [into.chain])
        }
      }
    }
  }

  const position = orders.map(order => new Map(order.map((line, i) => [line, i])))
  // Left to right as seen coming in to the node along a chain, or going on away from it.
  const leftComingIn = (chain: number, atStart: boolean, a: string, b: string): boolean => {
    const pa = position[chain]!.get(a)!
    const pb = position[chain]!.get(b)!
    return atStart ? pa > pb : pa < pb
  }
  const leftGoingOn = (chain: number, atStart: boolean, a: string, b: string): boolean => {
    const pa = position[chain]!.get(a)!
    const pb = position[chain]!.get(b)!
    return atStart ? pa < pb : pa > pb
  }
  const cost = (rule: PairRule): number => {
    const aLeft = leftComingIn(rule.inChain, rule.inAtStart, rule.a, rule.b)
    const crossed = rule.outChain !== undefined
      ? aLeft !== leftGoingOn(rule.outChain, rule.outAtStart!, rule.a, rule.b)
      : aLeft !== rule.aGoesLeft
    return crossed ? rule.weight : 0
  }
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

/** Peta Bus's lines as the edges of one network, each with its lines in order across it. */
export function bundle(lines: readonly BundleLine[]): BusMapEdge[] {
  const network = buildNetwork(lines)
  let list = chains(network)
  for (let pass = 0; pass < 6; pass++) {
    const popped = popBubbles(network, list)
    if (popped) list = chains(network)
    const smoothed = smooth(network, list)
    if (smoothed) list = chains(network)
    if (!popped && !smoothed) break
  }
  orient(network, list)
  const order = bundleOrder(lines)
  const rank = new Map(order.map((code, i) => [code, i]))
  const orders = orderLines(network, list, rank)
  return list
    .map((chain, i) => {
      const coords = chain.path.map((id) => {
        const p = network.points[id]!
        return [p.x / KX, p.y / KY] as LngLat
      })
      return {
        shape: encodePolyline(simplify(coords, SIMPLIFY_M)),
        lines: orders[i]!
      }
    })
    // Stable output: a regenerated file diffs only where the network changed.
    .sort((a, b) => a.lines.join(' ').localeCompare(b.lines.join(' ')) || a.shape.localeCompare(b.shape))
}

/*
 * Where a halte's mark goes on the network: on the nearest edge carrying one of
 * its lines, within STOP_MARK_M, centred across the edge's bundle and turned to
 * its way, so a client draws Transit's bar across all the lines there (one
 * line: a dot in its colour). A halte with no such edge near has no mark.
 */
const STOP_MARK_M = 60

/** A halte's mark: code, [lng, lat] on the edge, the edge's bearing (degrees from north), its line count, and its one line's code. */
export type StopMark = [string, number, number, number, number, string]

export interface StopIn {
  code: string
  lng: number
  lat: number
  lines: readonly string[]
}

export function placeStops(edges: readonly BusMapEdge[], stops: readonly StopIn[]): StopMark[] {
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
    const lines = edges[edge]!.lines
    out.push([stop.code, Math.round((x / KX) * 1e5) / 1e5, Math.round((y / KY) * 1e5) / 1e5, Math.round(bearing), lines.length, lines.length === 1 ? lines[0]! : ''])
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]))
}

/*
 * Corners as circular arcs, as Transit draws them: a line offset beside an arc
 * is an arc too, so every line of a bundle turns cleanly round the same centre.
 * The radius grows with the bundle (ARC_BASE_M, then ARC_PER_LINE_M a line, the
 * width a line takes around z14, where bundles are drawn), so the inner lines
 * of a wide one don't fold over themselves on a turn. Where the legs either side
 * of a corner are too short for it, it is as wide as they allow.
 */
const ARC_BASE_M = 15
const ARC_PER_LINE_M = 14
const ARC_MIN_TURN = (20 * Math.PI) / 180
/** Sharper than this is a hairpin (a U-turn, a spike where a line doubles back): rounded, it would loop. */
const ARC_MAX_TURN = (120 * Math.PI) / 180
const ARC_STEP = (15 * Math.PI) / 180

/** [path] with each corner turning more than ARC_MIN_TURN rounded off for a bundle of [lines]; its ends stay put. */
export function roundCorners(path: readonly LngLat[], lines: number): LngLat[] {
  if (path.length < 3) return [...path]
  const radius = ARC_BASE_M + ARC_PER_LINE_M * lines
  const xy = path.map(([lng, lat]) => [lng * KX, lat * KY] as [number, number])
  const out: [number, number][] = [xy[0]!]
  // How much of each leg the corners at its two ends may take: half, or all of it at the path's ends.
  const leg = (i: number): number => Math.hypot(xy[i + 1]![0] - xy[i]![0], xy[i + 1]![1] - xy[i]![1])
  for (let i = 1; i < xy.length - 1; i++) {
    const [ax, ay] = xy[i - 1]!
    const [px, py] = xy[i]!
    const [bx, by] = xy[i + 1]!
    const inLen = leg(i - 1)
    const outLen = leg(i)
    if (inLen === 0 || outLen === 0) continue
    const ux = (px - ax) / inLen
    const uy = (py - ay) / inLen
    const vx = (bx - px) / outLen
    const vy = (by - py) / outLen
    const turn = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)))
    if (turn < ARC_MIN_TURN || turn > ARC_MAX_TURN) {
      out.push([px, py])
      continue
    }
    const room = Math.min(i === 1 ? inLen : inLen / 2, i === xy.length - 2 ? outLen : outLen / 2)
    const tangent = Math.min(radius * Math.tan(turn / 2), room)
    const r = tangent / Math.tan(turn / 2)
    // The arc from where it leaves the incoming leg to where it meets the outgoing one.
    const sx = px - ux * tangent
    const sy = py - uy * tangent
    const left = ux * vy - uy * vx > 0 ? 1 : -1
    const cx = sx - uy * r * left
    const cy = sy + ux * r * left
    const start = Math.atan2(sy - cy, sx - cx)
    const steps = Math.max(1, Math.ceil(turn / ARC_STEP))
    for (let k = 0; k <= steps; k++) {
      const a = start + left * turn * (k / steps)
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
  }
  out.push(xy[xy.length - 1]!)
  return out.map(([x, y]) => [x / KX, y / KY] as LngLat)
}
