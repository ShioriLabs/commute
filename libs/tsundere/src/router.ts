import { hopsToLegs, type Hop } from './planner/materialise'
import { MinHeap } from './heap'

/*
 * Structural inputs to buildGraph.
 *
 * These used to be `Pick<Edge, …>` / `Pick<Transfer, …>` against the API's
 * Kysely row types, which is what tied a dependency-free routing engine to a
 * database schema. They were only ever consumed structurally, so declaring the
 * shape here severs that without changing a single call site: a real
 * `Selectable<EdgeSchema>` row still satisfies EdgeInput, and the test fixtures
 * that omit id/timestamps still typecheck.
 */
export interface EdgeInput {
  lineCode: string
  fromStationId: string
  toStationId: string
  /** Metres. Also the fare input, so it is the real distance, never a weight. */
  distance: number
}

export interface TransferInput {
  fromStationId: string
  /** Null for external transfers, which have no routable target — skipped below. */
  toStationId: string | null
  distance: number
  /** D1 stores this as 0|1, hence the number; coerced with Boolean() below. */
  noTap?: number | boolean
}

/*
 * Shortest-distance routing over ride edges + walk transfers. Transfer edges
 * carry an extra weight penalty so the router only hops networks when it
 * genuinely helps; the penalty is never included in reported distances.
 */
export const TRANSFER_PENALTY_M = 800

/*
 * Routing-only bias against changing service line mid-ride. TransJakarta corridors
 * heavily overlap (13 / 13E / L13E share a trunk; express variants skip stops),
 * so plain per-hop cheapest-edge Dijkstra ping-pongs between sibling codes and
 * produces a path no single line actually serves. This penalty makes the router
 * prefer staying on one line, so a one-seat ride stays one leg — and, sized well
 * above a single hop, also discourages routing through many short same-vehicle-type
 * transfers just to shave off a few hundred meters (each bus change costs riders
 * real wait/hassle a flat distance comparison ignores). Deliberately kept ABOVE
 * TRANSFER_PENALTY_M: boarding a different vehicle is worse than a short walk
 * between two stops in the same paid zone (e.g. a busway underpass), so a real
 * walk should win over an extra bus-to-bus change when both are short. Neither
 * penalty enters reported distances.
 */
export const LINE_CHANGE_PENALTY_M = 1200

/*
 * One arc in the adjacency map. Exported because it appears in the public
 * RouteGraph type — while it was module-private no consumer could name the
 * shape of the graph they were handed.
 */
export interface GraphEdge {
  to: string
  distanceM: number
  /*
   * What Dijkstra pays to cross this edge, when that differs from the distance
   * a rider is told. Only walk hops set it, and only where a chain of them
   * would otherwise undercut a measured direct walk — see buildGraph. Reported
   * distances always come from `distanceM`, never this.
   */
  routingCostM?: number
  lineCode: string | null // null = walk transfer
  noTap?: boolean // walk transfers only: stays inside one paid zone, no fare gate
}

/*
 * A stop served (board/alight) in only one travel direction while the track
 * passes both ways (e.g. KCI-PSE). The through-edges stay in the graph so a
 * trip may still ride PAST the stop; these entries only forbid the stop as a
 * trip ENDPOINT in the banned direction — no boarding heading toward
 * `forbiddenNeighbor`, no alighting having arrived from it.
 */
export interface EndpointRestriction {
  stationId: string // DB id, e.g. `KCI-PSE`
  forbiddenNeighborId: string // DB id, e.g. `KCI-GST`
}

/*
 * A turn that stays on one line but changes vehicle.
 *
 * A line code identifies a *route*, not a service, and on a loop the two come
 * apart. KCI's Cikarang line is a lollipop — a stick running in to Jatinegara
 * and a loop that leaves Jatinegara and closes back onto it — so a run of
 * same-line edges through that junction describes a train going round the loop
 * and immediately starting round it again. No service does that: one reaching
 * the junction off the loop leaves down the stick. The rider changes trains
 * while the line code never changes, and `boardings` cannot see it.
 *
 * Expressed as a turn (`from` -> `via` -> `to`) rather than a property of a
 * stop or an edge, because that is what it is: the stick-to-loop turns through
 * the same junction are ordinary through-running and must stay free.
 *
 * Not a ban. Riding through the break is a real journey — often the only
 * sensible one between the two ends of a loop — it just costs a boarding. The
 * Pareto front then carries both it and the long way round, and the rider
 * chooses.
 */
export interface ServiceBreak {
  lineCode: string
  /** The junction the vehicle change happens at. */
  viaStationId: string
  fromStationId: string
  toStationId: string
}

/** Lookup key for a turn. Directional — the reverse turn is a separate entry. */
export const serviceBreakKey = (lineCode: string, from: string, via: string, to: string): string =>
  `${lineCode}|${from}|${via}|${to}`

/*
 * The routing graph plus the endpoint restrictions that apply to it. Restrictions
 * live on the graph (not passed per-query) since they're a static property of the
 * network; `findRoute` consults them only for the trip's own origin/destination.
 */
