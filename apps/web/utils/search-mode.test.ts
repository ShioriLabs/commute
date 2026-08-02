import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SEARCH_MODE, readSearchMode, SEARCH_MODE_KEY, writeSearchMode } from './search-mode'

// The sheet reads this on every open, so a throwing or corrupted storage must
// degrade to a usable default rather than breaking the sheet.

function stubStorage(impl: Partial<Storage>) {
  vi.stubGlobal('localStorage', impl as Storage)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('search mode persistence', () => {
  it('round-trips both modes', () => {
    const store = new Map<string, string>()
    stubStorage({
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) }
    })

    writeSearchMode('FARE')
    expect(store.get(SEARCH_MODE_KEY)).toBe('FARE')
    expect(readSearchMode()).toBe('FARE')

    writeSearchMode('STATION')
    expect(readSearchMode()).toBe('STATION')
  })

  it('defaults to station mode when nothing is stored', () => {
    stubStorage({ getItem: () => null, setItem: () => {} })
    expect(readSearchMode()).toBe(DEFAULT_SEARCH_MODE)
    expect(readSearchMode()).toBe('STATION')
  })

  it('falls back to the default on an unrecognised stored value', () => {
    // A stale or hand-edited value must not put the sheet in an unknown mode.
    stubStorage({ getItem: () => 'PLANNER', setItem: () => {} })
    expect(readSearchMode()).toBe('STATION')
  })

  it('survives storage that throws', () => {
    // Partitioned or locked-down contexts throw on access.
    stubStorage({
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') }
    })
    expect(readSearchMode()).toBe('STATION')
    expect(() => writeSearchMode('FARE')).not.toThrow()
  })
})
