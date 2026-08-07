import { plan, type Journey, type PlanOptions } from './planner/plan'
import {
  buildGraph,
  findRoute,
  type EdgeInput,
  type EndpointRestriction,
  type ServiceBreak,
  type RouteGraph,
  type RouteLeg,
  type TransferInput
} from './router'

/*
 * The loaded-network handle.
 *
 * `loadGraph(...)` once, then query it. The alternative — exporting free
 * functions that each take a RouteGraph — means every caller threads the graph
 * through by hand, and every future capability (multi-criteria search, headway
 * lookups, the by-line index a round-based scan needs) either grows the
 * parameter list or grows RouteGraph into a bag of unrelated maps.
 *
 * Holding it here also gives derived indexes an obvious home: they are built
 * once at load, beside the data they index, rather than recomputed per query or
 * bolted onto the graph object after the fact.
 */
export interface LoadGraphInput {
  edges: EdgeInput[]
  transfers: TransferInput[]
  /**
   * Seconds between vehicles, per line code. Used only by `findRoutes`, to
   * charge an expected wait per boarding.
   *
   * A property of the network, so it is loaded once rather than passed per
   * query — same reasoning as restrictions. Optional: without it every line
   * falls back to one default, which makes waiting a constant per boarding
   * rather than a differentiator.
   */
  headwaysS?: Map<string, number>
  /**
   * Stops that may only be boarded/alighted in one direction. A static property
   * of the network, so it belongs to the loaded graph rather than to a query.
   */
  restrictions?: EndpointRestriction[]
  /**
   * Turns that stay on one line but change vehicle, e.g. riding through the
   * point where a loop closes onto its stick. Read by `findRoutes` only — see
   * RouteGraph.serviceBreaks for why `findRoute` ignores them.
   */
  serviceBreaks?: ServiceBreak[]
}

export class Tsundere {
  /*
   * Private, and deliberately not re-exported through a getter. Callers that
   * reach into the adjacency map are doing something this class should be
   * offering as a method instead — and while it stays private the internal
   * representation is free to change (Phase 2 adds a per-line index) without
   * being a breaking change.
   */
  readonly #graph: RouteGraph
  readonly #headwaysS: Map<string, number> | undefined

  constructor(graph: RouteGraph, headwaysS?: Map<string, number>) {
    this.#graph = graph
    this.#headwaysS = headwaysS
  }

  /** Node count, for cache diagnostics and sanity checks after a reseed. */
  get stopCount(): number {
    return this.#graph.adjacency.size
  }

  /**
   * The single best route by weighted distance, or null when unreachable.
   *
   * Unchanged behaviour from the free `findRoute` — same algorithm, same
   * penalties, same output. Phase 2's multi-criteria search lands beside it as
   * `findRoutes`, plural, rather than replacing this: this one is the oracle the
   * new engine gets diffed against, so it has to stay callable.
   */
  findRoute(fromStationId: string, toStationId: string): RouteLeg[] | null {
    return findRoute(this.#graph, fromStationId, toStationId)
  }

  /**
   * Several non-dominated journeys, best first.
   *
   * Where `findRoute` answers "the shortest way", this answers "the ways worth
   * considering" — a journey with one fewer change but more walking is not
   * worse, it is a different choice, and both come back. Each carries the
   * criteria it was judged on so a caller can label them.
   *
   * Empty when the pair is unroutable within `maxRounds` boardings.
   */
  findRoutes(fromStationId: string, toStationId: string, options: PlanOptions = {}): Journey[] {
    return plan(this.#graph, fromStationId, toStationId, {
      headwaysS: this.#headwaysS,
      ...options
    })
  }
}

/**
 * Build a routing engine over a network.
 *
 * Inputs are structural, so the API's Kysely rows are passed straight in with
 * no mapping. Restrictions arrive already in `${operator}-${code}` id form,
 * because mapping them is the caller's job.
 *
 * Node ids are opaque here with exactly one exception: leg assembly splits on
 * '-' to fill `RideLeg.operator` (see planner/materialise.ts). That is a real
 * layering leak, kept because the field is load-bearing downstream — the API's
 * fare logic switches per-operator tariffs on it — and threading an id parser
 * through the engine buys nothing while the format holds for every operator in
 * the network.
 */
export function loadGraph({ edges, transfers, restrictions, serviceBreaks, headwaysS }: LoadGraphInput): Tsundere {
  return new Tsundere(buildGraph(edges, transfers, restrictions, serviceBreaks), headwaysS)
}
