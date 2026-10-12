import type { Gap } from './snapshots'

/*
 * Which snapshots count as usable.
 *
 * The relay keeps sending snapshots while the positions inside them freeze, so a
 * snapshot is judged by how many vehicles actually updated since the previous
 * one.
 *
 *   share  fresh / inScope >= minShare, where inScope is the in-scope vehicles
 *          that updated within SCOPE_FRESH_MS. The default. The ratio is
 *          bimodal in real data (about 0 frozen, about 0.87 healthy), so the
 *          cut is not sensitive, and it scales with how many buses are running,
 *          which a fixed count does not.
 *   count  fresh >= min. The original gate (400). It undercounts healthy time
 *          2-4x at night and on weekends, when fewer buses run; kept so the
 *          analysis CLI can reproduce older numbers.
 */
export type HealthGate
  = | { kind: 'count', min: number }
    | { kind: 'share', minShare: number, minScope: number }

export const DEFAULT_GATE: HealthGate = { kind: 'share', minShare: 0.5, minScope: 20 }

/** A vehicle updated this recently counts towards a snapshot's in-scope population. */
export const SCOPE_FRESH_MS = 600_000

export function isHealthy(gate: HealthGate, fresh: number, scope: number): boolean {
  if (gate.kind === 'count') return fresh >= gate.min
  return scope >= gate.minScope && fresh / scope >= gate.minShare
}

export type Interval = [number, number]

/** Merged, sorted [from, to] intervals with binary-search lookups. */
export function intervals(gaps: Gap[]) {
  const merged: Interval[] = []
  for (const g of [...gaps].sort((a, b) => a.from - b.from)) {
    const last = merged.at(-1)
    if (last && g.from <= last[1]) last[1] = Math.max(last[1], g.to)
    else merged.push([g.from, g.to])
  }
  /** Index of the last interval starting at or before t, or -1. */
  const floor = (t: number) => {
    let lo = 0, hi = merged.length - 1, found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (merged[mid]![0] <= t) {
        found = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return found
  }
  return {
    merged,
    contains: (t: number) => {
      const i = floor(t)
      return i >= 0 && t <= merged[i]![1]
    },
    overlaps: (from: number, to: number) => {
      const i = floor(to)
      return i >= 0 && merged[i]![1] > from && merged[i]![0] < to
    }
  }
}

const HOUR_MS = 3_600_000
const WIB_OFFSET_MS = 7 * HOUR_MS

export const wibHour = (t: number) => (new Date(t).getUTCHours() + 7) % 24

/**
 * Healthy seconds per WIB hour of day inside [t0, t1]: the span minus the
 * unhealthy intervals, split at hour boundaries.
 */
export function healthySecondsByHour(t0: number, t1: number, unhealthy: readonly Interval[]): number[] {
  const out = new Array<number>(24).fill(0)
  if (!(t1 > t0)) return out
  const addSpan = (from: number, to: number) => {
    let t = from
    while (t < to) {
      const hourEnd = (Math.floor((t + WIB_OFFSET_MS) / HOUR_MS) + 1) * HOUR_MS - WIB_OFFSET_MS
      const next = Math.min(to, hourEnd)
      out[wibHour(t)]! += (next - t) / 1000
      t = next
    }
  }
  let cursor = t0
  for (const [from, to] of unhealthy) {
    if (to <= cursor) continue
    if (from >= t1) break
    if (from > cursor) addSpan(cursor, from)
    cursor = Math.max(cursor, Math.min(to, t1))
  }
  if (cursor < t1) addSpan(cursor, t1)
  return out
}
