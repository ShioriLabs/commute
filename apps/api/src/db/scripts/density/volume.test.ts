import { describe, expect, it } from 'vitest'
import type { RidershipAnchor } from '../../data/ridership'
import type { ReleaseCount } from '../../data/release-counts'
import { boardingsPerDay } from './model'
import { DESTINATION_SHARE_BEFORE_CUTOFF, KCI_WEEKDAY_RIDERS, ORIGIN_SHARE_BEFORE_CUTOFF, releaseBoardings, resolveVolumes, UNRANKED_MAX_GATE_BOARDINGS, type VolumeStation } from './volume'

const anchor = (stationId: string, gatePerDay: number, transitPerDay?: number): RidershipAnchor =>
  ({ stationId, gatePerDay, transitPerDay, period: 'test', published: 'test', source: 'test' })
const release = (stationId: string, count: number, kind: ReleaseCount['kind']): ReleaseCount =>
  ({ stationId, count, cutoffHour: 13, kind, published: 'test' })
const station = (id: string, score: number, over: Partial<VolumeStation> = {}): VolumeStation =>
  ({ id, operator: 'KCI', score, airportOnly: false, ...over })

describe('releaseBoardings', () => {
  it('scales a morning count up to a day by the share that falls before the cut-off', () => {
    expect(releaseBoardings(release('X', 13_000, 'boarding'))).toBeCloseTo(13_000 / ORIGIN_SHARE_BEFORE_CUTOFF)
    // A destination's day of alightings is matched by a day of boardings on the way home.
    expect(releaseBoardings(release('X', 17_000, 'alighting'))).toBeCloseTo(17_000 / DESTINATION_SHARE_BEFORE_CUTOFF)
  })
})

describe('resolveVolumes', () => {
  const anchors = new Map([['KCI-A', anchor('KCI-A', 200_000, 50_000)], ['MRTJ-M', anchor('MRTJ-M', 20_000)]])
  const releases = new Map([['KCI-R', release('KCI-R', 13_000, 'boarding')]])
  // Enough small stations that the network total fits under the unranked ceiling, as on the real network.
  const fillers = Array.from({ length: 150 }, (_, i) => station(`KCI-F${i}`, 40))
  const stations = [
    station('KCI-A', 95), station('KCI-R', 40),
    station('KCI-S1', 60), station('KCI-S2', 30), ...fillers,
    station('KCI-AIR', 50, { airportOnly: true }),
    station('MRTJ-M', 70, { operator: 'MRTJ' }), station('MRTJ-S', 50, { operator: 'MRTJ' })
  ]
  const v = resolveVolumes(stations, anchors, releases)

  it('uses an anchor as published, transfers included, and marks MRT anchors as metric-unstated', () => {
    expect(v.get('KCI-A')).toEqual({ boardings: 150_000, source: 'anchored' })
    expect(v.get('MRTJ-M')).toEqual({ boardings: 10_000, source: 'anchoredMetricUnstated' })
  })

  it('uses a release count where there is no anchor', () => {
    expect(v.get('KCI-R')).toEqual({ boardings: releaseBoardings(release('KCI-R', 13_000, 'boarding')), source: 'release' })
  })

  it('scales the rest of KCI so the gate boardings add up to the network total', () => {
    const gateTotal = 100_000 + [...stations].filter(s => s.operator === 'KCI' && !s.airportOnly && s.id !== 'KCI-A')
      .reduce((sum, s) => sum + v.get(s.id)!.boardings, 0)
    expect(gateTotal).toBeCloseTo(KCI_WEEKDAY_RIDERS, -1)
  })

  it('keeps score order and ratio among the scaled stations', () => {
    const ratio = v.get('KCI-S1')!.boardings / v.get('KCI-S2')!.boardings
    expect(ratio).toBeCloseTo(boardingsPerDay(undefined, 60) / boardingsPerDay(undefined, 30), 6)
    expect(v.get('KCI-S1')!.source).toBe('scored')
  })

  it('leaves airport-only stations and other operators on the plain score inversion', () => {
    expect(v.get('KCI-AIR')).toEqual({ boardings: boardingsPerDay(undefined, 50), source: 'scored' })
    expect(v.get('MRTJ-S')).toEqual({ boardings: boardingsPerDay(undefined, 50), source: 'scored' })
  })

  it('caps an unranked station below the top five and hands the excess to the rest, keeping the total', () => {
    const many = [station('KCI-BIG', 95), ...Array.from({ length: 40 }, (_, i) => station(`KCI-S${i}`, 50))]
    const out = resolveVolumes(many, new Map(), new Map())
    expect(out.get('KCI-BIG')!.boardings).toBeCloseTo(UNRANKED_MAX_GATE_BOARDINGS)
    const total = many.reduce((sum, s) => sum + out.get(s.id)!.boardings, 0)
    expect(total).toBeCloseTo(KCI_WEEKDAY_RIDERS, -1)
    expect(out.get('KCI-S0')!.boardings).toBeLessThanOrEqual(UNRANKED_MAX_GATE_BOARDINGS)
  })

  it('stops at the ceiling for everyone when too few stations are left to reach the total', () => {
    const out = resolveVolumes([station('KCI-S1', 60), station('KCI-S2', 30)], new Map(), new Map())
    expect(out.get('KCI-S1')!.boardings).toBeCloseTo(UNRANKED_MAX_GATE_BOARDINGS)
    expect(out.get('KCI-S2')!.boardings).toBeCloseTo(UNRANKED_MAX_GATE_BOARDINGS)
  })

  it('never scales down when the anchors already exceed the total', () => {
    const big = new Map([['KCI-A', anchor('KCI-A', 3_000_000)]])
    const out = resolveVolumes([station('KCI-A', 95), station('KCI-S', 40)], big, new Map())
    expect(out.get('KCI-S')!.boardings).toBeCloseTo(boardingsPerDay(undefined, 40))
  })
})
