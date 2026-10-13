import { clampHeadway } from '../../../utils/headwayBounds'
import type { DayAggregate, DayType } from './aggregate'

/*
 * Stage 1: smoothed observed headways per (line, stop, direction, day type, hour).
 *
 * Three estimators over the same pooled counts, so the backtest can pick:
 *
 *   M0 pooled      healthy time / arrivals for the key-hour. Unbiased, noisy
 *                  where a stop saw few buses.
 *   M1 shrunk      Gamma-Poisson shrinkage of M0 towards the line-direction's
 *                  median stop at the same hour.
 *   M2 factorised  rate(key, hour) = profile(line-dir, hour) x factor(stop).
 *                  Arrivals along one line-direction are the same buses seen
 *                  at different stops, so the stop factor (estimated across
 *                  every hour) and the hourly profile (across every stop)
 *                  each borrow far more data than a key-hour cell holds, and
 *                  the result is ~2.5k numbers rather than ~30k.
 *
 * All of them return headways in seconds, UNCLAMPED; `clampHeadway` is for the
 * generated file.
 */

export const COLUMNS = 48
/** Column index of (day type, WIB hour). */
export const column = (dayType: DayType, hour: number) => (dayType === 'WD' ? 0 : 24) + hour
export const columnHour = (c: number) => c % 24
export const columnDayType = (c: number): DayType => (c < 24 ? 'WD' : 'WE')

/** A key-hour needs this many arrivals and this much healthy time to be a datum on its own. */
export const MIN_ARRIVALS = 5
export const MIN_HEALTHY_S = 1800
/** A day counts towards a column only with this much healthy time in that hour. */
export const MIN_DAY_HEALTHY_S = 900
/** Emission floors: a profile cell needs this many such days and pooled arrivals. */
export const MIN_COLUMN_DAYS = 3
export const MIN_PROFILE_ARRIVALS = 30
/** A stop factor needs this many arrivals overall; below it the stop has no observed value. */
export const MIN_STOP_ARRIVALS = 30
/**
 * A stop seen less than this often relative to its line-direction's average is
 * more likely a detection artefact (an origin terminal where the next stop never
 * changes, a halte the 30s sampling keeps skipping) than a real 3x headway, so
 * it gets no factor. The runtime then gives it its line's observed level when the
 * schedule does not call it rarer, and the scaled schedule otherwise
 * (utils/observedHeadways.ts). Judgment call: 32 of 919 stops on the 2026-10-12
 * data. Revisit once arrivals are validated.
 */
export const MIN_STOP_FACTOR = 0.3
/** Pseudo-arrivals pulling a stop factor towards its line-direction's mean. */
export const STOP_SHRINK_KAPPA = 5
export const SHRINK_KAPPAS = [2, 4, 6, 12]

export { clampHeadway }

export const lineDirOf = (key: string) => {
  const [line, , dir] = key.split('@')
  return `${line}@${dir}`
}

export interface KeyCounts {
  n: Float64Array
  g: Float64Array
  sumH: Float64Array
  sumH2: Float64Array
}

export interface Pool {
  /** Healthy seconds per column, summed over days. */
  healthySec: Float64Array
  /** Days with at least MIN_DAY_HEALTHY_S in the column. */
  daysOk: Int32Array
  keys: Map<string, KeyCounts>
  days: number
}

export function buildPool(days: readonly DayAggregate[]): Pool {
  const pool: Pool = {
    healthySec: new Float64Array(COLUMNS),
    daysOk: new Int32Array(COLUMNS),
    keys: new Map(),
    days: days.length
  }
  for (const day of days) {
    for (let h = 0; h < 24; h++) {
      const c = column(day.dayType, h)
      const sec = day.healthySecByHour[h] ?? 0
      pool.healthySec[c]! += sec
      if (sec >= MIN_DAY_HEALTHY_S) pool.daysOk[c]!++
    }
    for (const [key, hours] of Object.entries(day.keys)) {
      let counts = pool.keys.get(key)
      if (!counts) {
        counts = { n: new Float64Array(COLUMNS), g: new Float64Array(COLUMNS), sumH: new Float64Array(COLUMNS), sumH2: new Float64Array(COLUMNS) }
        pool.keys.set(key, counts)
      }
      for (const [hour, [n, g, sumH, sumH2]] of Object.entries(hours)) {
        const c = column(day.dayType, Number(hour))
        counts.n[c]! += n
        counts.g[c]! += g
        counts.sumH[c]! += sumH
        counts.sumH2[c]! += sumH2
      }
    }
  }
  return pool
}

