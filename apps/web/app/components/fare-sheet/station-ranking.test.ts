import { describe, expect, it } from 'vitest'
import type { PickableStation } from './pickable-station'
import {
  NO_QUERY_ROWS,
  quickPickStations,
  RECENT_PICKS_MAX,
  rankStations,
  topByPopularity
} from './station-ranking'

/*
 * The ranking behind both fare pickers — the phone's full-screen dialog and the
 * desktop rail's inline list. Tested here rather than through either surface
 * because the suite is node-only, and because the two must not be able to
 * disagree about what "the best match" means.
 */

const station = (
  id: string,
  name: string,
  keywords: string[],
  score?: number
): PickableStation => ({
  id,
  name,
  operator: 'KCI',
  lines: [],
  sortedLines: [],
  keywords,
  score
} as unknown as PickableStation)

const stations: PickableStation[] = [
  station('KCI-MRI', 'Manggarai', ['manggarai', 'mri'], 95),
  station('MRTJ-BHI', 'Bundaran HI', ['bundaran hi', 'bhi'], 90),
  station('KCI-SUDB', 'BNI City', ['bni city', 'sudirman baru', 'sudb'], 70),
  station('KCI-THB', 'Tanah Abang', ['tanah abang', 'thb'], 60),
  station('KCI-JNG', 'Jatinegara', ['jatinegara', 'jng'], 40)
]

describe('rankStations', () => {
  it('falls back to the popular head for a query under two characters', () => {
    // One letter matches most of the network and orders it by popularity alone,
    // which is the no-query list wearing a hat.
    expect(rankStations(stations, 'm').map(s => s.id))
      .toEqual(topByPopularity(stations, NO_QUERY_ROWS).map(s => s.id))
    expect(rankStations(stations, '')[0].id).toBe('KCI-MRI')
  })

  it('finds a station by its name', () => {
    expect(rankStations(stations, 'manggarai')[0].id).toBe('KCI-MRI')
  })

  it('finds a station by an alias the operator uses', () => {
    // "sudirman baru" has to keep finding BNI City — only the operator's own
    // spelling carries that, which is why keywords exist.
    expect(rankStations(stations, 'sudirman baru')[0].id).toBe('KCI-SUDB')
  })

  it('is case-insensitive', () => {
    expect(rankStations(stations, 'MANGGARAI')[0].id).toBe('KCI-MRI')
  })

  it('tolerates a typo', () => {
    // The search-lag fix widened the threshold precisely so "dukuj" reaches
    // Dukuh Atas; the same tolerance has to survive the extraction.
    expect(rankStations(stations, 'manggarei')[0].id).toBe('KCI-MRI')
  })

  it('drops stations nothing like the query', () => {
    expect(rankStations(stations, 'jatinegara').map(s => s.id)).not.toContain('MRTJ-BHI')
  })

  it('returns nothing for a query that matches no station', () => {
    expect(rankStations(stations, 'zzzzzzzz')).toEqual([])
  })
})

describe('topByPopularity', () => {
  it('orders by score, most popular first', () => {
    expect(topByPopularity(stations, 3).map(s => s.id))
      .toEqual(['KCI-MRI', 'MRTJ-BHI', 'KCI-SUDB'])
  })

  it('returns nothing for a non-positive limit', () => {
    expect(topByPopularity(stations, 0)).toEqual([])
  })

  it('breaks score ties by name', () => {
    const tied = [station('B', 'Bravo', ['bravo'], 50), station('A', 'Alpha', ['alpha'], 50)]
    expect(topByPopularity(tied, 2).map(s => s.name)).toEqual(['Alpha', 'Bravo'])
  })

  it('treats a missing score as zero rather than dropping the station', () => {
    const withUnscored = [...stations, station('KCI-NEW', 'Baru', ['baru'])]
    expect(topByPopularity(withUnscored, 99)).toHaveLength(withUnscored.length)
  })
})

describe('quickPickStations', () => {
  it('puts recent picks first', () => {
    expect(quickPickStations(stations, ['KCI-JNG'])[0].id).toBe('KCI-JNG')
  })

  it('pads with popular stations when recents are short', () => {
    const picks = quickPickStations(stations, ['KCI-JNG'])
    expect(picks).toHaveLength(RECENT_PICKS_MAX)
    expect(picks.slice(1).map(s => s.id)).toEqual(['KCI-MRI', 'MRTJ-BHI', 'KCI-SUDB'])
  })

  it('never repeats a station that is both recent and popular', () => {
    const picks = quickPickStations(stations, ['KCI-MRI'])
    expect(new Set(picks.map(s => s.id)).size).toBe(picks.length)
  })

  it('ignores a recent id that is no longer pickable', () => {
    // Recents live in localStorage and outlive the station list they were
    // written against — a retired id must not blank out a row.
    const picks = quickPickStations(stations, ['KCI-GONE', 'KCI-JNG'])
    expect(picks.map(s => s.id)).not.toContain('KCI-GONE')
    expect(picks[0].id).toBe('KCI-JNG')
  })

  it('falls back to pure popularity with no recents', () => {
    expect(quickPickStations(stations, []).map(s => s.id))
      .toEqual(['KCI-MRI', 'MRTJ-BHI', 'KCI-SUDB', 'KCI-THB'])
  })

  it('caps at RECENT_PICKS_MAX even with many recents', () => {
    expect(quickPickStations(stations, stations.map(s => s.id))).toHaveLength(RECENT_PICKS_MAX)
  })
})