export interface RouteGraph {
  adjacency: Map<string, GraphEdge[]>
  restrictions: Map<string, EndpointRestriction> // keyed by restricted stationId
  /*
   * Turns that cost a boarding, keyed by `serviceBreakKey`.
   *
   * Read by `plan` only. `findRoute` deliberately ignores them: it answers
   * `/fares`, which is the shared URL, the OG card and the TransportForJakarta
   * embed, so its output must not move until that is released on purpose.
   */
  serviceBreaks: Set<string>
}

export interface RideLeg {
  type: 'RIDE'
  lineCode: string
  operator: string
  fromStationId: string
  toStationId: string
  stationIds: string[]
  distanceM: number
}

export interface TransferLeg {
  type: 'TRANSFER'
  fromStationId: string
  toStationId: string
  distanceM: number
  // Stays inside one paid zone (no fare gate on either side), e.g. a busway
  // underpass between two halte. Consumed by fare-summary to skip the usual
  // tap-out boundary this leg would otherwise create.
  noTap: boolean
}

export type RouteLeg = RideLeg | TransferLeg

export function buildGraph(
  edges: EdgeInput[],
  transfers: TransferInput[],
  restrictions: EndpointRestriction[] = [],
  serviceBreaks: ServiceBreak[] = []
): RouteGraph {
  const adjacency = new Map<string, GraphEdge[]>()
  const push = (from: string, edge: GraphEdge) => {
    if (!adjacency.has(from)) adjacency.set(from, [])
    adjacency.get(from)!.push(edge)
  }
  for (const e of edges) {
    push(e.fromStationId, { to: e.toStationId, distanceM: e.distance, lineCode: e.lineCode })
  }
  /*
   * Walk transfers, with chains held to the measured direct figure.
   *
   * A direct transfer is measured door to door, so it already contains whatever
   * lies between the two stations - above all the length of any structure on the
   * way. A chain of walks does not: passing through an intermediate stop costs
   * nothing, so Bali Mester -> Stasiun Jatinegara -> Jatinegara priced the walk
   * at 300 + 110 = 410m, silently dropping the length of the halte the rider
   * walks end to end, and beat the true 460m door-to-door edge.
   *
   * Where a chain undercuts a measured direct edge, its hops are surcharged so
   * the crossing costs strictly more than the figure someone actually walked.
   * Only the routing cost moves: each leg still reports its own measured
   * distance, so a trip that genuinely STARTS or ENDS at the middle station is
   * still quoted the honest per-hop walk.
   *
   * Chains between stations with NO direct edge are untouched - those are real
   * multi-stop walks, and the chain is the only thing the graph knows.
   */
  const walks = transfers.filter(t => t.toStationId)
  const shortest = new Map<string, Map<string, number>>()
  const note = (a: string, b: string, d: number) => {
    if (!shortest.has(a)) shortest.set(a, new Map())
    const row = shortest.get(a)!
    const seen = row.get(b)
    if (seen === undefined || d < seen) row.set(b, d)
  }
  for (const t of walks) {
    note(t.fromStationId, t.toStationId!, t.distance)
    note(t.toStationId!, t.fromStationId, t.distance)
  }

  /*
   * Extra metres a walk hop must carry to stop it forming a shortcut. Keyed by
   * the hop, in both directions, so either half of an undercutting chain is
   * enough to push the pair past the direct edge it was beating.
   */
  const surcharge = new Map<string, number>()
  const hopKey = (a: string, b: string) => a + '>' + b
  for (const [a, row] of shortest) {
    for (const [mid, first] of row) {
      for (const [b, second] of shortest.get(mid) ?? []) {
        if (b === a) continue
        const direct = shortest.get(a)?.get(b)
        if (direct === undefined || first + second >= direct) continue
        /*
         * Each hop carries the whole shortfall rather than half of it, so the
         * chain lands strictly above the direct edge instead of level with it.
         * A tie would leave the outcome to Dijkstra's visit order and the
         * transfer penalty, which is not something to depend on.
         */
        const shortfall = direct - first - second
        for (const k of [hopKey(a, mid), hopKey(mid, b), hopKey(b, mid), hopKey(mid, a)]) {
          surcharge.set(k, Math.max(surcharge.get(k) ?? 0, shortfall))
        }
      }
    }
  }

  for (const t of walks) {
    const noTap = Boolean(t.noTap)
    const from = t.fromStationId
    const to = t.toStationId!
    /*
     * Only the routing cost moves; the leg still reports its measured distance,
     * so a rider is never quoted a walk longer than the one they take.
     */
    const out = surcharge.get(hopKey(from, to)) ?? 0
    const back = surcharge.get(hopKey(to, from)) ?? 0
    // rows may exist in one direction only; make walking symmetric
    push(from, { to, distanceM: t.distance, routingCostM: t.distance + out, lineCode: null, noTap })
    push(to, { to: from, distanceM: t.distance, routingCostM: t.distance + back, lineCode: null, noTap })
  }
  const restrictionMap = new Map(restrictions.map(r => [r.stationId, r]))
  const breakSet = new Set(serviceBreaks.map(
    b => serviceBreakKey(b.lineCode, b.fromStationId, b.viaStationId, b.toStationId)
  ))
  return { adjacency, restrictions: restrictionMap, serviceBreaks: breakSet }
}

