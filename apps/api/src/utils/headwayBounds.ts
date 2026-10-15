/*
 * Bounds applied to every headway the app shows or plans with.
 *
 * Shared by the generator (db/scripts/generateHeadways.ts), the observed-headway
 * fit (db/scripts/observedHeadways) and the runtime lookup (utils/observedHeadways.ts),
 * so a value is clamped the same way wherever it is made. Relative imports in the
 * modules that scripts pull in: tsx does not resolve the `baseUrl` aliases.
 *
 * The cap exists for rows like `BW*` (Wisata tourist buses, 52700s) and `ASG*`
 * (school shuttles, up to 86400s, a once-daily service). None are routable
 * today, so nothing is currently clamped; it is here so a future GTFS refresh
 * that pulls a school route into the topology fails safe instead of pricing a
 * boarding at twelve hours of waiting.
 *
 * The floor exists because a sub-two-minute nominal headway is not a difference
 * a rider can act on, and letting it approach zero just adds noise to the
 * dominance test. It binds on ~37% of TJ pairs once variants are combined, which
 * is why the UI renders the floor as "~2 menit" rather than a precise figure.
 */
export const HEADWAY_CAP_S = 3600
export const HEADWAY_FLOOR_S = 120

export const clampHeadway = (seconds: number): number =>
  Math.max(HEADWAY_FLOOR_S, Math.min(HEADWAY_CAP_S, Math.round(seconds)))
