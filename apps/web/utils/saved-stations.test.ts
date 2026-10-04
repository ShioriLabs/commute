import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { entryKey, isRouteSaved, moveEntry, readSavedEntries, readSavedStations, toggleSavedRoute, toggleSavedStation } from './saved-stations'

// The station page and the search sheet both star through these, so the stored
// shape has to survive a round trip and a corrupted value must read as empty.

let store: Map<string, string>

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) }
  } as Partial<Storage> as Storage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('saved stations', () => {
  it('reads empty when nothing is stored', () => {
    expect(readSavedStations()).toEqual([])
  })

  it('toggles an id on and off, keeping order', () => {
    expect(toggleSavedStation('KCI-MRI')).toEqual(['KCI-MRI'])
    expect(toggleSavedStation('MRTJ-DKA')).toEqual(['KCI-MRI', 'MRTJ-DKA'])
    expect(toggleSavedStation('KCI-MRI')).toEqual(['MRTJ-DKA'])
    expect(readSavedStations()).toEqual(['MRTJ-DKA'])
  })

  it('reads corrupted or non-array values as empty', () => {
    store.set('saved-stations', '{not json')
    expect(readSavedStations()).toEqual([])
    store.set('saved-stations', '{"a":1}')
    expect(readSavedStations()).toEqual([])
    store.set('saved-stations', '["KCI-MRI", 3, null]')
    expect(readSavedStations()).toEqual(['KCI-MRI'])
  })
})

describe('saved routes', () => {
  it('toggles a directional pair on and off', () => {
    expect(toggleSavedRoute('KCI-BOO', 'KCI-SUD')).toBe(true)
    expect(isRouteSaved('KCI-BOO', 'KCI-SUD')).toBe(true)
    expect(isRouteSaved('KCI-SUD', 'KCI-BOO')).toBe(false)
    expect(toggleSavedRoute('KCI-BOO', 'KCI-SUD')).toBe(false)
    expect(readSavedEntries()).toEqual([])
  })

  it('keeps stations and pairs in one list, in saved order', () => {
    toggleSavedStation('KCI-MRI')
    toggleSavedRoute('KCI-BOO', 'KCI-SUD')
    toggleSavedStation('MRTJ-DKA')
    expect(readSavedEntries().map(entryKey)).toEqual(['KCI-MRI', 'ROUTE:KCI-BOO>KCI-SUD', 'MRTJ-DKA'])
    expect(readSavedStations()).toEqual(['KCI-MRI', 'MRTJ-DKA'])
  })

  it('does not drop pairs when a station is toggled', () => {
    toggleSavedRoute('KCI-BOO', 'KCI-SUD')
    expect(toggleSavedStation('KCI-MRI')).toEqual(['KCI-MRI'])
    expect(toggleSavedStation('KCI-MRI')).toEqual([])
    expect(isRouteSaved('KCI-BOO', 'KCI-SUD')).toBe(true)
  })

  it('reads a legacy station-only list unchanged and drops malformed pairs', () => {
    store.set('saved-stations', '["KCI-MRI","MRTJ-DKA"]')
    expect(readSavedEntries()).toEqual(['KCI-MRI', 'MRTJ-DKA'])
    store.set('saved-stations', '[{"type":"ROUTE","from":"A"},{"type":"ROUTE","from":"A","to":"B"},{"type":"X"}]')
    expect(readSavedEntries()).toEqual([{ type: 'ROUTE', from: 'A', to: 'B' }])
  })
})

describe('moveEntry', () => {
  it('moves an entry up and down by one', () => {
    expect(moveEntry(['a', 'b', 'c'], 1, 0)).toEqual(['b', 'a', 'c'])
    expect(moveEntry(['a', 'b', 'c'], 1, 2)).toEqual(['a', 'c', 'b'])
  })

  it('leaves the list unchanged past either end', () => {
    expect(moveEntry(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveEntry(['a', 'b'], 1, 2)).toEqual(['a', 'b'])
  })

  it('does not mutate the input', () => {
    const list = ['a', 'b']
    moveEntry(list, 0, 1)
    expect(list).toEqual(['a', 'b'])
  })
})
