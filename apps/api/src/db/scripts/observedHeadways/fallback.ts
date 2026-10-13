import { clampHeadway } from '../../../utils/headwayBounds'
import { type FoldInfo, fitFactorised, type ModelSpec, type Pool, type RateModel } from './fit'
import { columnsWithData, computeColumnScales } from './scale'

/*
 * The baseline a model is vouched against: what a rider would be shown INSTEAD.
 *
 * It used to be `gtfsScaled`: weekday schedule values, one scale, no cap. The
 * fallback that actually ships is day-aware (a Saturday reads the Saturday
 * schedule), has a separate scale for directional schedule values, and is
 * capped and never below the schedule. A model that beats the weaker baseline
 * but not the real fallback would be shipped over something better.
 *
 * So this reproduces the runtime's `scaledHeadway` (utils/observedHeadways.ts)
 * inside a backtest fold: the scales and caps come from a model fitted on that
 * fold's TRAINING days only (never the held-out day), measured with the same
 * `computeColumnScales` the shipped file's are, against the same base lookups.
 *
 * Two known differences from what ships. Caps are measured on every column with
 * data here, where the shipped file takes them only from vouched columns (which
 * are not known until this baseline has been used to vouch). And it models only
 * the scaled schedule: in a column that is not vouched at all, a rider may be
 * shown an interpolated profile instead. A cell whose stratum LOSES is never
 * interpolated back in (backtest.ts `heldBackCells`), so for those what ships is
 * the scaled schedule (or, on a direction-pooled planner value, the other
 * direction's profile where that one shipped).
 */
export interface FallbackLookups {
  /** The planner's per-stop / per-line schedule value for a service day. */
  base: (day: 'WD' | 'SAT' | 'SUN', key: string) => number | undefined
  /** The schedule's directional value for `line@stop@dir`, if it has one. */
  baseDir: (key: string) => number | undefined
  /** The service day a WIB day (YYYYMMDD) maps to. */
  serviceDayOf: (day: string) => 'WD' | 'SAT' | 'SUN'
}

export function shippedFallbackSpec(lookups: FallbackLookups): ModelSpec {
  return {
    name: 'shipped fallback',
    fit(pool: Pool, fold?: FoldInfo): RateModel {
      const model = fitFactorised(pool)
      const scales = computeColumnScales(
        model,
        lookups.base,
        lookups.baseDir,
        new Set(columnsWithData(model))
      )
      const byId = new Map(scales.map(s => [s.id, s]))
      const serviceDay = fold ? lookups.serviceDayOf(fold.day) : 'WD'

      return {
        headway(key, dayType, hour) {
          const scale = byId.get(`${dayType}:${hour}`)
          if (!scale) return undefined
          const lineStop = key.slice(0, key.lastIndexOf('@'))
          const line = key.slice(0, key.indexOf('@'))
          const directional = lookups.baseDir(key)
          const schedule = directional ?? lookups.base(serviceDay, lineStop) ?? lookups.base(serviceDay, line)
          if (schedule === undefined || schedule <= 0) return undefined
          const multiplier = directional === undefined ? scale.scale : (scale.scaleDir ?? scale.scale)
          const scaled = scale.cap === undefined ? schedule * multiplier : Math.min(schedule * multiplier, scale.cap)
          // Scaling only ever lengthens a wait, exactly as the runtime does.
          return clampHeadway(Math.max(schedule, scaled))
        }
      }
    }
  }
}
