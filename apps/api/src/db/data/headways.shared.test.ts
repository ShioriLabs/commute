import { describe, expect, it } from 'vitest'
import { enumerateSharedSets, sharedKey } from '../scripts/observedHeadways/shared'
import { SHARED_CV, SHARED_CV_BLOCKS } from './headways.shared'

/*
 * Guards the generated shared-stretch CVs (fit:tj-shared-waits). A key the
 * runtime cannot rebuild is a cell nothing ever reads, so the shape is checked
 * against the same set enumeration the fit and the search agree on.
 */
describe('headways.shared', () => {
  const known = new Set(enumerateSharedSets().map(s => sharedKey(s.stop, s.next, s.lines)))
  const parse = (key: string) => {
    const [dayType, block] = key.split(':') as [string, string]
    return { dayType, block, set: key.slice(dayType.length + block.length + 2) }
  }

  it('has a finite, positive CV in every cell', () => {
    for (const cv of Object.values(SHARED_CV)) {
      expect(Number.isFinite(cv)).toBe(true)
      expect(cv).toBeGreaterThan(0)
    }
  })

  it('keys every cell by a day type, a block and a set the topology still has', () => {
    const stale: string[] = []
    for (const key of Object.keys(SHARED_CV)) {
      const { dayType, block, set } = parse(key)
      expect(['WD', 'WE']).toContain(dayType)
      expect(block === '*' || (Number(block) >= 0 && Number(block) < SHARED_CV_BLOCKS.length)).toBe(true)
      if (!known.has(set)) stale.push(set)
    }
    // A topology edit that drops a set should be refitted; say which, not just how many.
    expect([...new Set(stale)]).toEqual([])
  })
})
