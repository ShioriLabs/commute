import { describe, expect, it } from 'vitest'
import { buildGraph } from '../router'
import { plan, type WaitModel } from './plan'

const edge = (lineCode: string, from: string, to: string, distance = 1000) => ([
  { lineCode, fromStationId: from, toStationId: to, distance },
  { lineCode, fromStationId: to, toStationId: from, distance }
])

/*
 * Lines X and Y share A-B-C, then part: X runs on to D, Y to E. Anyone riding
 * A -> C takes whichever comes first; anyone riding A -> D needs an X.
 */
const graph = buildGraph([
  ...edge('X', 'TJ-A', 'TJ-B'),
  ...edge('X', 'TJ-B', 'TJ-C'),
  ...edge('X', 'TJ-C', 'TJ-D'),
  ...edge('Y', 'TJ-A', 'TJ-B'),
  ...edge('Y', 'TJ-B', 'TJ-C'),
  ...edge('Y', 'TJ-C', 'TJ-E')
], [])

// Either of two lines: a minute and a half. One line alone: five minutes.
const calls: { lines: readonly string[], stop: string, next: string }[] = []
const waitS: WaitModel = (lines, stop, next) => {
  calls.push({ lines, stop, next })
  return lines.length > 1 ? 90 : 300
}

describe('plan with a wait model', () => {
  it('charges the shared wait on a ride the lines run together', () => {
    const [best] = plan(graph, 'TJ-A', 'TJ-C', { waitS })
    expect(best!.criteria.waitS).toBe(90)
  })

  it('tops the wait up to the boarded line\'s own where the others leave', () => {
    const [best] = plan(graph, 'TJ-A', 'TJ-D', { waitS })
    expect(best!.criteria.waitS).toBe(300)
    expect(best!.legs).toHaveLength(1)
  })

  it('asks for each set by where it was boarded and which way, boarded line first', () => {
    calls.length = 0
    plan(graph, 'TJ-A', 'TJ-D', { waitS })
    expect(calls).toContainEqual({ lines: ['X', 'Y'], stop: 'TJ-A', next: 'TJ-B' })
    expect(calls).toContainEqual({ lines: ['X'], stop: 'TJ-A', next: 'TJ-B' })
  })

  it('leaves a line that cannot be boarded out of the set', () => {
    const [best] = plan(graph, 'TJ-A', 'TJ-C', { waitS, excludeLines: new Set(['Y']) })
    expect(best!.criteria.waitS).toBe(300)
  })

  it('charges half the headway, as before, without one', () => {
    const [best] = plan(graph, 'TJ-A', 'TJ-C', { headwaysS: new Map([['X', 600], ['Y', 600]]) })
    expect(best!.criteria.waitS).toBe(300)
  })
})
