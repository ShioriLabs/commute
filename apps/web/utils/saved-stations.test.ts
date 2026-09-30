import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSavedStations, toggleSavedStation } from './saved-stations'

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
