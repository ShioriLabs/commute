import { describe, expect, it } from 'vitest'
import { aggregateCollected, aggregationFingerprint, dayTypeOf } from './aggregate'
import { buildOrder } from './arrivals'
import { SnapshotCollector } from './collector'
import type { Tuple } from './snapshots'

const order = buildOrder([
  { operator: 'TJ', lineCode: 'T', path: [{ station: 'A' }, { station: 'B' }], pathReverse: [{ station: 'B' }, { station: 'A' }] }
] as never)

describe('dayTypeOf', () => {
  it('buckets Sat and Sun as weekend and Mon-Fri as weekday', () => {
    expect(dayTypeOf('20261009')).toBe('WD') // Friday
    expect(dayTypeOf('20261010')).toBe('WE') // Saturday
    expect(dayTypeOf('20261011')).toBe('WE') // Sunday
    expect(dayTypeOf('20261012')).toBe('WD') // Monday
  })

  it('puts a public holiday on the weekend side, as the runtime does', () => {
    // Friday 2026-12-25 (Natal): serviceDay() maps it to SUN, which reads the WE model.
    expect(dayTypeOf('20261225')).toBe('WE')
    // The day before is an ordinary Thursday.
    expect(dayTypeOf('20261224')).toBe('WD')
  })
})

describe('aggregationFingerprint', () => {
  const gate = { kind: 'share' as const, minShare: 0.5, minScope: 20 }

  it('is stable for the same inputs', () => {
    expect(aggregationFingerprint(order, gate)).toBe(aggregationFingerprint(order, gate))
  })

  it('changes when the stop order or a direction assignment changes', () => {
    const changed = buildOrder([
      { operator: 'TJ', lineCode: 'T', path: [{ station: 'A' }, { station: 'C' }], pathReverse: [{ station: 'C' }, { station: 'A' }] }
    ] as never)
    expect(aggregationFingerprint(changed, gate)).not.toBe(aggregationFingerprint(order, gate))
  })

  it('changes when the health gate or the arrival options change', () => {
    const base = aggregationFingerprint(order, gate)
    expect(aggregationFingerprint(order, { ...gate, minShare: 0.4 })).not.toBe(base)
    expect(aggregationFingerprint(order, { kind: 'count', min: 400 })).not.toBe(base)
    expect(aggregationFingerprint(order, gate, { maxObsGapMs: 120_000, interpolate: true })).not.toBe(base)
    expect(aggregationFingerprint(order, gate, { maxObsGapMs: 300_000, interpolate: false })).not.toBe(base)
  })
})

describe('aggregateCollected', () => {
  // Monday 10:00 WIB.
  const base = Date.UTC(2026, 9, 12, 3, 0, 0)
  const always = { kind: 'count' as const, min: 0 }

  /** Three buses reach stop A at base + 15s, +615s, +1215s (observed 30s apart). */
  function collect() {
    const c = new SnapshotCollector(new Set(['T']), always)
    const observations = [0, 1, 2].map(i => ({ body: `b${i}`, first: base + i * 600_000 }))
    for (let k = 0; k <= 70; k++) {
      const t = base + k * 30_000
      const v: Tuple[] = observations.map(({ body, first }) => {
        const upd = t >= first + 30_000 ? first + 30_000 : first
        const next = t >= first + 30_000 ? 'B-1' : 'A-1'
        return [body, 'T', next, 0, 0, 0, Math.min(upd, t)] as Tuple
      }).filter((_, i) => t >= observations[i]!.first)
      c.add({ k: 's', t, v })
    }
    return c
  }

  it('counts arrivals and consecutive gaps per key and WIB hour', () => {
    const agg = aggregateCollected('20261012', collect(), order)
    expect(agg.dayType).toBe('WD')
    expect(agg.keys['T@TJ-A@F']).toEqual({ 10: [3, 2, 1200, 720_000] })
    expect(agg.healthySecByHour[10]).toBe(2100)
  })

  it('leaves out arrivals and gaps that touch unhealthy time', () => {
    const c = collect()
    // Mark the stretch around the middle arrival (+615s) as unhealthy.
    c.gaps.push({ k: 'gap', from: base + 500_000, to: base + 700_000, why: 'stale' })
    const agg = aggregateCollected('20261012', c, order)
    // Middle arrival is not counted, and both gaps adjacent to it are dropped.
    expect(agg.keys['T@TJ-A@F']).toEqual({ 10: [2, 0, 0, 0] })
    expect(agg.healthySecByHour[10]).toBe(2100 - 200)
  })

  it('returns an empty aggregate for a day with no snapshots', () => {
    const agg = aggregateCollected('20261012', new SnapshotCollector(new Set(['T']), always), order)
    expect(agg.keys).toEqual({})
    expect(agg.healthySecByHour.every(s => s === 0)).toBe(true)
  })
})
