import type { Edge } from 'db/schemas/edges'
import type { Transfer } from 'db/schemas/transfers'

/*
 * Shortest-distance routing over ride edges + walk transfers. Transfer edges
 * carry an extra weight penalty so the router only hops networks when it
 * genuinely helps; the penalty is never included in reported distances.
 */
export const TRANSFER_PENALTY_M = 2500

/*
 * Routing-only bias against changing service line mid-ride. TransJakarta corridors
 * heavily overlap (13 / 13E / L13E share a trunk; express variants skip stops),
 * so plain per-hop cheapest-edge Dijkstra ping-pongs between sibling codes and
 * produces a path no single line actually serves. This small penalty makes the
 * router prefer staying on one line, so a one-seat ride stays one leg. Kept well
 * below TRANSFER_PENALTY_M (a real tap-out must still cost more than a same-trunk
 * line stay) and, like the transfer penalty, never enters reported distances.
 */
export const LINE_CHANGE_PENALTY_M = 500

interface GraphEdge {
  to: string
  distanceM: number
  lineCode: string | null // null = walk transfer
}
export type RouteGraph = Map<string, GraphEdge[]>

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
}

export type RouteLeg = RideLeg | TransferLeg

export function buildGraph(
  edges: Pick<Edge, 'lineCode' | 'fromStationId' | 'toStationId' | 'distance'>[],
  transfers: Pick<Transfer, 'fromStationId' | 'toStationId' | 'distance'>[]
): RouteGraph {
  const graph: RouteGraph = new Map()
  const push = (from: string, edge: GraphEdge) => {
    if (!graph.has(from)) graph.set(from, [])
    graph.get(from)!.push(edge)
  }
  for (const e of edges) {
    push(e.fromStationId, { to: e.toStationId, distanceM: e.distance, lineCode: e.lineCode })
  }
  for (const t of transfers) {
    if (!t.toStationId) continue
    // rows may exist in one direction only; make walking symmetric
    push(t.fromStationId, { to: t.toStationId, distanceM: t.distance, lineCode: null })
    push(t.toStationId, { to: t.fromStationId, distanceM: t.distance, lineCode: null })
  }
  return graph
}

export function findRoute(graph: RouteGraph, fromStationId: string, toStationId: string): RouteLeg[] | null {
  if (!graph.has(fromStationId) || !graph.has(toStationId)) return null

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
    const incomingLine = prev.get(current)?.edge.lineCode ?? null
    for (const edge of graph.get(current) ?? []) {
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
  const hops: { from: string, to: string, edge: GraphEdge }[] = []
  let cursor = toStationId
  while (cursor !== fromStationId) {
    const step = prev.get(cursor)!
    hops.unshift({ from: step.station, to: cursor, edge: step.edge })
    cursor = step.station
  }

  const legs: RouteLeg[] = []
  for (const hop of hops) {
    const last = legs[legs.length - 1]
    if (hop.edge.lineCode === null) {
      legs.push({ type: 'TRANSFER', fromStationId: hop.from, toStationId: hop.to, distanceM: hop.edge.distanceM })
    } else if (last && last.type === 'RIDE' && last.lineCode === hop.edge.lineCode) {
      last.toStationId = hop.to
      last.stationIds.push(hop.to)
      last.distanceM += hop.edge.distanceM
    } else {
      legs.push({
        type: 'RIDE',
        lineCode: hop.edge.lineCode,
        operator: hop.from.split('-')[0]!,
        fromStationId: hop.from,
        toStationId: hop.to,
        stationIds: [hop.from, hop.to],
        distanceM: hop.edge.distanceM
      })
    }
  }
  return legs
}
