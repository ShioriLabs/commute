import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_LINE_ISOLATE,
  LINE_ISOLATE_KEY,
  parseLineIsolate,
  readLineIsolate,
  writeLineIsolate
} from './line-isolate'

afterEach(() => {
  vi.unstubAllGlobals()
})

const fakeStorage = (initial: Record<string, string> = {}) => {
  const store = { ...initial }
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    read: () => store
  }
}

describe('parseLineIsolate', () => {
  it('accepts only "on"', () => {
    expect(parseLineIsolate('on')).toBe('on')
  })

  it('defaults anything else to off, including a stale value', () => {
    expect(parseLineIsolate(null)).toBe(DEFAULT_LINE_ISOLATE)
    expect(parseLineIsolate('true')).toBe('off')
    expect(parseLineIsolate('')).toBe('off')
  })
})

describe('readLineIsolate', () => {
  it('reads the stored choice', () => {
    vi.stubGlobal('localStorage', fakeStorage({ [LINE_ISOLATE_KEY]: 'on' }))
    expect(readLineIsolate()).toBe('on')
  })

  it('falls back to off when storage throws', () => {
    // The normal case inside the TransportForJakarta iframe, where Safari and
    // Firefox partition or deny storage outright.
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('denied') },
      setItem() { throw new Error('denied') }
    })
    expect(readLineIsolate()).toBe('off')
  })
})

describe('writeLineIsolate', () => {
  it('persists the choice', () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    writeLineIsolate('on')
    expect(storage.read()[LINE_ISOLATE_KEY]).toBe('on')
  })

  it('swallows a storage failure rather than breaking the toggle', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem() { throw new Error('denied') }
    })
    expect(() => writeLineIsolate('on')).not.toThrow()
  })
})
