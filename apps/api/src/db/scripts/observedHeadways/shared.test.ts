import { describe, expect, it } from 'vitest'
import type { TjChain } from '../../../utils/tjHops'
import { enumerateSharedSets, mergedCells, MIN_SHARED_GAPS, pooledSharedCv, sharedKey, type SharedSet } from './shared'

describe('enumerateSharedSets', () => {
  const sets = enumerateSharedSets()
  const at = (stop: string, next: string) => sets.filter(s => s.stop === `TJ-${stop}` && s.next === `TJ-${next}`).map(s => s.lines.join(','))

  /*
   * Karet Kuningan (H00098P) -> Kuningan Madya (H00114P) -> Setiabudi
   * Integritas (H00215P): 4D runs the first hop back toward Pulo Gadung but
   * turns for Halimun before the second, so it is in the set boarding at Karet
   * Kuningan and gone once the ride reaches Integritas.
   */
  it('narrows a set where a line leaves the stretch', () => {
    expect(at('H00098P', 'H00114P')).toContain('13E,4D,6,6A,L13E')
    expect(at('H00098P', 'H00114P')).toContain('13E,6,6A,L13E')
    expect(at('H00114P', 'H00215P').some(lines => lines.includes('4D'))).toBe(false)
  })

  it('is directional: 4D serves Integritas outbound', () => {
    expect(at('H00215P', 'H00114P').some(lines => lines.split(',').includes('4D'))).toBe(true)
  })

  it('names each member line\'s own direction for its arrivals', () => {
    const set = sets.find(s => s.stop === 'TJ-H00098P' && s.next === 'TJ-H00114P' && s.lines.includes('4D'))!
    expect(set.members).toContain('4D@TJ-H00098P@R')
    expect(set.members.every(m => /^[^@]+@TJ-H00098P@[FR]$/.test(m))).toBe(true)
  })

  it('records only sets of two or more lines', () => {
    const chains: TjChain[] = [
      { lineCode: 'X', dir: 'F', hops: [['TJ-A', 'TJ-B'], ['TJ-B', 'TJ-C']] },
      { lineCode: 'Y', dir: 'F', hops: [['TJ-A', 'TJ-B']] }
    ]
    const hopLines = new Map([
      ['TJ-A>TJ-B', new Map([['X', 'F' as const], ['Y', 'F' as const]])],
      ['TJ-B>TJ-C', new Map([['X', 'F' as const]])]
    ])
    expect(enumerateSharedSets(chains, hopLines)).toEqual([
      { stop: 'TJ-A', next: 'TJ-B', lines: ['X', 'Y'], members: ['X@TJ-A@F', 'Y@TJ-A@F'] }
    ])
  })
})

describe('mergedCells', () => {
  const set: SharedSet = { stop: 'TJ-A', next: 'TJ-B', lines: ['X', 'Y'], members: ['X@TJ-A@F', 'Y@TJ-A@F'] }
  const healthy = { contains: () => false, overlaps: () => false }
  // Noon WIB on some day, so every arrival lands in the 10-16 block.
  const noon = Date.UTC(2026, 9, 14, 5, 0, 0)
  const every = (offsetS: number) => Array.from({ length: 20 }, (_, i) => noon + (i * 600 + offsetS) * 1000)
  const cvOf = (c: number[]) => {
    const [, g, sumH, sumH2] = c as [number, number, number, number]
    const mean = sumH / g
    return Math.sqrt(sumH2 / g - mean * mean) / mean
  }

  it('sees two lines arriving together as uneven, at the doubled rate', () => {
    const together = mergedCells(new Map([['X@TJ-A@F', every(0)], ['Y@TJ-A@F', every(5)]]), [set], healthy)
    const cell = together[sharedKey('TJ-A', 'TJ-B', ['X', 'Y'])]![3]!
    expect(cell[0]).toBe(40)
    expect(cvOf(cell)).toBeGreaterThan(0.9)
  })

  it('sees two lines interleaved as even', () => {
    const interleaved = mergedCells(new Map([['X@TJ-A@F', every(0)], ['Y@TJ-A@F', every(300)]]), [set], healthy)
    expect(cvOf(interleaved[sharedKey('TJ-A', 'TJ-B', ['X', 'Y'])]![3]!)).toBeCloseTo(0, 5)
  })

  it('drops a gap that spans unhealthy time', () => {
    const blind = { contains: () => false, overlaps: () => true }
    expect(mergedCells(new Map([['X@TJ-A@F', every(0)], ['Y@TJ-A@F', every(300)]]), [set], blind)).toEqual({})
  })
})

describe('pooledSharedCv', () => {
  const cell = (g: number, h: number) => [g + 1, g, g * h, g * h * h] as [number, number, number, number]

  it('pools days per block, above the floor only', () => {
    const cv = pooledSharedCv([
      { dayType: 'WD', cells: { k: { 3: cell(MIN_SHARED_GAPS, 300), 4: cell(5, 300) } } }
    ])
    expect(cv.get('WD:3:k')).toBeCloseTo(0, 5)
    expect(cv.has('WD:4:k')).toBe(false)
  })

  /*
   * Perfectly even service in each block, at different headways: pooled across
   * blocks it would read as uneven (CV 0.6 here), so it never is.
   */
  it('never pools across blocks, which would turn two even headways into false unevenness', () => {
    const cv = pooledSharedCv([
      { dayType: 'WD', cells: { k: { 2: cell(MIN_SHARED_GAPS, 300), 3: cell(MIN_SHARED_GAPS, 1200) } } }
    ])
    expect([...cv.keys()].sort()).toEqual(['WD:2:k', 'WD:3:k'])
    expect([...cv.values()].every(v => v < 1e-6)).toBe(true)
  })
})
