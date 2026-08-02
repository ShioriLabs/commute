import { hopsToLegs, type Hop } from './planner/materialise'

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
 * The routing graph plus the endpoint restrictions that apply to it. Restrictions
 * live on the graph (not passed per-query) since they're a static property of the
 * network; `findRoute` consults them only for the trip's own origin/destination.
 */
export interface RouteGraph {
  adjacency: Map<string, GraphEdge[]>
  restrictions: Map<string, EndpointRestriction> // keyed by restricted stationId
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
  restrictions: EndpointRestriction[] = []
): RouteGraph {
  const adjacency = new Map<string, GraphEdge[]>()
  const push = (from: string, edge: GraphEdge) => {
    if (!adjacency.has(from)) adjacency.set(from, [])
    adjacency.get(from)!.push(edge)
  }
  for (const e of edges) {
    push(e.fromStationId, { to: e.toStationId, distanceM: e.distance, lineCode: e.lineCode })
  }
  for (const t of transfers) {
    if (!t.toStationId) continue
    const noTap = Boolean(t.noTap)
    // rows may exist in one direction only; make walking symmetric
    push(t.fromStationId, { to: t.toStationId, distanceM: t.distance, lineCode: null, noTap })
    push(t.toStationId, { to: t.fromStationId, distanceM: t.distance, lineCode: null, noTap })
  }
  const restrictionMap = new Map(restrictions.map(r => [r.stationId, r]))
  return { adjacency, restrictions: restrictionMap }
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
  // The graph is ~180 nodes; a linear-scan priority pick is plenty.
  for (;;) {
    let current: string | null = null
    let best = Infinity
    for (const [station, d] of dist) {
      if (!visited.has(station) && d < best) {
        best = d
        current = station
      }
    }
    if (current === null) return null
    if (current === toStationId) break
    visited.add(current)
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
      const candidate = best + edge.distanceM + penalty
      if (candidate < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, candidate)
        prev.set(edge.to, { station: current, edge })
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
