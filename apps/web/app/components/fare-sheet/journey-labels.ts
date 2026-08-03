import type { FareJourneyLabel } from '@commute/schemas'

/*
 * Badges on the alternative cards.
 *
 * Typed as a total Record rather than a partial, same reason as
 * criteria/labels.ts: a fifth label added to the engine should break this build
 * instead of rendering `SHORTEST_WAIT` to a rider.
 *
 * "Paling" is literally true here and not marketing. The engine only assigns a
 * label when exactly one journey wins that axis — a tie leaves both unlabelled —
 * so a badge always names a real difference the rider can act on.
 */
export const JOURNEY_LABELS: Record<FareJourneyLabel, string> = {
  CHEAPEST: 'Paling murah',
  FEWEST_CHANGES: 'Paling sedikit transit',
  LEAST_WALKING: 'Paling sedikit jalan',
  SHORTEST_WAIT: 'Paling sebentar nunggu'
}

/*
 * Longer forms, for the expanded card.
 *
 * SHORTEST_WAIT is the one that has to be worded carefully. It comes from
 * average headways, not a timetable, so it must read as "the vehicle comes
 * often" and never as "you will arrive sooner" — the app has no arrival time to
 * promise. Same rule as utils/fare-criteria.ts: don't imply a capability the
 * engine lacks.
 */
export const JOURNEY_LABEL_DESCRIPTIONS: Record<FareJourneyLabel, string> = {
  CHEAPEST: 'Tarifnya paling murah di antara pilihan ini',
  FEWEST_CHANGES: 'Paling jarang gonta-ganti kendaraan',
  LEAST_WALKING: 'Jalan kakinya paling pendek',
  SHORTEST_WAIT: 'Kendaraannya paling sering lewat, jadi rata-rata nunggunya paling sebentar'
}
