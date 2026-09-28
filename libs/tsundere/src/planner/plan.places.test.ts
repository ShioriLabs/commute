import { describe, expect, it } from 'vitest'
import { buildGraph } from '../router'
import { plan } from './plan'

const edge = (lineCode: string, from: string, to: string, distance = 1000) => ([
  { lineCode, fromStationId: from, toStationId: to, distance },
  { lineCode, fromStationId: to, toStationId: from, distance }
])

/*
 * Two stacked stops that are one place to a rider: KCI-D and MRTJ-P, joined by
 * an 80m walk, like LRT and TransJakarta Rasuna Said. Line X reaches D, line Z
 * leaves from P.
 */
const graph = buildGraph(
  [...edge('X', 'KCI-A', 'KCI-B'), ...edge('X', 'KCI-B', 'KCI-D'), ...edge('Z', 'MRTJ-P', 'MRTJ-Q')],
  [{ fromStationId: 'KCI-D', toStationId: 'MRTJ-P', distance: 80 }]
)
const place = new Set(['KCI-D', 'MRTJ-P'])

describe('plan with place-equivalent endpoints', () => {
  it('matches the single-station search when the sets hold only the named stations', () => {
    expect(plan(graph, 'KCI-A', 'MRTJ-Q', { originIds: new Set(['KCI-A']), targetIds: new Set(['MRTJ-Q']) }))
      .toEqual(plan(graph, 'KCI-A', 'MRTJ-Q'))
  })

  it('ends at whichever member it reaches, with no walk on to the named one', () => {
    const named = plan(graph, 'KCI-A', 'MRTJ-P')[0]!
    expect(named.legs.map(l => l.type)).toEqual(['RIDE', 'TRANSFER'])

    const [best] = plan(graph, 'KCI-A', 'MRTJ-P', { targetIds: place })
    expect(best!.legs.map(l => l.type)).toEqual(['RIDE'])
    expect(best!.legs[0]!.toStationId).toBe('KCI-D')
    expect(best!.criteria.walkDistanceM).toBe(0)
  })

  it('boards from any origin member, with no walk first', () => {
    const [best] = plan(graph, 'MRTJ-P', 'KCI-A', { originIds: place })
    expect(best!.legs.map(l => l.type)).toEqual(['RIDE'])
    expect(best!.legs[0]!.fromStationId).toBe('KCI-D')
  })

  /*
   * An "Arah" halte pair where a line calls at one side only (7R at Kali
   * Grogol). Picking the other side must still offer it, from the side it
   * actually stops at.
   */
  it('finds a line that serves only the other side of a directional pair', () => {
    const arah = buildGraph(
      [...edge('7R', 'TJ-NORTH', 'TJ-X'), ...edge('9', 'TJ-SOUTH', 'TJ-Y')],
      [{ fromStationId: 'TJ-NORTH', toStationId: 'TJ-SOUTH', distance: 100 }]
    )
    const [best] = plan(arah, 'TJ-SOUTH', 'TJ-X', { originIds: new Set(['TJ-NORTH', 'TJ-SOUTH']) })
    expect(best!.legs).toHaveLength(1)
    expect(best!.legs[0]).toMatchObject({ type: 'RIDE', lineCode: '7R', fromStationId: 'TJ-NORTH' })
  })

  it('returns nothing when no member of a set is in the graph', () => {
    expect(plan(graph, 'KCI-A', 'KCI-NOPE', { targetIds: new Set(['KCI-NOPE', 'KCI-ALSO-NOPE']) })).toEqual([])
  })
})
