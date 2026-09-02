import type { PickableStation } from './pickable-station'
import { filterBestTier, keywordScore, popularityTerm, SCORE_THRESHOLD } from 'utils/fuzzy-match'

/*
 * Ranking and quick-pick selection for the fare station pickers.
 *
 * Lifted out of StationPickerDialog so the map's desktop rail can search the
 * same list the same way without dragging a full-screen modal onto a 400px
 * column. The dialog still owns everything about being a dialog — the slide-up,
 * the mount staging that protects it, the scrim; only the scoring, which has no
 * opinion about where it is rendered, lives here.
 *
 * Pure and unit-tested, which the dialog itself is not: the suite is node-only
 * with no DOM.
 */

/*
 * Best match across everything the station is known by.
 *
 * This used to lowercase `name`/`officialName`/`code` into a client-side index
 * and score each field in turn — "sudirman baru" has to keep finding BNI City,
 * and only the operator's own spelling carries that. The prebuilt index now
 * ships all of them pre-lowercased in `keywords`, including both halves of a
 * folded directional pair, so the per-field pass collapses into one scan and
 * the index it needed disappears.
 *
 * Lowest wins: keywordScore returns 0 for an exact match and grows with edit
 * distance, so the closest keyword is the station's score.
 */
export function getStationScore(station: PickableStation, query: string) {
  let best = Number.POSITIVE_INFINITY
  for (const keyword of station.keywords) {
    const score = keywordScore(keyword, query)
    if (score === 0) return 0
    if (score < best) best = score
  }
  return best
}

// Recently picked fare stations feed the quick-pick chips (same pattern as
// the search sheet's 'recently-searched').
export const RECENT_PICKS_KEY = 'fare-recent-stations'
export const RECENT_PICKS_MAX = 4

/**
 * The remembered picks, or an empty list when there is nothing to remember.
 *
 * Both fare pickers read this — the phone's dialog on every open, the rail's
 * inline list once on mount — because both write it, so a station picked in one
 * has to surface in the other. The two used to keep their own copy of this and
 * had already drifted apart; see recordRecentPick.
 *
 * Never throws. A corrupt entry, a browser refusing storage and a first-ever
 * visit are all the same answer here, which is "popularity only" once
 * quickPickStations pads the empty list.
 *
 * Filtered rather than merely cast: callers look these up by id, and a stored
 * `42` would otherwise reach that lookup as a key that cannot match.
 */
export function readRecentPicks(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_PICKS_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

/**
 * `id` remembered first, the list de-duplicated and capped.
 *
 * Returns the new list as well as writing it, so a caller can drive its own
 * state from the same value without a second read — which is what lets this sit
 * inside a `setState` updater.
 *
 * The write can fail (private mode, a full quota) and that is not something the
 * rider should hear about: the pick still stands, it just is not remembered. The
 * phone's picker used to call `setItem` here unguarded, which threw inside a
 * React state updater rather than anywhere it could be handled.
 */
export function recordRecentPick(id: string, current: readonly string[]): string[] {
  const next = [id, ...current.filter(existing => existing !== id)].slice(0, RECENT_PICKS_MAX)
  try {
    localStorage.setItem(RECENT_PICKS_KEY, JSON.stringify(next))
  } catch {
    // See above.
  }
  return next
}

// How many stations the no-query list offers. Several screens' worth — enough
// that scrolling still feels like a real list — without putting the entire
// network in the DOM. See the comment in `shownStations`.
export const NO_QUERY_ROWS = 50

/**
 * The `limit` highest-scoring stations, popularity first then name.
 *
 * A partial selection rather than a full sort: the callers want a handful off
 * the top, and sorting all ~360 (with a `localeCompare` tiebreak) to slice 4 or
 * 50 off the front is work thrown away. Re-runs whenever the query drops back
 * under two characters, so it sits on the typing path, not just on open.
 */
export function topByPopularity(stations: PickableStation[], limit: number): PickableStation[] {
  if (limit <= 0) return []

  const isBetter = (a: PickableStation, b: PickableStation) =>
    (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name)

  const top: PickableStation[] = []
  for (const station of stations) {
    // Past capacity, the incumbent tail is the only thing worth beating.
    if (top.length === limit && isBetter(top[top.length - 1], station) <= 0) continue
    let at = top.length
    while (at > 0 && isBetter(station, top[at - 1]) < 0) at--
    top.splice(at, 0, station)
    if (top.length > limit) top.pop()
  }
  return top
}

// Memoized: rendered from the deferred filter pass, so the urgent keystroke
// render must bail out here — otherwise the whole list re-renders per
// keystroke at urgent priority and blocks the input.

/**
 * The rows a query should show: ranked matches, or the popular head when the
 * query is too short to mean anything.
 *
 * Two characters is the floor because a single letter matches most of the
 * network and ranks it by popularity alone, which is the no-query list wearing
 * a hat.
 */
export function rankStations(stations: PickableStation[], rawQuery: string): PickableStation[] {
  if (rawQuery.length < 2) {
    /*
     * No query: the most popular stations, so common picks are one tap away.
     *
     * Capped rather than complete. This used to sort and return all ~360
     * pickable stations, every one of which reached the DOM once `renderAll`
     * flipped — content-visibility skips their paint but not their
     * construction, reconciliation or layout. Nobody scrolls 360 rows to find a
     * station, and past the cap is a search away.
     */
    return topByPopularity(stations, NO_QUERY_ROWS)
  }
  const query = rawQuery.toLowerCase()
  /*
   * Score first, push survivors only — the shape the search sheet already uses.
   * Building a wrapper object per station and filtering afterwards allocated one
   * for every station on every keystroke, then discarded nearly all of them.
   */
  const scored: { station: PickableStation, matchScore: number, finalScore: number }[] = []
  for (const station of stations) {
    const matchScore = getStationScore(station, query)
    const finalScore = matchScore + (1 - popularityTerm(station.score))
    if (finalScore >= SCORE_THRESHOLD) continue
    scored.push({ station, matchScore, finalScore })
  }
  // Corrections are a fallback: exact matches hide typo matches, word-typo
  // matches hide window matches.
  return filterBestTier(scored, ({ matchScore }) => matchScore)
    .sort((a, b) => a.finalScore - b.finalScore || a.station.name.localeCompare(b.station.name))
    .map(({ station }) => station)
}

/**
 * Recent picks first, padded with the most popular stations for first-time
 * users (and when recents fall outside the pickable set).
 */
export function quickPickStations(
  stations: PickableStation[],
  recentIds: readonly string[]
): PickableStation[] {
  const byId = new Map(stations.map(station => [station.id, station]))
  const picks: PickableStation[] = []
  for (const id of recentIds) {
    const station = byId.get(id)
    if (station && !picks.some(pick => pick.id === station.id)) picks.push(station)
    if (picks.length === RECENT_PICKS_MAX) return picks
  }
  // Enough headroom that the already-picked recents can all be skipped and this
  // can still fill to RECENT_PICKS_MAX.
  const popular = topByPopularity(stations, RECENT_PICKS_MAX + picks.length)
  for (const station of popular) {
    if (picks.some(pick => pick.id === station.id)) continue
    picks.push(station)
    if (picks.length === RECENT_PICKS_MAX) break
  }
  return picks
}
