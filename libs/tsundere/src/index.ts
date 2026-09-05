/*
 * @commute/tsundere — the routing engine. See README.md.
 *
 * Dependency-free by design. It knows nodes, arcs and distances; it does not
 * know operators, rupiah, or that station ids look like `${operator}-${code}`.
 * Everything Jakarta-specific stays in apps/api and is passed in. Importing
 * @commute/constants or a database type here would make this part of the API.
 */
export { loadGraph, Tsundere, type LoadGraphInput } from './tsundere'

/*
 * `Criteria` is the vector a journey is scored on — boardings, distance,
 * walking, waiting, fare. Not the web app's FareCriteria, which is what the
 * rider chooses.
 */
export type { FareScorer, Journey, JourneyLabel, PlanOptions } from './planner/plan'

/*
 * Search counters. Not part of routing — a measurement hook the bench/audit
 * scripts pass in, so the engine's caps can be sized with numbers.
 */
export { newInstrument, type PlanInstrument } from './planner/instrument'
export {
  DEFAULT_RANK_WEIGHTS,
  WALKING_WEIGHTS,
  weightsForWalking,
  type Criteria,
  type RankWeights,
  type WalkingPreference
} from './planner/criteria'

/* Leg shapes. findRoute returns these, and the API's fare pipeline is written
 * against them. */
export type { RideLeg, RouteLeg, TransferLeg } from './router'

/*
 * Graph inputs. Structural by design — apps/api passes Kysely rows straight in,
 * so these must never grow a field a database row would not have.
 */
export type { EdgeInput, EndpointRestriction, ServiceBreak, TransferInput } from './router'
