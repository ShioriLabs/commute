import type { ResolvedSearchableHub, ResolvedSearchableLine, ResolvedSearchableStation, SearchableLine } from '@commute/schemas'
import { describe, expect, it } from 'vitest'
import { getForegroundColor } from 'utils/colors'

const bekasi: SearchableLine = {
  name: 'Lin Bekasi',
  lineCode: 'BK',
  colorCode: '#118f4a',
  operator: 'LRTJBDB'
}

/*
 * These assert the SHAPE the search sheet renders from, which is what the
 * crash was really about.
 *
 * Typing "si" matched "Lin Beka(si)" — the one LINE clearing the fuzzy
 * threshold — and the row read its colour off `body`, a field that held the
 * lines serving a station on one type and the line itself (array-wrapped) on
 * another. On a LINE that yielded undefined, so getForegroundColor called
 * `.startsWith` on it and unmounted the tree.
 *
 * `line` (singular) and `lines` (a list) now live on different variants, so
 * the mistake no longer type-checks. What follows pins the arity each variant
 * carries, since that is the invariant the fix rests on.
 */
describe('resolved searchable variants', () => {
  it('gives a LINE exactly one line, not a list', () => {
    const entry: ResolvedSearchableLine = {
      type: 'LINE',
      title: 'Lin Bekasi',
      to: '/lines/LRTJBDB/BK',
      keywords: ['lin bekasi', 'bekasi', 'bk'],
      operator: 'LRTJBDB',
      line: bekasi
    }

    // The exact read that used to throw.
    expect(() => getForegroundColor(entry.line.colorCode)).not.toThrow()
    expect(getForegroundColor(entry.line.colorCode)).toBe('LIGHT')
  })

  it('gives a STATION a list of lines and its own operator', () => {
    const entry: ResolvedSearchableStation = {
      type: 'STATION',
      title: 'Bekasi',
      to: '/stations/KCI/BKS',
      keywords: ['bekasi', 'bks'],
      operator: 'KCI',
      lines: [bekasi]
    }

    expect(entry.lines).toHaveLength(1)
    expect(entry.operator).toBe('KCI')
  })

  /*
   * A hub spans operators, so it carries no single `operator` — roundels read
   * it off each line instead. Previously the field was optional on one flat
   * shape, so a hub silently passed `undefined` and lost TJ roundel styling.
   */
  it('gives a HUB lines without an entry-level operator', () => {
    const entry: ResolvedSearchableHub = {
      type: 'HUB',
      title: 'Dukuh Atas',
      to: '/hubs/dukuh-atas',
      keywords: ['dukuh atas'],
      lines: [bekasi]
    }

    expect(entry.lines[0]?.operator).toBe('LRTJBDB')
    expect('operator' in entry).toBe(false)
  })
})
