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

  /*
   * Three lines leave A together; Z turns off after B, Y after C. Riding X to D
   * is charged the three-line wait at A, topped up twice: to the two-line wait
   * past B and to X's own past C.
   */
  const threeWay = buildGraph([
    ...edge('X', 'TJ-A', 'TJ-B'), ...edge('X', 'TJ-B', 'TJ-C'), ...edge('X', 'TJ-C', 'TJ-D'),
    ...edge('Y', 'TJ-A', 'TJ-B'), ...edge('Y', 'TJ-B', 'TJ-C'),
    ...edge('Z', 'TJ-A', 'TJ-B')
  ], [])
  const bySize: Record<number, number> = { 3: 60, 2: 90, 1: 300 }

  it('tops the wait up at each line that leaves, not only at the last', () => {
    const model: WaitModel = lines => bySize[lines.length]!
    expect(plan(threeWay, 'TJ-A', 'TJ-B', { waitS: model })[0]!.criteria.waitS).toBe(60)
    expect(plan(threeWay, 'TJ-A', 'TJ-C', { waitS: model })[0]!.criteria.waitS).toBe(90)
    expect(plan(threeWay, 'TJ-A', 'TJ-D', { waitS: model })[0]!.criteria.waitS).toBe(300)
  })

  // A model that breaks its contract and shrinks as the set narrows must not
  // hand back wait already charged: criteria only ever grow.
  it('never refunds wait when a narrower set is quoted lower', () => {
    const shrinking: WaitModel = lines => ({ 3: 200, 2: 100, 1: 50 } as Record<number, number>)[lines.length]!
    expect(plan(threeWay, 'TJ-A', 'TJ-D', { waitS: shrinking })[0]!.criteria.waitS).toBe(200)
  })

  it('charges half the headway, as before, without one', () => {
    const [best] = plan(graph, 'TJ-A', 'TJ-C', { headwaysS: new Map([['X', 600], ['Y', 600]]) })
    expect(best!.criteria.waitS).toBe(300)
  })
})
