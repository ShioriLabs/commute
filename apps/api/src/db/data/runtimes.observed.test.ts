import { describe, expect, it } from 'vitest'
import { lineGeometry } from '../scripts/observedHeadways/runtimes'
import { OBSERVED_HOP_S, OBSERVED_RUNTIME_BLOCKS, OBSERVED_RUNTIMES_META, OBSERVED_SERVICE_WINDOWS, OBSERVED_TRIP_S } from './runtimes.observed'
import { TOPOLOGY } from './topology'

/*
 * Guards on the generated runtimes.observed.ts: a refit after a topology change
 * or an estimator slip should fail here, not reach the router silently.
 */

const geometry = lineGeometry(TOPOLOGY)
const BLOCKS = new Set<string>(OBSERVED_RUNTIME_BLOCKS)

/** Hop index of `from>to` in a line-direction, or -1 when they aren't adjacent there. */
function hopIndex(ld: string, from: string, to: string): number {
  const stops = geometry.get(ld)?.stops.map(s => `TJ-${s}`)
  if (!stops) return -1
  const i = stops.indexOf(from)
  return i >= 0 && stops[i + 1] === to ? i : -1
}

describe('runtimes.observed', () => {
  it('keys every hop on a pair of adjacent stops of a TOPOLOGY line-direction', () => {
    const bad = Object.keys(OBSERVED_HOP_S).filter((key) => {
      const [dt, block, ld, pair] = key.split(':') as [string, string, string, string]
      const [from, to] = pair.split('>') as [string, string]
      return !['WD', 'WE'].includes(dt) || !BLOCKS.has(block) || hopIndex(ld, from, to) < 0
    })
    expect(bad).toEqual([])
  })

  it('keeps measured and scaled hops at bus speeds', () => {
    const bad = Object.entries(OBSERVED_HOP_S).flatMap(([key, [s, , basis]]) => {
      if (basis === 'DISTANCE') return []
      const [, , ld, pair] = key.split(':') as [string, string, string, string]
      const [from, to] = pair.split('>') as [string, string]
      const metres = geometry.get(ld)!.hopMetres[hopIndex(ld, from, to)]
      if (metres === undefined || metres <= 0) return []
      const kmh = (metres / s) * 3.6
      // A hop includes the dwell at its next stop, so a halte where buses are
      // held reads slow: 9 through H00071P sits at 3.1-3.7 km/h in both directions.
      return kmh < 3 || kmh > 80 ? [`${key} ${kmh.toFixed(1)} km/h`] : []
    })
    expect(bad).toEqual([])
  })

  it('has positive medians with p75 at or above them', () => {
    for (const [key, [s, p75]] of Object.entries(OBSERVED_HOP_S)) {
      expect(s, key).toBeGreaterThan(0)
      expect(p75, key).toBeGreaterThanOrEqual(s)
    }
    for (const [key, [s, p75, n]] of Object.entries(OBSERVED_TRIP_S)) {
      expect(s, key).toBeGreaterThan(0)
      expect(p75, key).toBeGreaterThanOrEqual(s)
      expect(n, key).toBeGreaterThanOrEqual(OBSERVED_RUNTIMES_META.minTrips)
    }
  })

  it('keeps service windows inside one day, and allDay without edges', () => {
    for (const [ld, byDay] of Object.entries(OBSERVED_SERVICE_WINDOWS)) {
      expect(geometry.has(ld), ld).toBe(true)
      for (const w of Object.values(byDay)) {
        if (w.allDay) expect(w.first ?? w.last, ld).toBeUndefined()
        for (const t of [w.first, w.last]) {
          if (t !== undefined) expect(t >= 0 && t < 86_400, ld).toBe(true)
        }
        expect(w.days, ld).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('names mismatched hops that exist in TOPOLOGY', () => {
    for (const [ld, pairs] of Object.entries(OBSERVED_RUNTIMES_META.mismatchedHops)) {
      for (const pair of pairs) {
        const [from, to] = pair.split('>') as [string, string]
        expect(hopIndex(ld, from, to), `${ld} ${pair}`).toBeGreaterThan(0)
      }
    }
  })
})
