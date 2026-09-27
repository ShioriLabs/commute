import { describe, expect, it } from 'vitest'
import { buildGraph } from '../router'
import { plan } from './plan'
import type { ServiceWindow } from './service-hours'

const edge = (lineCode: string, from: string, to: string, distance = 1000) => ([
  { lineCode, fromStationId: from, toStationId: to, distance },
  { lineCode, fromStationId: to, toStationId: from, distance }
])

const at = (h: number, m = 0) => h * 3600 + m * 60

/*
 * A miniature of the documented 3am case.
 *
 * DAY is a direct two-stop corridor that shuts at 22:00 — the 13E/9C shape.
 * NIGHT is a longer way round that runs around the clock — Koridor 1 AMARI.
 * By day the direct line wins on every criterion; at 03:00 it is not running,
 * and the honest answer is the long way.
 */
const edges = [
  ...edge('DAY', 'TJ-A', 'TJ-B', 1000),
  ...edge('DAY', 'TJ-B', 'TJ-Z', 1000),
  ...edge('NIGHT', 'TJ-A', 'TJ-M', 3000),
  ...edge('NIGHT', 'TJ-M', 'TJ-Z', 3000)
]
const graph = buildGraph(edges, [])

const DAYTIME: ServiceWindow = [at(5), at(22)]
const ROUND_THE_CLOCK: ServiceWindow = [0, 86399]
const serviceHours = new Map<string, ServiceWindow>([
  ['DAY', DAYTIME],
  ['NIGHT', ROUND_THE_CLOCK]
])

const linesOf = (journey: { legs: readonly { type: string }[] }) =>
  journey.legs.filter(l => l.type === 'RIDE').map(l => (l as { lineCode: string }).lineCode)

describe('plan with service hours', () => {
  it('takes the direct corridor during the day', () => {
    const [best] = plan(graph, 'TJ-A', 'TJ-Z', {
      departureS: at(13),
      serviceHours
    })
    expect(best).toBeDefined()
    expect(linesOf(best!)).toEqual(['DAY'])
  })

  /*
   * The bug this whole feature exists to fix: at 03:00 the direct corridor is
   * shut, so a time-blind search hands the rider a bus that is not running.
   */
  it('falls back to the all-night corridor at 3am', () => {
    const journeys = plan(graph, 'TJ-A', 'TJ-Z', {
      departureS: at(3),
      serviceHours
    })
    expect(journeys.length).toBeGreaterThan(0)
    for (const journey of journeys) expect(linesOf(journey)).not.toContain('DAY')
    expect(linesOf(journeys[0]!)).toEqual(['NIGHT'])
  })

  it('reopens the direct corridor the minute service starts', () => {
    const justBefore = plan(graph, 'TJ-A', 'TJ-Z', { departureS: at(4, 59), serviceHours })
    const justAfter = plan(graph, 'TJ-A', 'TJ-Z', { departureS: at(5), serviceHours })
    expect(justBefore.some(j => linesOf(j).includes('DAY'))).toBe(false)
    expect(justAfter.some(j => linesOf(j).includes('DAY'))).toBe(true)
  })

  /*
   * Absent inputs must behave exactly as before service hours existed. This is
   * what makes the change additive rather than a behavioural break, and is why
   * the pre-existing plan suite still passes untouched.
   */
  describe('backwards compatibility', () => {
    it('ignores service hours when no departure time is given', () => {
      const [best] = plan(graph, 'TJ-A', 'TJ-Z', { serviceHours })
      expect(linesOf(best!)).toEqual(['DAY'])
    })

    it('ignores a departure time when no service hours are given', () => {
      const [best] = plan(graph, 'TJ-A', 'TJ-Z', { departureS: at(3) })
      expect(linesOf(best!)).toEqual(['DAY'])
    })

    it('leaves a line with no window of its own always open', () => {
      const partial = new Map<string, ServiceWindow>([['DAY', DAYTIME]])
      const [best] = plan(graph, 'TJ-A', 'TJ-Z', { departureS: at(3), serviceHours: partial })
      // NIGHT is absent from the map, so it stays boardable rather than closing.
      expect(linesOf(best!)).toEqual(['NIGHT'])
    })
  })

  /*
   * A window that wraps midnight is the normal shape for rail. Getting the
   * comparison wrong here does not throw — it closes the line at every hour of
   * the day, which is why it is asserted at both ends and in the dead zone.
   */
  describe('a corridor running past midnight', () => {
    const overnight = new Map<string, ServiceWindow>([
      ['DAY', [at(3, 50), at(1, 7)]],
      ['NIGHT', ROUND_THE_CLOCK]
    ])

    it('is boardable on both sides of midnight', () => {
      for (const t of [at(0, 30), at(1, 7), at(4), at(23, 59)]) {
        const [best] = plan(graph, 'TJ-A', 'TJ-Z', { departureS: t, serviceHours: overnight })
        expect(linesOf(best!)).toEqual(['DAY'])
      }
    })

    it('is closed inside its overnight break', () => {
      for (const t of [at(1, 8), at(2, 30), at(3, 49)]) {
        const journeys = plan(graph, 'TJ-A', 'TJ-Z', { departureS: t, serviceHours: overnight })
        for (const journey of journeys) expect(linesOf(journey)).not.toContain('DAY')
      }
    })
  })

  /*
   * Boarding is filtered; staying aboard is not. A rider already on a line does
   * not re-board it at every stop, so a closing line must not sever a ride that
   * legitimately started while it was open.
   */
  it('does not filter the stops a boarded line merely passes through', () => {
    const throughLine = [
      ...edge('THROUGH', 'TJ-A', 'TJ-B'),
      ...edge('THROUGH', 'TJ-B', 'TJ-C'),
      ...edge('THROUGH', 'TJ-C', 'TJ-D')
    ]
    const [best] = plan(buildGraph(throughLine, []), 'TJ-A', 'TJ-D', {
      departureS: at(13),
      serviceHours: new Map([['THROUGH', DAYTIME]])
    })
    expect(best).toBeDefined()
    // One boarding at A, riding through B and C without re-boarding.
    expect(best!.criteria.boardings).toBe(1)
    expect(best!.legs).toHaveLength(1)
  })

  it('returns nothing when every line is shut', () => {
    const allClosed = new Map<string, ServiceWindow>([
      ['DAY', DAYTIME],
      ['NIGHT', DAYTIME]
    ])
    expect(plan(graph, 'TJ-A', 'TJ-Z', { departureS: at(3), serviceHours: allClosed })).toEqual([])
  })
})
