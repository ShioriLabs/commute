import { describe, expect, it } from 'vitest'
import { lineGeometry, MAX_TRIP_BIAS } from '../scripts/observedHeadways/runtimes'
import { OBSERVED_HOP_S } from './runtimes.observed'
import { TJ_RUNTIME_BLOCKS, TJ_RUNTIMES } from './runtimes.planner'
import { TOPOLOGY } from './topology'

/*
 * The compact planner table must say exactly what runtimes.observed.ts says,
 * and still fit TOPOLOGY: the worker reads it by position, so a shifted stop
 * list would price the wrong hops without failing anything else.
 */

const geometry = lineGeometry(TOPOLOGY)

describe('runtimes.planner', () => {
  it('matches TOPOLOGY stop for stop', () => {
    for (const [ld, line] of Object.entries(TJ_RUNTIMES)) {
      const geo = geometry.get(ld)
      expect(geo, ld).toBeDefined()
      expect(line.stops, ld).toEqual(geo!.stops.map(s => `TJ-${s}`))
      expect(line.metres, ld).toEqual(geo!.hopMetres.map(m => m ?? 0))
      for (const dt of ['WD', 'WE'] as const) {
        expect(line[dt], `${ld} ${dt}`).toHaveLength(TJ_RUNTIME_BLOCKS.length)
        for (const bucket of line[dt]) {
          if (!bucket) continue
          expect(bucket.s, ld).toHaveLength(line.stops.length - 1)
          expect(bucket.p75, ld).toHaveLength(line.stops.length - 1)
          expect(bucket.bias >= 1 && bucket.bias <= MAX_TRIP_BIAS, ld).toBe(true)
        }
      }
    }
  })

  it('holds the same cells as runtimes.observed.ts, and no others', () => {
    const fromPlanner = new Map<string, [number, number]>()
    for (const [ld, line] of Object.entries(TJ_RUNTIMES)) {
      for (const dt of ['WD', 'WE'] as const) {
        line[dt].forEach((bucket, b) => bucket?.s.forEach((s, i) => {
          if (s > 0) fromPlanner.set(`${dt}:${TJ_RUNTIME_BLOCKS[b]}:${ld}:${line.stops[i]}>${line.stops[i + 1]}`, [s, bucket.p75[i]!])
        }))
      }
    }
    const fromObserved = new Map(Object.entries(OBSERVED_HOP_S).map(([k, [s, p75]]) => [k, [s, p75] as [number, number]]))
    expect(fromPlanner.size).toBe(fromObserved.size)
    for (const [key, value] of fromObserved) expect(fromPlanner.get(key), key).toEqual(value)
  })
})
