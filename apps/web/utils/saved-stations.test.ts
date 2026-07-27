import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseStationId, readSavedStations, SAVED_STATIONS_KEY, writeSavedStations } from './saved-stations'

// Minimal localStorage stand-in; vitest runs these in node, not jsdom.
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => { store.clear() }
})

beforeEach(() => store.clear())

describe('readSavedStations', () => {
  it('returns the stored order untouched', () => {
    store.set(SAVED_STATIONS_KEY, JSON.stringify(['KCI-THB', 'KCI-MRI']))
    // Array order is display order, so it must not be sorted.
    expect(readSavedStations()).toEqual(['KCI-THB', 'KCI-MRI'])
  })

  it('seeds an empty list when the key is missing', () => {
    expect(readSavedStations()).toEqual([])
    expect(store.get(SAVED_STATIONS_KEY)).toBe('[]')
  })

  it('heals invalid JSON rather than throwing', () => {
    store.set(SAVED_STATIONS_KEY, '{not json')
    expect(readSavedStations()).toEqual([])
    expect(store.get(SAVED_STATIONS_KEY)).toBe('[]')
  })

  it('heals a valid-JSON non-array value', () => {
    store.set(SAVED_STATIONS_KEY, '{"KCI-MRI":true}')
    expect(readSavedStations()).toEqual([])
    expect(store.get(SAVED_STATIONS_KEY)).toBe('[]')
  })
})

describe('writeSavedStations', () => {
  it('round-trips through read', () => {
    writeSavedStations(['KCI-MRI', 'MRTJ-BLM'])
    expect(readSavedStations()).toEqual(['KCI-MRI', 'MRTJ-BLM'])
  })
})

describe('parseStationId', () => {
  it('splits operator from code', () => {
    expect(parseStationId('KCI-MRI')).toEqual({ operator: 'KCI', code: 'MRI' })
  })

  // TransJakarta halte codes contain hyphens of their own, so only the first
  // one separates the operator — split('-') would truncate the code.
  it('keeps hyphens inside the station code', () => {
    expect(parseStationId('TJ-H00037C-b')).toEqual({ operator: 'TJ', code: 'H00037C-b' })
  })

  it('rejects ids with no separator or an empty half', () => {
    expect(parseStationId('KCIMRI')).toBeNull()
    expect(parseStationId('-MRI')).toBeNull()
    expect(parseStationId('KCI-')).toBeNull()
  })
})