export function findRoute(graph: RouteGraph, fromStationId: string, toStationId: string): RouteLeg[] | null {
  const { adjacency, restrictions } = graph
  if (!adjacency.has(fromStationId) || !adjacency.has(toStationId)) return null

  // Endpoint direction rules for THIS trip's own origin/destination (a stop
  // that's a served endpoint only one way, e.g. KCI-PSE). Mid-route pass-through
  // is never affected — these only constrain the first hop out of the origin and
  // the last hop into the destination.
  const originRestriction = restrictions.get(fromStationId)
  const destRestriction = restrictions.get(toStationId)

  const dist = new Map<string, number>([[fromStationId, 0]])
  const prev = new Map<string, { station: string, edge: GraphEdge }>()
  const visited = new Set<string>()
  /*
   * A binary heap rather than a linear scan over `dist`.
   *
   * Worth only ~1.1x, and the reason is worth recording so nobody re-litigates
   * it: the old comment here said "the graph is ~180 nodes" and was read as
   * stale once the network reached 369. It was not. The scan ran over `dist`,
   * which holds only DISCOVERED nodes, and the average reachable set from any
   * node is 185 — so the pick was never paying the full O(V) it appeared to.
   * The graph is sparse (avg degree 3.5) and the search exits at the target.
   *
   * Kept because the asymptotics are strictly better and the working set grows
   * with the network, not because it made anything fast. Measured over all
   * 135,792 ordered pairs: 75.2 -> 67.7 us/pair, with byte-identical routes.
   * If routing time ever matters, the answer is upstream of this loop.
   *
   * No decrease-key: relaxing pushes the node again at its lower cost, and the
   * `visited` check below discards the superseded entry when it surfaces. That
   * is why the heap can hold a node more than once and why `best` is re-read
   * from `dist` rather than taken from the pop — the popped priority may be a
   * stale one, while `dist` always holds the current best.
   */
  const queue = new MinHeap<string>()
  queue.push(fromStationId, 0)
  for (;;) {
    const current = queue.pop()
    if (current === undefined) return null
    if (visited.has(current)) continue
    if (current === toStationId) break
    visited.add(current)
    const best = dist.get(current)!
    /*
     * KNOWN LIMITATION, deliberately left as-is.
     *
     * `incomingLine` is read from the *current best-known* predecessor, so the
     * line-change penalty applied to an edge depends on a path that a later
     * relaxation may supersede — while `dist` is a plain scalar keyed on the
     * station alone. That is Dijkstra over a state space its key does not
     * capture: correct handling keys on `(station, incomingLine)`.
     *
     * In practice the penalties are large enough relative to hop distances that
     * the chosen path is stable, and the two regression tests below (the TJ
     * 13/13E continuity bias and the one-seat-plus-walk case) pin the behaviour
     * riders actually see. Fixing it here would change routes and destroy this
     * function's value as the oracle the multi-criteria engine is diffed
     * against, so the fix belongs in that engine, whose per-(stop, round) bags
     * carry the boarded line in the label and make the state space explicit.
     */
    const incomingLine = prev.get(current)?.edge.lineCode ?? null
    for (const edge of adjacency.get(current) ?? []) {
      // Can't BOARD the origin heading toward its forbidden neighbor.
      if (current === fromStationId && originRestriction && edge.to === originRestriction.forbiddenNeighborId) continue
      // Can't ALIGHT at the destination having arrived from its forbidden neighbor.
      if (edge.to === toStationId && destRestriction && current === destRestriction.forbiddenNeighborId) continue
      let penalty = 0
      if (edge.lineCode === null) {
        penalty = TRANSFER_PENALTY_M
      } else if (incomingLine !== null && edge.lineCode !== incomingLine) {
        // Switching service line mid-ride (no walk) — bias toward staying put so
        // overlapping sibling corridors don't fragment a one-seat ride.
        penalty = LINE_CHANGE_PENALTY_M
      }
      // routingCostM where a walk hop is surcharged to stop it shortcutting a
      // measured direct walk; the plain distance everywhere else.
      const candidate = best + (edge.routingCostM ?? edge.distanceM) + penalty
      if (candidate < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, candidate)
        prev.set(edge.to, { station: current, edge })
        queue.push(edge.to, candidate)
      }
    }
  }

  // Reconstruct hops, then merge consecutive same-line hops into legs.
  // Assembly is shared with the multi-criteria planner (planner/materialise.ts)
  // so the two engines cannot drift apart in how they build legs — a difference
  // there would be indistinguishable from a real routing difference when the
  // two are diffed against each other.
  const hops: Hop[] = []
  let cursor = toStationId
  while (cursor !== fromStationId) {
    const step = prev.get(cursor)!
    hops.unshift({ from: step.station, to: cursor, edge: step.edge })
    cursor = step.station
  }

  return hopsToLegs(hops)
}
