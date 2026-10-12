import type { LineTopology } from '../../data/topology'
import type { Dir, Obs } from './snapshots'

/** Stop order per direction, per TJ line: station id -> index along the path. */
export type StopOrder = Map<string, Record<Dir, Map<string, number>>>

type TopologyLine = Pick<LineTopology, 'operator' | 'lineCode' | 'path' | 'pathReverse'>

export function buildOrder(topology: readonly TopologyLine[]): StopOrder {
  const order: StopOrder = new Map()
  for (const line of topology) {
    if (line.operator !== 'TJ') continue
    const reverse = line.pathReverse ?? [...line.path].reverse()
    order.set(line.lineCode, {
      F: new Map(line.path.filter(s => !s.passThrough).map((s, i) => [s.station, i])),
      R: new Map(reverse.filter(s => !s.passThrough).map((s, i) => [s.station, i]))
    })
  }
  return order
}

export interface ArrivalOptions {
  /**
   * Observations further apart than this don't bound an arrival tightly
   * enough to keep. A bus standing at a halte stops sending updates for
   * minutes, so this has to be generous; 2 min dropped half of K1.
   */
  maxObsGapMs: number
  /**
   * Credit stops passed between two observations (the bus went A -> C inside
   * one ~30s interval) with interpolated times. It would wrongly credit
   * express variants with haltes they skip, hence the switch.
   */
  interpolate: boolean
  /** Only arrivals at these times are kept. */
  keep?: (t: number) => boolean
}

export const DEFAULT_ARRIVAL_OPTIONS: ArrivalOptions = { maxObsGapMs: 300_000, interpolate: true }

export interface TransitionStats {
  transitions: number
  adjacent: number
  jump: number
  unknownStop: number
  wideGap: number
  routeChange: number
  ambiguousDir: number
}

/**
 * An arrival at stop A is a bus's `next_stops` changing from A to B between
 * two observations. Direction comes from the stop order along the line's path.
 * Keys are `${line}@TJ-${stop}@${dir}`, times in ms.
 */
export function extractArrivals(
  series: Iterable<Obs[]>,
  order: StopOrder,
  options: ArrivalOptions
): { arrivals: Map<string, number[]>, stats: TransitionStats } {
  const stats: TransitionStats = { transitions: 0, adjacent: 0, jump: 0, unknownStop: 0, wideGap: 0, routeChange: 0, ambiguousDir: 0 }
  const arrivals = new Map<string, number[]>()
  for (const list of series) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]!, b = list[i]!
      if (!a.next || !b.next || a.next === b.next) continue
      stats.transitions++
      if (a.route !== b.route) {
        stats.routeChange++
        continue
      }
      const ord = order.get(a.route)!
      if (b.t - a.t > options.maxObsGapMs) {
        stats.wideGap++
        continue
      }
      const step = (d: Dir) => ord[d].get(b.next)! - ord[d].get(a.next)!
      const dirs = (['F', 'R'] as Dir[]).filter((d) => {
        const ia = ord[d].get(a.next), ib = ord[d].get(b.next)
        return ia !== undefined && ib !== undefined && ib > ia
      })
      if (dirs.length === 0) {
        stats.unknownStop++
        continue
      }
      // Both directions ascend only on loops/overlaps; the tighter step wins, a tie is unknowable.
      dirs.sort((x, y) => step(x) - step(y))
      if (dirs.length > 1 && step(dirs[0]!) === step(dirs[1]!)) {
        stats.ambiguousDir++
        continue
      }
      const d = dirs[0]!
      const n = step(d)
      if (n === 1) stats.adjacent++
      else stats.jump++
      const byIndex = [...ord[d]].sort((x, y) => x[1] - y[1]).map(([station]) => station)
      const from = ord[d].get(a.next)!
      const passed = options.interpolate ? byIndex.slice(from, from + n) : [a.next]
      passed.forEach((stop, k) => {
        const t = a.t + ((k + 0.5) / passed.length) * (b.t - a.t)
        if (options.keep && !options.keep(t)) return
        const key = `${a.route}@TJ-${stop}@${d}`
        let times = arrivals.get(key)
        if (!times) arrivals.set(key, times = [])
        times.push(t)
      })
    }
  }
  return { arrivals, stats }
}
