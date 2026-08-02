import {
  buildGraph,
  findRoute,
  type EdgeInput,
  type EndpointRestriction,
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
   * Stops that may only be boarded/alighted in one direction. A static property
   * of the network, so it belongs to the loaded graph rather than to a query.
   */
  restrictions?: EndpointRestriction[]
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

  constructor(graph: RouteGraph) {
    this.#graph = graph
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
}

/**
 * Build a routing engine over a network.
 *
 * Inputs are structural, so the API's Kysely rows are passed straight in with
 * no mapping. Restrictions arrive already in `${operator}-${code}` id form —
 * this package treats node ids as opaque strings and never parses them.
 */
export function loadGraph({ edges, transfers, restrictions }: LoadGraphInput): Tsundere {
  return new Tsundere(buildGraph(edges, transfers, restrictions))
}
