import { sharedKey, tjChains, tjHopLines, type Dir, type TjChain } from '../../../utils/tjHops'
import type { Cell, DayType } from './aggregate'
import { RUNTIME_BLOCKS } from './dayTrips'
import { wibHour } from './health'

/*
 * Waiting on a stretch several TransJakarta lines share, where any of their
 * buses will do (docs/tj-observed-timings.md, "Shared stretches").
 *
 * The lines' bus counts add up exactly when their streams are merged, so the
 * shared headway needs no fit: it is 1 / Σ(1 / h_i) from the per-line model.
 * What does need measuring is how unevenly the merged buses come. Lines on one
 * road are held up by the same traffic and arrive together, which leaves the
 * long gaps a rider is most likely to land in; that shows up as the merged
 * stream's CV, and only there.
 *
 * Pure, so it is testable without archives: the set enumeration reads the
 * topology, and the gap cells read arrival times already extracted.
 */

/** One stop, the way out of it, and the lines a rider boarding there can take for some ride onward. */
export interface SharedSet {
  /** Full station id. */
  stop: string
  /**
   * The next stop, which says which way: the same lines pass a median halte in
   * both directions, and those are two different streams of buses.
   */
  next: string
  /** Line codes, sorted. */
  lines: string[]
  /** `${line}@${stop}@${dir}`, the arrival keys merged for this set. */
  members: string[]
}

export { sharedKey }

/**
 * Every (stop, line set) the search can charge a shared wait for.
 *
 * The engine's rule, applied to the same hops it has edges for: boarding at a
 * stop, the set is every line with the hop to the next stop, narrowed at each
 * further hop to the lines that run it too. Each distinct set of two or more
 * lines, per stop and first hop, is one entry.
 */
export function enumerateSharedSets(chains: readonly TjChain[] = tjChains(), hopLines = tjHopLines()): SharedSet[] {
  const out = new Map<string, SharedSet>()
  for (const chain of chains) {
    for (let i = 0; i < chain.hops.length; i++) {
      const [stop, next] = chain.hops[i]!
      let lines = new Map(hopLines.get(`${chain.hops[i]![0]}>${chain.hops[i]![1]}`) ?? [])
      for (let k = i; k < chain.hops.length && lines.size >= 2; k++) {
        if (k > i) {
          const onHop = hopLines.get(`${chain.hops[k]![0]}>${chain.hops[k]![1]}`)
          lines = new Map([...lines].filter(([line]) => onHop?.has(line)))
          if (lines.size < 2) break
        }
        const key = sharedKey(stop, next, [...lines.keys()])
        if (out.has(key)) continue
        const sorted = [...lines.keys()].sort()
        out.set(key, { stop, next, lines: sorted, members: sorted.map(line => `${line}@${stop}@${lines.get(line) as Dir}`) })
      }
    }
  }
  return [...out.values()]
}

export const blockAt = (t: number) => {
  const hour = wibHour(t)
  return RUNTIME_BLOCKS.findIndex(([a, b]) => hour >= a && hour < b)
}

/** What gap cells need of the day's unhealthy time (health.ts `intervals`). */
export interface Unhealthy {
  contains: (t: number) => boolean
  overlaps: (a: number, b: number) => boolean
}

/**
 * Gaps between consecutive arrivals of a set's merged stream, per runtime
 * block, as `[n, g, Σh, Σh²]` cells (aggregate.ts `Cell`).
 *
 * Buses of two lines passing within seconds of each other are two arrivals a
 * few seconds apart: the rate is right and the near-zero gap is exactly the
 * clustering the CV is for. A gap that spans unhealthy time is dropped, as in
 * the per-line aggregation, because an unseen bus may sit inside it.
 */
export function mergedCells(
  arrivals: ReadonlyMap<string, readonly number[]>,
  sets: readonly SharedSet[],
  unhealthy: Unhealthy
): Record<string, Record<number, Cell>> {
  const out: Record<string, Record<number, Cell>> = {}
  for (const set of sets) {
    const times = set.members.flatMap(key => arrivals.get(key) ?? []).sort((a, b) => a - b)
    if (times.length < 2) continue
    const byBlock: Record<number, Cell> = {}
    const cell = (t: number): Cell => byBlock[blockAt(t)] ??= [0, 0, 0, 0]
    for (let i = 0; i < times.length; i++) {
      const t = times[i]!
      if (!unhealthy.contains(t)) cell(t)[0]++
      if (i === 0 || unhealthy.overlaps(times[i - 1]!, t)) continue
      const h = (t - times[i - 1]!) / 1000
      const c = cell(t)
      c[1]++
      c[2] += h
      c[3] += h * h
    }
    if (Object.values(byBlock).some(c => c[1] > 0)) out[sharedKey(set.stop, set.next, set.lines)] = byBlock
  }
  return out
}

/** Pooled gaps behind a shipped CV. The same floor as the per-line profile CV. */
export const MIN_SHARED_GAPS = 30

/**
 * CV of the merged gaps, pooled over days: per day type and block, and per day
 * type over all blocks (`*`), each only where it has MIN_SHARED_GAPS gaps.
 */
export function pooledSharedCv(days: readonly { dayType: DayType, cells: Record<string, Record<number, Cell>> }[]): Map<string, number> {
  const sums = new Map<string, [g: number, sumH: number, sumH2: number]>()
  const add = (id: string, c: Cell) => {
    const acc = sums.get(id) ?? [0, 0, 0]
    acc[0] += c[1]
    acc[1] += c[2]
    acc[2] += c[3]
    sums.set(id, acc)
  }
  for (const day of days) {
    for (const [key, blocks] of Object.entries(day.cells)) {
      for (const [block, c] of Object.entries(blocks)) {
        add(`${day.dayType}:${block}:${key}`, c)
        add(`${day.dayType}:*:${key}`, c)
      }
    }
  }
  const out = new Map<string, number>()
  for (const [id, [g, sumH, sumH2]] of sums) {
    if (g < MIN_SHARED_GAPS || sumH <= 0) continue
    const mean = sumH / g
    out.set(id, Math.sqrt(Math.max(0, sumH2 / g - mean * mean)) / mean)
  }
  return out
}
