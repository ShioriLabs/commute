import type { Line, Searchable } from '@commute/schemas'
import { describe, expect, it } from 'vitest'
import { filterBestTier, keywordScore, SCORE_THRESHOLD } from '../../../utils/fuzzy-match'
import { foldedSiblingIds, resolveStationId, toPickableStations, type PickableStation } from './pickable-station'

const line = (name: string): Line => ({ name, lineCode: name, colorCode: '#000000' })

function item(overrides: Partial<Searchable<Line[]>> = {}): Searchable<Line[]> {
  return {
    type: 'STATION',
    title: 'Ancol',
    to: '/stations/KCI/AC',
    keywords: ['ancol', 'ac'],
    operator: 'KCI',
    body: [line('Tanjung Priuk')],
    data: { 'station-id': 'KCI-AC' },
    ...overrides
  }
}

describe('toPickableStations', () => {
  it('maps a station entry onto what the picker reads', () => {
    const [station] = toPickableStations([item({ score: 42 })])
    expect(station).toEqual({
      id: 'KCI-AC',
      name: 'Ancol',
      operator: 'KCI',
      lines: [line('Tanjung Priuk')],
      score: 42,
      keywords: ['ancol', 'ac']
    })
  })

  // The index is shared with the search sheet, which also indexes hubs and
  // lines. Neither can be an endpoint of a fare.
  it('drops hubs and lines', () => {
    const items = [
      item(),
      item({ type: 'HUB', title: 'Dukuh Atas', data: { 'hub-id': 'dukuh-atas' } }),
      item({ type: 'LINE', title: 'Lin Cikarang', data: {} })
    ]
    expect(toPickableStations(items).map(s => s.name)).toEqual(['Ancol'])
  })

  it('drops an entry with no station id rather than emitting a broken one', () => {
    expect(toPickableStations([item({ data: {} })])).toEqual([])
    expect(toPickableStations([item({ data: undefined })])).toEqual([])
  })

  it('omits score when the server omitted it', () => {
    const [station] = toPickableStations([item()])
    expect(station).not.toHaveProperty('score')
  })
})

describe('foldedSiblingIds', () => {
  // The 15 directional TJ pairs. Both directions must be priceable, which is
  // the whole reason `station-ids` exists.
  it('returns the members folded away behind the primary', () => {
    const folded = item({
      title: 'Kali Grogol',
      data: { 'station-id': 'TJ-A01', 'station-ids': 'TJ-A01,TJ-B01' }
    })
    expect(foldedSiblingIds(folded)).toEqual(['TJ-B01'])
  })

  it('returns nothing for an ordinary unfolded station', () => {
    expect(foldedSiblingIds(item())).toEqual([])
  })
})

describe('resolveStationId', () => {
  const stations = toPickableStations([
    item({
      title: 'Ciliwung',
      data: { 'station-id': 'TJ-H00061S', 'station-ids': 'TJ-H00061S,TJ-H00062S' }
    }),
    item({ title: 'Ancol', data: { 'station-id': 'KCI-AC' } })
  ])

  it('resolves an ordinary station', () => {
    expect(resolveStationId(stations, 'KCI-AC')?.name).toBe('Ancol')
  })

  it('resolves the primary of a folded pair', () => {
    const found = resolveStationId(stations, 'TJ-H00061S')
    expect(found?.name).toBe('Ciliwung')
    expect(found?.id).toBe('TJ-H00061S')
  })

  /*
   * The one that matters. The two directions are separate boarding points on
   * opposite sides of a road, and 6 of the 15 pairs price differently: Ciliwung
   * to Ancol is Rp 6.500 from one side and Rp 11.500 from the other. Resolving
   * a shared link to the primary would quietly answer a different question and
   * show a confidently wrong fare.
   */
  it('keeps the requested id when it resolves via a folded sibling', () => {
    const found = resolveStationId(stations, 'TJ-H00062S')
    expect(found?.name).toBe('Ciliwung')
    expect(found?.id).toBe('TJ-H00062S')
  })

  it('returns null for an unknown id rather than guessing', () => {
    expect(resolveStationId(stations, 'TJ-NOPE')).toBeNull()
  })
})

/*
 * Search quality, pinned against the server-built keywords.
 *
 * The picker used to score `name`, `officialName` and `code` as three separate
 * fields. `keywords` flattens them into one list, so these assert the cases that
 * motivated the old per-field weighting still resolve — a flattening that
 * quietly lost "BNI City finds Sudirman Baru" would be a real regression.
 */
function bestScore(station: PickableStation, query: string): number {
  return Math.min(...station.keywords.map(keyword => keywordScore(keyword, query)))
}

describe('search quality over flattened keywords', () => {
  const stations = toPickableStations([
    item({
      title: 'BNI City',
      // The server lowercases and includes the operator's own spelling.
      keywords: ['bni city', 'sudirman baru', 'sud'],
      data: { 'station-id': 'KCI-SUD' }
    }),
    item({ title: 'Dukuh Atas BNI', keywords: ['dukuh atas bni', 'dukuh atas', 'dka'], data: { 'station-id': 'MRTJ-DKA' } }),
    item({ title: 'Ancol', keywords: ['ancol', 'ac'], data: { 'station-id': 'KCI-AC' } })
  ])

  const search = (query: string) => {
    const scored = stations
      .map(station => ({ station, score: bestScore(station, query) }))
      .filter(({ score }) => score < SCORE_THRESHOLD)
    return filterBestTier(scored, ({ score }) => score)
      .sort((a, b) => a.score - b.score)
      .map(({ station }) => station.name)
  }

  it('finds a station by the operator spelling the display name hides', () => {
    expect(search('sudirman baru')).toContain('BNI City')
  })

  it('finds a station by its code', () => {
    expect(search('dka')).toContain('Dukuh Atas BNI')
  })

  it('still tolerates a typo', () => {
    // The tuned case: threshold 5 is what lets "dukuj" reach "dukuh atas".
    expect(search('dukuj atas')).toContain('Dukuh Atas BNI')
  })

  it('does not match something unrelated', () => {
    expect(search('bandung')).toEqual([])
  })
})
