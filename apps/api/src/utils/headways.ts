import { DAY_HEADWAYS_S, HEADWAYS_S, STOP_HEADWAYS_S } from '../db/data/headways'
import type { ServiceDay } from '../db/data/service-hours'
import { memoize } from './memo'

/*
 * The schedule-derived headways the planner uses for a day: the per-line
 * table, overlaid with the per-stop table, overlaid with that day's deltas.
 *
 * One map, two key shapes: `lineCode@stationId` wins where a stop has its own
 * measured value, `lineCode` is the fallback. The planner tries them in that
 * order, so the per-stop entries must not shadow a line key of the same name
 * (they cannot: `@` is not legal in a line code).
 *
 * DAY_HEADWAYS_S is sparse (only the (day, line) and (day, line@stop) pairs that
 * actually differ), so a miss falls through to the weekday number, which is
 * what the planner used before days existed.
 *
 * Shared by the planner (routes/fares.ts), the observed-headway lookup and the
 * fit that computes the GTFS scale, so all three multiply the same base.
 */
const cache = new Map<ServiceDay, Map<string, number>>()
export function baseHeadways(day: ServiceDay): Map<string, number> {
  return memoize(cache, day, () => {
    const base = new Map([...Object.entries(HEADWAYS_S), ...Object.entries(STOP_HEADWAYS_S)])
    if (day !== 'ALL') {
      const prefix = `${day}:`
      for (const [key, seconds] of Object.entries(DAY_HEADWAYS_S)) {
        if (key.startsWith(prefix)) base.set(key.slice(prefix.length), seconds)
      }
    }
    return base
  })
}
