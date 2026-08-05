import type { Line, Searchable } from '@commute/schemas'
import { describe, expect, it } from 'vitest'
import { getForegroundColor } from 'utils/colors'
import { lineOf } from './searchable-item'

const bekasi: Line = { name: 'Lin Bekasi', lineCode: 'BK', colorCode: '#118f4a' }

/*
 * The shape useSearchables actually produces: `body` rehydrated from wire keys
 * into a Line[], for every item type. Building the fixture this way is the
 * point of the test — the crash came from assuming a bare object here.
 */
function searchable(type: Searchable['type'], body?: Line[]): Searchable<Line[]> {
  return {
    type,
    title: type === 'LINE' ? bekasi.name : 'Bekasi',
    to: type === 'LINE' ? '/lines/LRTJBDB/BK' : '/stations/KCI/BKS',
    keywords: ['bekasi'],
    body
  }
}

describe('lineOf', () => {
  it('takes the single line off a LINE result', () => {
    expect(lineOf(searchable('LINE', [bekasi]))).toEqual(bekasi)
  })

  it('ignores the lines a STATION carries', () => {
    // A station lists every line serving it; none is the station's own chip.
    expect(lineOf(searchable('STATION', [bekasi]))).toBeUndefined()
  })

  it('ignores a HUB spanning operators', () => {
    expect(lineOf(searchable('HUB', [bekasi]))).toBeUndefined()
  })

  it('returns undefined when a LINE carries no body', () => {
    expect(lineOf(searchable('LINE'))).toBeUndefined()
    expect(lineOf(searchable('LINE', []))).toBeUndefined()
  })

  /*
   * The reported crash. Typing "si" matches "Lin Beka(si)" — the one LINE that
   * clears the fuzzy threshold — and the row is rendered by SearchableItem,
   * which read `body.colorCode` off the ARRAY. That is undefined, and
   * getForegroundColor called `.startsWith` on it:
   *   TypeError: Cannot read properties of undefined (reading 'startsWith')
   */
  it('yields a colour getForegroundColor can read', () => {
    const line = lineOf(searchable('LINE', [bekasi]))
    expect(line?.colorCode).toBe('#118f4a')
    expect(() => getForegroundColor(line!.colorCode)).not.toThrow()
    expect(getForegroundColor(line!.colorCode)).toBe('LIGHT')
  })
})
