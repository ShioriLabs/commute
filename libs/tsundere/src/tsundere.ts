import { plan, type Journey, type PlanOptions } from './planner/plan'
import type { ServiceWindow } from './planner/service-hours'
import { buildTripIndex, type TripIndex, type TripPattern } from './planner/trips'
import {
  journeyArrivalS,
  resolveDepartures,
  type LegTiming,
  type ResolveDeparturesOptions
} from './planner/departures'
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
 * The loaded-network handle. `loadGraph(...)` once, then query it.
 *
 * Add capabilities as methods here rather than as free functions taking a
 * RouteGraph — those make every caller thread the graph through by hand, and
 * each new one either grows the parameter list or grows RouteGraph into a bag
 * of unrelated maps. Derived indexes belong here too, built once at load.
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
  /**
   * When each line runs, in seconds since local midnight.
   *
   * A static property of the network, like restrictions, so it is loaded once
   * rather than passed per query — only the *evaluation time* varies, and that
   * is `plan`'s `departureS`. Without it no journey is ever filtered by service
   * hours, whatever departure time a caller passes.
   */
  serviceHours?: Map<string, ServiceWindow>
  /**
   * The timetable: which vehicles run each stop pattern, and when.
   *
   * A static property of the network like restrictions and service hours, so it
   * is indexed once at load rather than per query — only the moment being asked
   * about varies, and that is `plan`'s `departureS`.
   *
   * NOT READ BY THE SEARCH YET. `findRoutes` is still headway-based; this is
   * loaded so the data can be measured against the real network before the hot
   * path depends on it. See planner/trips.ts and docs/go-mode.md.
   */
  trips?: TripPattern[]
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
  readonly #serviceHours: Map<string, ServiceWindow> | undefined
  readonly #trips: TripIndex | undefined

  constructor(
    graph: RouteGraph,
    headwaysS?: Map<string, number>,
    serviceHours?: Map<string, ServiceWindow>,
    trips?: TripIndex
  ) {
    this.#graph = graph
    this.#headwaysS = headwaysS
    this.#serviceHours = serviceHours
    this.#trips = trips
  }

  /** Node count, for cache diagnostics and sanity checks after a reseed. */
  get stopCount(): number {
    return this.#graph.adjacency.size
  }

  /*
   * Timetable size, or 0 when none was loaded.
   *
   * Exposed as counts rather than as the index itself, for the same reason the
   * graph is private: a caller needs to assert the timetable arrived after a
   * reseed, not to reach into it. When the search starts reading trips this is
   * what a health check watches.
   */
  get tripCount(): number {
    return this.#trips?.tripCount ?? 0
  }

  get patternCount(): number {
    return this.#trips?.patterns.length ?? 0
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
  /**
   * Clock times for a journey this graph produced, or nulls where the timetable
   * cannot honestly say.
   *
   * A method rather than a free function taking the index, because the index
   * stays private — a caller needs departure times, not the structure that
   * produces them. Returns all-null when no timetable was loaded, which is
   * exactly the behaviour before trips existed.
   *
   * Deliberately separate from `findRoutes`: the route is stable across the day
   * and is cached for 20 hours upstream, while these times are only true for
   * the moment asked about. See planner/departures.ts.
   */
  timeJourney(legs: readonly RouteLeg[], options: ResolveDeparturesOptions): (LegTiming | null)[] {
    if (!this.#trips) return legs.map(() => null)
    return resolveDepartures(legs, this.#trips, options)
  }

  /** When a journey ends, or null unless every ride leg was timed. */
  journeyArrival(legs: readonly RouteLeg[], timings: readonly (LegTiming | null)[]): number | null {
    return journeyArrivalS(legs, timings)
  }

  findRoutes(fromStationId: string, toStationId: string, options: PlanOptions = {}): Journey[] {
    return plan(this.#graph, fromStationId, toStationId, {
      headwaysS: this.#headwaysS,
      serviceHours: this.#serviceHours,
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
 * '-' to fill `RideLeg.operator`. See planner/materialise.ts, which documents
 * why that leak is kept.
 */
export function loadGraph({
  edges,
  transfers,
  restrictions,
  serviceBreaks,
  headwaysS,
  serviceHours,
  trips
}: LoadGraphInput): Tsundere {
  return new Tsundere(
    buildGraph(edges, transfers, restrictions, serviceBreaks),
    headwaysS,
    serviceHours,
    trips ? buildTripIndex(trips) : undefined
  )
}
