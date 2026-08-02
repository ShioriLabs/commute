/*
 * @commute/tsundere — the routing engine.
 *
 * Deliberately dependency-free. It knows about nodes, arcs and distances; it
 * does not know what an operator is, what a rupiah is, or that station ids
 * happen to look like `${operator}-${code}`. Everything Jakarta-specific —
 * topology, endpoint restrictions, fares, the D1 graph inputs — stays in
 * apps/api and is passed in.
 *
 * Keep it that way. The moment this package imports @commute/constants or a
 * database type, it stops being a routing engine and becomes part of the API.
 *
 *   const tsun = loadGraph({ edges, transfers, restrictions, headwaysS })
 *   const legs = tsun.findRoute('KCI-SUD', 'MRTJ-LBB')       // one best route
 *   const options = tsun.findRoutes('KCI-SUD', 'MRTJ-LBB')   // several, scored
 *
 * ── The public surface is deliberately small ─────────────────────────────────
 *
 * One entry point, one handle, and the shapes that cross the boundary as data.
 * Everything else — buildGraph, findRoute as a free function, RouteGraph,
 * GraphEdge, the penalty constants — is internal and stays that way.
 *
 * That is not tidiness. The whole point of Phase 2 is to change how routing
 * works internally: per-(stop, round) Pareto bags instead of a scalar Dijkstra,
 * a by-line index beside the adjacency map, headways attached to the graph. If
 * `RouteGraph` and `buildGraph` were public, every one of those becomes a
 * breaking change to a consumer that never needed them. Behind `loadGraph` they
 * are free to move.
 *
 * The rule for anything added here later: export it only if a caller outside
 * this package genuinely cannot do its job without it. `Tsundere` gaining a
 * method is cheap; `Tsundere` exposing its graph is not.
 */
export { loadGraph, Tsundere, type LoadGraphInput } from './tsundere'

/*
 * The multi-criteria surface. `Criteria` is the vector a journey is scored on —
 * boardings, distance, walking, waiting, fare — not to be confused with the
 * web app's FareCriteria, which is what the rider *chooses*.
 */
export type { FareScorer, Journey, PlanOptions } from './planner/plan'
export {
  DEFAULT_RANK_WEIGHTS,
  WALKING_WEIGHTS,
  weightsForWalking,
  type Criteria,
  type RankWeights,
  type WalkingPreference
} from './planner/criteria'

/*
 * The leg shapes. These are unavoidably public: findRoute returns them, and the
 * API's fare pipeline (summarizeFares, mergeInterlinedLegs, resolveCorridorMerges)
 * is written against them. They are plain data with no behaviour, so exporting
 * them commits to a shape rather than to an implementation.
 */
export type { RideLeg, RouteLeg, TransferLeg } from './router'

/*
 * Graph inputs. Public because loadGraph takes them, and callers want to name
 * the type they are building. Structural by design — apps/api passes Kysely
 * rows straight in, and these must never grow a field a database row would not
 * happen to have.
 */
export type { EdgeInput, EndpointRestriction, TransferInput } from './router'
