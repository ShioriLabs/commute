import { describe, expect, it } from 'vitest'
import type { LineTopology } from '../db/data/topology'
import { chainsOf, tjDirOf } from './tjHops'

const line = (path: LineTopology['path']): LineTopology => ({ operator: 'TJ', lineCode: 'X', path } as LineTopology)

describe('chainsOf', () => {
  it('reads a both-ways list backwards for R, in R travel order', () => {
    const [f, r] = chainsOf(line([{ station: 'A', pos: '' }, { station: 'B', pos: '' }, { station: 'C', pos: '' }]))
    expect(f!.hops).toEqual([['TJ-A', 'TJ-B'], ['TJ-B', 'TJ-C']])
    expect(r!.hops).toEqual([['TJ-C', 'TJ-B'], ['TJ-B', 'TJ-A']])
  })

  /*
   * C is served going F only, so R runs D -> B -> A past it. chainHops already
   * walks that in R order; reversing it again would put B -> A first and narrow
   * a shared set against the wrong end of the ride.
   */
  it('keeps a one-way list\'s R walk in its own travel order', () => {
    const [, r] = chainsOf(line([
      { station: 'A', pos: '' },
      { station: 'B', pos: '' },
      { station: 'C', pos: '', serves: 'forward' },
      { station: 'D', pos: '' }
    ]))
    expect(r!.hops).toEqual([['TJ-D', 'TJ-B'], ['TJ-B', 'TJ-A']])
  })
})

describe('tjDirOf', () => {
  it('names the direction a real line runs a hop in, and nothing for a hop it lacks', () => {
    // 4D toward Pulo Gadung runs Karet Kuningan -> Kuningan Madya, then turns off for Halimun.
    expect(tjDirOf('4D', 'TJ-H00098P', 'TJ-H00114P')).toBe('R')
    expect(tjDirOf('4D', 'TJ-H00114P', 'TJ-H00215P')).toBeUndefined()
  })
})
