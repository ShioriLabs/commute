import type { FareJourneyLabel } from '@commute/schemas'

/*
 * Badges on the alternative cards.
 *
 * A total Record, not a partial: a fifth label added to the engine must break
 * this build rather than render `SHORTEST_WAIT` to a rider.
 *
 * Keep these to one word where the language allows. They sit beside the fare on
 * a card scanned in a crowd, and anything longer truncates at 320px.
 */
export const JOURNEY_LABELS: Record<FareJourneyLabel, string> = {
  CHEAPEST: 'Termurah',
  FEWEST_CHANGES: 'Paling santai',
  LEAST_WALKING: 'Minim jalan',
  SHORTEST_WAIT: 'Sering lewat'
}

/*
 * Longer forms. Currently unrendered.
 *
 * These were written for an expanded card that the list/detail split retired —
 * the plate shows only the short labels above, capped at two. Kept rather than
 * deleted because the detail page is the obvious place they land (it has the
 * room the plate never did), and journeys.test.ts guards their completeness
 * meanwhile, so a fifth engine label cannot slip in unworded.
 *
 * Word SHORTEST_WAIT carefully. It comes from average headways, not a
 * timetable, so it must read as "the vehicle comes often" and never as "you
 * will arrive sooner" — the app has no arrival time to promise.
 */
export const JOURNEY_LABEL_DESCRIPTIONS: Record<FareJourneyLabel, string> = {
  CHEAPEST: 'Tarifnya paling murah di antara pilihan ini',
  FEWEST_CHANGES: 'Paling jarang gonta-ganti kendaraan',
  LEAST_WALKING: 'Jalan kakinya paling pendek',
  SHORTEST_WAIT: 'Kendaraannya paling sering lewat, jadi rata-rata nunggunya paling sebentar'
}