export interface RateModel {
  /** Expected seconds between vehicles, or undefined where the model has no basis. */
  headway: (key: string, dayType: DayType, hour: number) => number | undefined
  /**
   * The headway that decides a key's backtest stratum (frequent or sparse), when
   * it is not `headway` itself. M2 ships and is vouched per line-direction cell,
   * so its stops are scored in the stratum of their line-direction's profile,
   * not of their own factor-adjusted value.
   */
  stratumHeadway?: (key: string, dayType: DayType, hour: number) => number | undefined
}

/**
 * The held-out day a model is being fitted for, when it is fitted inside a
 * backtest fold. Most models ignore it; the fallback baseline needs the
 * service day (a Saturday's schedule differs from a Sunday's), which the pooled
 * day type alone cannot tell it.
 */
export interface FoldInfo {
  day: string
  dayType: DayType
}

export interface ModelSpec {
  name: string
  fit: (pool: Pool, fold?: FoldInfo) => RateModel
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

/** M0: healthy time / arrivals. */
export function fitPooled(pool: Pool): RateModel {
  return {
    headway(key, dayType, hour) {
      const c = column(dayType, hour)
      const n = pool.keys.get(key)?.n[c] ?? 0
      const s = pool.healthySec[c]!
      if (n < MIN_ARRIVALS || s < MIN_HEALTHY_S) return undefined
      return s / n
    }
  }
}

/** M1: Gamma-Poisson shrinkage towards the line-direction's median stop rate. */
export function fitShrunk(pool: Pool, kappa: number): RateModel {
  const priors = new Map<string, number>()
  const rates = new Map<string, number[]>()
  for (const [key, counts] of pool.keys) {
    const ld = lineDirOf(key)
    for (let c = 0; c < COLUMNS; c++) {
      const s = pool.healthySec[c]!
      if (counts.n[c]! < MIN_ARRIVALS || s < MIN_HEALTHY_S) continue
      const id = `${ld}|${c}`
      let list = rates.get(id)
      if (!list) rates.set(id, list = [])
      list.push(counts.n[c]! / s)
    }
  }
  for (const [id, list] of rates) priors.set(id, median(list))

  return {
    headway(key, dayType, hour) {
      const c = column(dayType, hour)
      const s = pool.healthySec[c]!
      const prior = priors.get(`${lineDirOf(key)}|${c}`)
      if (prior === undefined || s < MIN_HEALTHY_S) return undefined
      const n = pool.keys.get(key)?.n[c] ?? 0
      return (s + kappa / prior) / (n + kappa)
    }
  }
}

export interface FactorisedModel extends RateModel {
  /** `${line}@${dir}|${column}` -> arrivals per second at an average stop. */
  profile: Map<string, number>
  /** key -> relative arrival rate of this stop within its line-direction (mean 1). Absent: no observed value. */
  factor: Map<string, number>
}

/** M2: profile(line-dir, hour) x factor(stop), fitted by iterative proportional fitting. */
export function fitFactorised(pool: Pool): FactorisedModel {
  const profile = new Map<string, number>()
  const factor = new Map<string, number>()

  const byLineDir = new Map<string, string[]>()
  for (const key of pool.keys.keys()) {
    const ld = lineDirOf(key)
    let list = byLineDir.get(ld)
    if (!list) byLineDir.set(ld, list = [])
    list.push(key)
  }

  const usable: number[] = []
  for (let c = 0; c < COLUMNS; c++) if (pool.healthySec[c]! >= MIN_HEALTHY_S) usable.push(c)

  for (const [ld, allKeys] of byLineDir) {
    const total = (key: string) => usable.reduce((a, c) => a + pool.keys.get(key)!.n[c]!, 0)
    const enough = allKeys.filter(k => total(k) >= MIN_STOP_ARRIVALS)
    if (enough.length === 0) continue

    /** Iterative proportional fitting of profile x factor over these stops. */
    const ipf = (keys: string[]) => {
      const f = new Array<number>(keys.length).fill(1)
      const p = new Float64Array(COLUMNS)
      const refreshProfile = () => {
        const sumF = f.reduce((a, b) => a + b, 0)
        for (const c of usable) {
          const arrivals = keys.reduce((a, k) => a + pool.keys.get(k)!.n[c]!, 0)
          p[c] = arrivals / (pool.healthySec[c]! * sumF)
        }
      }
      for (let iter = 0; iter < 25; iter++) {
        refreshProfile()
        const expected = usable.reduce((a, c) => a + pool.healthySec[c]! * p[c]!, 0)
        keys.forEach((k, i) => {
          f[i] = (total(k) + STOP_SHRINK_KAPPA) / (expected + STOP_SHRINK_KAPPA)
        })
        const mean = f.reduce((a, b) => a + b, 0) / f.length
        for (let i = 0; i < f.length; i++) f[i]! /= mean
      }
      refreshProfile()
      return { f, p }
    }

    // Fit, drop the stops the method barely sees, and fit again without them so
    // they don't drag the profile down.
    let keys = enough
    let fit = ipf(keys)
    const kept = keys.filter((_, i) => fit.f[i]! >= MIN_STOP_FACTOR)
    if (kept.length > 0 && kept.length < keys.length) {
      keys = kept
      fit = ipf(keys)
    }
    const { f, p } = fit

    keys.forEach((k, i) => factor.set(k, f[i]!))
    for (const c of usable) {
      const arrivals = keys.reduce((a, k) => a + pool.keys.get(k)!.n[c]!, 0)
      const enoughDays = pool.daysOk[c]! >= MIN_COLUMN_DAYS
      if (enoughDays && arrivals >= MIN_PROFILE_ARRIVALS && p[c]! > 0) profile.set(`${ld}|${c}`, p[c]!)
    }
  }

  return {
    profile,
    factor,
    headway(key, dayType, hour) {
      const base = profile.get(`${lineDirOf(key)}|${column(dayType, hour)}`)
      const relative = factor.get(key)
      if (base === undefined || relative === undefined) return undefined
      return 1 / (base * relative)
    },
    stratumHeadway(key, dayType, hour) {
      const base = profile.get(`${lineDirOf(key)}|${column(dayType, hour)}`)
      return base === undefined ? undefined : 1 / base
    }
  }
}

/** Bunching diagnostic: CV of consecutive healthy gaps, pooled over a line-direction's stops. */
export function pooledCv(pool: Pool): Map<string, number> {
  const sums = new Map<string, { g: number, sumH: number, sumH2: number }>()
  for (const [key, counts] of pool.keys) {
    const ld = lineDirOf(key)
    for (let c = 0; c < COLUMNS; c++) {
      if (counts.g[c]! === 0) continue
      const id = `${ld}|${c}`
      const acc = sums.get(id) ?? { g: 0, sumH: 0, sumH2: 0 }
      acc.g += counts.g[c]!
      acc.sumH += counts.sumH[c]!
      acc.sumH2 += counts.sumH2[c]!
      sums.set(id, acc)
    }
  }
  const out = new Map<string, number>()
  for (const [id, a] of sums) {
    if (a.g < MIN_PROFILE_ARRIVALS) continue
    const mean = a.sumH / a.g
    const variance = Math.max(0, a.sumH2 / a.g - mean * mean)
    out.set(id, Math.sqrt(variance) / mean)
  }
  return out
}
