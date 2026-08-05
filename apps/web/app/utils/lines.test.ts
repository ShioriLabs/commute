import { describe, expect, it } from 'vitest'
import { compareTJLineCode, sortLineKeysForDisplay } from './lines'

describe('compareTJLineCode', () => {
  it('orders corridors by number before letter suffix', () => {
    expect(['13E', '6', '6A'].sort(compareTJLineCode)).toEqual(['6', '6A', '13E'])
  })

  it('sorts an express variant inside its number group', () => {
    expect(['L13E', '13', '14'].sort(compareTJLineCode)).toEqual(['13', 'L13E', '14'])
  })

  it('sends non-numeric codes last', () => {
    expect(['PRJ2', '6'].sort(compareTJLineCode)).toEqual(['6', 'PRJ2'])
  })
})

describe('sortLineKeysForDisplay', () => {
  it('orders TJ keys by corridor number', () => {
    expect(sortLineKeysForDisplay(['TJ:13E', 'TJ:6A', 'TJ:6'], 'TJ')).toEqual(['TJ:6', 'TJ:6A', 'TJ:13E'])
  })

  it('drops seasonal PRJ shuttles', () => {
    expect(sortLineKeysForDisplay(['TJ:6', 'TJ:PRJ2'], 'TJ')).toEqual(['TJ:6'])
  })

  it('leaves other operators in their given order', () => {
    expect(sortLineKeysForDisplay(['KCI:C', 'KCI:B'], 'KCI')).toEqual(['KCI:C', 'KCI:B'])
  })

  /*
   * `/stations` used to carry whole Line objects and now carries bare keys, so
   * a stale service-worker cache still serves the old shape into current code.
   * It is typed `string`, so nothing catches it before runtime — this threw
   * "key.split is not a function" and took the station sheet down.
   */
  describe('legacy payloads from a stale cache', () => {
    const legacy = (lineCode: string, operator?: string) =>
      ({ lineCode, name: `Koridor ${lineCode}`, colorCode: '#123456', ...(operator ? { operator } : {}) } as unknown as string)

    it('re-keys Line objects instead of throwing', () => {
      expect(sortLineKeysForDisplay([legacy('6A'), legacy('6')], 'TJ')).toEqual(['TJ:6', 'TJ:6A'])
    })

    it('prefers an object\'s own operator over the list\'s', () => {
      expect(sortLineKeysForDisplay([legacy('C', 'KCI')], 'KCI')).toEqual(['KCI:C'])
    })

    it('keeps a legacy object that already carries a full key', () => {
      expect(sortLineKeysForDisplay([legacy('TJ:6')], 'TJ')).toEqual(['TJ:6'])
    })

    it('filters hidden corridors arriving as objects', () => {
      expect(sortLineKeysForDisplay([legacy('PRJ2'), legacy('6')], 'TJ')).toEqual(['TJ:6'])
    })

    it('drops entries too broken to re-key rather than crashing', () => {
      const keys = [undefined, null, {}, '', 'TJ:6'] as unknown as string[]
      expect(sortLineKeysForDisplay(keys, 'TJ')).toEqual(['TJ:6'])
    })

    it('survives a broken list for a non-TJ operator too', () => {
      const keys = [undefined, 'KCI:C'] as unknown as string[]
      expect(sortLineKeysForDisplay(keys, 'KCI')).toEqual(['KCI:C'])
    })
  })
})
