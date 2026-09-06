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
 * A miniature of the real "rail only" question.
 *
 * BUS is a direct two-stop corridor. RAIL is a longer way round between the same
 * endpoints. The bus wins outright on distance, so anything that still returns
 * the rail route is doing so because the bus was excluded and not because the
 * criteria happened to prefer it.
 *
 * KCI-MID sits mid-route on the rail line so a journey can be forced to walk
 * onto, or ride through, a stop the excluded line also serves.
 */
const edges = [
  ...edge('BUS', 'TJ-A', 'TJ-Z', 1000),
  ...edge('RAIL', 'TJ-A', 'KCI-MID', 2000),
  ...edge('RAIL', 'KCI-MID', 'TJ-Z', 2000)
]
const graph = buildGraph(edges, [])

const linesOf = (journey: { legs: readonly { type: string }[] }) =>
  journey.legs.filter(l => l.type === 'RIDE').map(l => (l as { lineCode: string }).lineCode)

describe('plan with excludeLines', () => {
  it('rides the excluded line when nothing is excluded', () => {
    const [best] = plan(graph, 'TJ-A', 'TJ-Z', {})
    expect(linesOf(best!)).toEqual(['BUS'])
  })

  it('routes around an excluded line', () => {
    const journeys = plan(graph, 'TJ-A', 'TJ-Z', { excludeLines: new Set(['BUS']) })

    expect(journeys.length).toBeGreaterThan(0)
    expect(linesOf(journeys[0]!)).toEqual(['RAIL'])
    // Not merely deprioritised: no journey may board it at all.
    expect(journeys.flatMap(linesOf)).not.toContain('BUS')
  })

  it('returns nothing when every route needs an excluded line', () => {
    expect(plan(graph, 'TJ-A', 'TJ-Z', {
      excludeLines: new Set(['BUS', 'RAIL'])
    })).toEqual([])
  })

  /*
   * An empty set has to be indistinguishable from no set at all, or the option
   * costs a closure allocation and a Set lookup per boarding for nothing. This
   * is the same "absent means unrestricted" rule service hours already follow.
   */
  it('is a no-op for an empty set', () => {
    const unrestricted = plan(graph, 'TJ-A', 'TJ-Z', {})
    const empty = plan(graph, 'TJ-A', 'TJ-Z', { excludeLines: new Set() })

    expect(empty.map(linesOf)).toEqual(unrestricted.map(linesOf))
  })

  it('ignores an exclusion for a line the network does not have', () => {
    const [best] = plan(graph, 'TJ-A', 'TJ-Z', { excludeLines: new Set(['NOPE']) })
    expect(linesOf(best!)).toEqual(['BUS'])
  })

  /*
   * Both reasons a line may be unboardable have to apply together. Checking one
   * and not the other is the failure this composition exists to prevent: an
   * excluded line must stay excluded at 13:00 when its window is wide open.
   */
  describe('composed with service hours', () => {
    const serviceHours = new Map<string, ServiceWindow>([
      ['BUS', [0, 86399]],
      ['RAIL', [at(5), at(22)]]
    ])

    it('excludes a line that is currently running', () => {
      const [best] = plan(graph, 'TJ-A', 'TJ-Z', {
        departureS: at(13),
        serviceHours,
        excludeLines: new Set(['BUS'])
      })
      expect(linesOf(best!)).toEqual(['RAIL'])
    })

    it('still refuses a line that is shut, even when not excluded', () => {
      // 03:00: RAIL is closed and BUS is excluded, so nothing is boardable.
      expect(plan(graph, 'TJ-A', 'TJ-Z', {
        departureS: at(3),
        serviceHours,
        excludeLines: new Set(['BUS'])
      })).toEqual([])
    })
  })

  /*
   * The two asymmetries the boarding-only filter inherits from `canBoard`.
   */
  describe('what an exclusion does NOT do', () => {
    it('does not filter walk transfers', () => {
      // A walk carries no line code, so no exclusion can reach it.
      const walkable = buildGraph(
        [...edge('RAIL', 'KCI-MID', 'TJ-Z', 2000)],
        [{ fromStationId: 'TJ-A', toStationId: 'KCI-MID', distance: 200 }]
      )
      const [best] = plan(walkable, 'TJ-A', 'TJ-Z', { excludeLines: new Set(['BUS']) })

      expect(best).toBeDefined()
      expect(best!.legs[0]!.type).toBe('TRANSFER')
    })

    it('does not sever a ride already in progress at an intermediate stop', () => {
      // Excluding RAIL must not stop a BUS rider passing through KCI-MID, which
      // RAIL also serves. The journey rides straight through on one line.
      const through = buildGraph([
        ...edge('BUS', 'TJ-A', 'KCI-MID', 1000),
        ...edge('BUS', 'KCI-MID', 'TJ-Z', 1000),
        ...edge('RAIL', 'TJ-A', 'KCI-MID', 500)
      ], [])
      const [best] = plan(through, 'TJ-A', 'TJ-Z', { excludeLines: new Set(['RAIL']) })

      expect(linesOf(best!)).toEqual(['BUS'])
      expect(best!.criteria.boardings).toBe(1)
    })
  })
})
