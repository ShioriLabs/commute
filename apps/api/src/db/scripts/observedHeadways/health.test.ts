import { describe, expect, it } from 'vitest'
import { SnapshotCollector } from './collector'
import { DEFAULT_GATE, healthySecondsByHour, intervals, isHealthy, wibHour } from './health'
import type { Snap, Tuple } from './snapshots'

describe('isHealthy', () => {
  it('judges the share gate by fresh / in-scope', () => {
    expect(isHealthy(DEFAULT_GATE, 40, 50)).toBe(true)
    expect(isHealthy(DEFAULT_GATE, 24, 50)).toBe(false)
    expect(isHealthy(DEFAULT_GATE, 25, 50)).toBe(true)
  })

  it('refuses a snapshot with too few buses in scope to judge', () => {
    expect(isHealthy(DEFAULT_GATE, 5, 5)).toBe(false)
  })

  it('keeps the fixed-count gate for reproducing older numbers', () => {
    expect(isHealthy({ kind: 'count', min: 400 }, 399, 1000)).toBe(false)
    expect(isHealthy({ kind: 'count', min: 400 }, 400, 1000)).toBe(true)
  })
})

describe('intervals', () => {
  const gap = (from: number, to: number) => ({ k: 'gap' as const, from, to, why: 'stale' })

  it('merges overlapping and touching gaps', () => {
    expect(intervals([gap(50, 80), gap(0, 20), gap(10, 30), gap(30, 40)]).merged).toEqual([[0, 40], [50, 80]])
  })

  it('answers containment and overlap', () => {
    const iv = intervals([gap(100, 200)])
    expect(iv.contains(150)).toBe(true)
    expect(iv.contains(250)).toBe(false)
    expect(iv.overlaps(50, 150)).toBe(true)
    expect(iv.overlaps(200, 300)).toBe(false)
    expect(iv.overlaps(0, 100)).toBe(false)
  })
})

describe('healthySecondsByHour', () => {
  // 2026-10-10T23:50:00Z is 06:50 WIB on the 11th.
  const t0 = Date.UTC(2026, 9, 10, 23, 50, 0)
  const min = 60_000

  it('splits a healthy span at the WIB hour boundary', () => {
    const out = healthySecondsByHour(t0, t0 + 20 * min, [])
    expect(wibHour(t0)).toBe(6)
    expect(out[6]).toBe(600)
    expect(out[7]).toBe(600)
    expect(out.reduce((a, b) => a + b, 0)).toBe(1200)
  })

  it('subtracts unhealthy intervals, including ones outside the span', () => {
    const out = healthySecondsByHour(t0, t0 + 20 * min, [
      [t0 - 5 * min, t0 - 1 * min],
      [t0 + 12 * min, t0 + 17 * min],
      [t0 + 30 * min, t0 + 40 * min]
    ])
    expect(out[6]).toBe(600)
    expect(out[7]).toBe(300)
  })

  it('returns zeros for an empty span', () => {
    expect(healthySecondsByHour(0, 0, []).every(s => s === 0)).toBe(true)
  })
})

describe('SnapshotCollector', () => {
  const routes = new Set(['T'])
  const bodies = Array.from({ length: 25 }, (_, i) => `b${i}`)
  /** A snapshot where `fresh` says whether the buses updated since the previous one. */
  const snapshot = (t: number, upd: number): Snap => ({
    k: 's',
    t,
    v: bodies.map(body => [body, 'T', 'A-1', 0, 0, 0, upd] as Tuple)
  })

  it('merges a frozen stretch into one stale gap and recovers', () => {
    const c = new SnapshotCollector(routes, DEFAULT_GATE)
    c.add(snapshot(30_000, 30_000))
    c.add(snapshot(60_000, 60_000))
    c.add(snapshot(90_000, 60_000)) // nobody moved
    c.add(snapshot(120_000, 60_000))
    c.add(snapshot(150_000, 150_000)) // moving again
    expect(c.gaps).toEqual([{ k: 'gap', from: 60_000, to: 120_000, why: 'stale' }])
    expect(c.degradedSnaps).toBe(2)
  })

  it('treats the relay\'s replayed snapshot as neither fresh nor a gap', () => {
    const c = new SnapshotCollector(routes, DEFAULT_GATE)
    c.add(snapshot(30_000, 30_000))
    c.add(snapshot(31_000, 30_000))
    expect(c.gaps).toEqual([])
    expect(c.snapCount).toBe(2)
  })

  it('records silence between snapshots as a gap', () => {
    const c = new SnapshotCollector(routes, DEFAULT_GATE)
    c.add(snapshot(30_000, 30_000))
    c.add(snapshot(200_000, 200_000))
    expect(c.gaps).toEqual([{ k: 'gap', from: 30_000, to: 200_000, why: 'silence' }])
  })

  it('keeps one observation per vehicle update and skips other routes', () => {
    const c = new SnapshotCollector(routes, DEFAULT_GATE)
    c.add({ k: 's', t: 30_000, v: [['x', 'T', 'A-1', 0, 0, 0, 1000], ['y', 'OTHER', 'A-1', 0, 0, 0, 1000]] })
    c.add({ k: 's', t: 60_000, v: [['x', 'T', 'A-1', 0, 0, 0, 1000], ['y', 'OTHER', 'A-1', 0, 0, 0, 2000]] })
    expect([...c.series.keys()]).toEqual(['x'])
    expect(c.series.get('x')).toHaveLength(1)
  })
})
