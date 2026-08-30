import { describe, expect, it } from 'vitest'
import { getRetiredStation, RETIRED_STATIONS } from './retired-stations'
import { UNSERVED_STATIONS } from './unserved-stations'

describe('getRetiredStation', () => {
  it('finds Karet, which KAI retired in September 2026', () => {
    const karet = getRetiredStation('KCI', 'KAT')
    expect(karet).not.toBeNull()
    expect(karet?.redirect?.to).toBe('/stations/KCI/SUDB')
  })

  it('folds case, since route params are not normalised', () => {
    // A lowercase deep link (/stations/kci/kat) must not silently drop the
    // notice and leave the page claiming the station is in service.
    expect(getRetiredStation('kci', 'kat')).toEqual(getRetiredStation('KCI', 'KAT'))
  })

  it('returns null for a station still in service', () => {
    expect(getRetiredStation('KCI', 'SUDB')).toBeNull()
  })

  it('never overlaps UNSERVED_STATIONS', () => {
    // The two lists mean opposite things to the page: an unserved station
    // suppresses every fetch and replaces the page with an empty state, while a
    // retired one keeps the page and adds a banner. A station in both would get
    // the empty state and the banner would never render.
    for (const id of Object.keys(RETIRED_STATIONS)) {
      expect(UNSERVED_STATIONS[id], `${id} is in both lists`).toBeUndefined()
    }
  })

  it('points every redirect at a station page, not a bare code', () => {
    for (const [id, entry] of Object.entries(RETIRED_STATIONS)) {
      if (!entry.redirect) continue
      expect(entry.redirect.to, `${id} redirect`).toMatch(/^\/stations\/[A-Z]+\/[A-Z0-9]+$/)
    }
  })
})
