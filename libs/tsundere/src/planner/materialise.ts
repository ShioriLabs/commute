import type { GraphEdge, RouteLeg } from '../router'

/** One traversal of one arc, in journey order. */
export interface Hop {
  from: string
  to: string
  edge: GraphEdge
}

/*
 * Hops to legs.
 *
 * Lifted out of findRoute so both engines build legs the same way. That matters
 * more than it looks: the whole Phase 2 plan rests on diffing the two engines
 * against each other, and a difference caused by two copies of leg assembly
 * drifting apart would be indistinguishable from a real routing difference.
 *
 * Consecutive hops on one line merge into a single RIDE leg. `stationIds` must
 * come out as the COMPLETE ordered stop list, not just the endpoints —
 * mergeInterlinedLegs in apps/api matches it as a contiguous run against
 * TOPOLOGY paths, so a gap there silently stops interlined legs from merging.
 *
 * `operator` is derived by splitting the station id on '-'. That is the one
 * place this package looks inside a node id, and it contradicts the claim that
 * ids are opaque. Keeping it because RideLeg.operator is load-bearing
 * downstream (summarizeFares switches per-operator tariffs on it) and the
 * alternative — a caller-supplied id parser threaded through the engine — buys
 * nothing while the format is stable across every operator in the network.
 */
export function hopsToLegs(hops: readonly Hop[]): RouteLeg[] {
  const legs: RouteLeg[] = []
  for (const hop of hops) {
    const last = legs[legs.length - 1]
    if (hop.edge.lineCode === null) {
      legs.push({
        type: 'TRANSFER',
        fromStationId: hop.from,
        toStationId: hop.to,
        distanceM: hop.edge.distanceM,
        noTap: hop.edge.noTap ?? false
      })
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

/*
 * A label's back-pointer chain.
 *
 * Linked rather than an array per label: a bag holds up to `maxSize` labels per
 * (stop, round) across four rounds, and copying the whole hop list into each
 * one turns the search quadratic in journey length for no benefit.
 */
export interface Trace {
  hop: Hop
  previous: Trace | null
}

/** Walk a trace back to the origin and hand back the hops in journey order. */
export function traceToHops(trace: Trace | null): Hop[] {
  const hops: Hop[] = []
  for (let node = trace; node !== null; node = node.previous) {
    hops.unshift(node.hop)
  }
  return hops
}
