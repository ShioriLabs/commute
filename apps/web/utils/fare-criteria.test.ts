import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FARE_CRITERIA,
  FARE_CRITERIA_KEY,
  fareQueryParams,
  parseFareCriteria,
  readFareCriteria,
  writeFareCriteria,
  type FareCriteria
} from './fare-criteria'

// Same contract as search-mode: the fare page reads this on every open, so
// corrupt or throwing storage must degrade to a usable default rather than
// taking the page down.

function stubStorage(impl: Partial<Storage>) {
  vi.stubGlobal('localStorage', impl as Storage)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseFareCriteria', () => {
  it('returns the default when nothing is stored', () => {
    expect(parseFareCriteria(null)).toEqual(DEFAULT_FARE_CRITERIA)
    expect(parseFareCriteria('')).toEqual(DEFAULT_FARE_CRITERIA)
  })

  it('reads a fully-specified value back', () => {
    const stored = JSON.stringify({ paymentMethod: 'QRIS_TAP', fareTime: 'peak', operator: 'KCI' })
    expect(parseFareCriteria(stored)).toEqual({
      paymentMethod: 'QRIS_TAP',
      fareTime: 'peak',
      operator: 'KCI'
    })
  })

  /*
   * Per-field, not wholesale. A payment method retired from the constants must
   * not also throw away the rider's operator choice — that is the behaviour the
   * server's parseFareContext already has, and the two should not disagree.
   */
  it('falls back per field, keeping the values it can still use', () => {
    const stored = JSON.stringify({ paymentMethod: 'CASH', fareTime: 'peak', operator: 'KCI' })
    expect(parseFareCriteria(stored)).toEqual({
      paymentMethod: DEFAULT_FARE_CRITERIA.paymentMethod,
      fareTime: 'peak',
      operator: 'KCI'
    })
  })

  it('falls back on an unrecognised fare time', () => {
    const stored = JSON.stringify({ paymentMethod: 'QRIS_TAP', fareTime: 'midnight', operator: null })
    expect(parseFareCriteria(stored).fareTime).toBe('now')
    expect(parseFareCriteria(stored).paymentMethod).toBe('QRIS_TAP')
  })

  // JSON.parse succeeds on all of these, so a plain try/catch is not enough.
  it('survives malformed or wrongly-shaped JSON', () => {
    for (const raw of ['{', 'null', '[]', '"KCI"', '42', 'true']) {
      expect(parseFareCriteria(raw)).toEqual(DEFAULT_FARE_CRITERIA)
    }
  })

  it('treats a missing operator as every operator', () => {
    expect(parseFareCriteria(JSON.stringify({ paymentMethod: 'QRIS_TAP' })).operator).toBeNull()
  })
})

describe('fare criteria persistence', () => {
  it('round-trips through storage', () => {
    const store = new Map<string, string>()
    stubStorage({
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) }
    })

    const criteria: FareCriteria = { paymentMethod: 'QRIS_TAP', fareTime: 'offpeak', operator: 'TJ' }
    writeFareCriteria(criteria)
    expect(store.has(FARE_CRITERIA_KEY)).toBe(true)
    expect(readFareCriteria()).toEqual(criteria)
  })

  it('defaults when nothing is stored', () => {
    stubStorage({ getItem: () => null, setItem: () => {} })
    expect(readFareCriteria()).toEqual(DEFAULT_FARE_CRITERIA)
  })

  it('survives storage that throws', () => {
    stubStorage({
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') }
    })
    expect(readFareCriteria()).toEqual(DEFAULT_FARE_CRITERIA)
    expect(() => writeFareCriteria(DEFAULT_FARE_CRITERIA)).not.toThrow()
  })
})

describe('fareQueryParams', () => {
  /*
   * The load-bearing assertion. Omitting defaults is what keeps the SWR key for
   * an ordinary search byte-identical to the one shipped today — if this
   * regresses, every warm fare cache misses on deploy and every share URL grows
   * noise.
   */
  it('emits nothing at all for the defaults', () => {
    expect(fareQueryParams(DEFAULT_FARE_CRITERIA).toString()).toBe('')
  })

  it('emits a non-default payment method', () => {
    const params = fareQueryParams({ ...DEFAULT_FARE_CRITERIA, paymentMethod: 'QRIS_TAP' })
    expect(params.get('paymentMethod')).toBe('QRIS_TAP')
  })

  // The server reduces `at` to a bucket, so any instant inside the window works
  // — but it must be a weekday, since fareTimeBucket calls every weekend
  // off-peak and a Saturday "peak" would silently price as off-peak.
  it('emits a weekday peak instant for the peak bucket', () => {
    const at = fareQueryParams({ ...DEFAULT_FARE_CRITERIA, fareTime: 'peak' }).get('at')
    expect(at).toBeTruthy()
    const date = new Date(at!)
    expect(date.getUTCDay()).toBeGreaterThanOrEqual(1)
    expect(date.getUTCDay()).toBeLessThanOrEqual(5)
  })

  it('emits a different instant for off-peak than for peak', () => {
    const peak = fareQueryParams({ ...DEFAULT_FARE_CRITERIA, fareTime: 'peak' }).get('at')
    const offpeak = fareQueryParams({ ...DEFAULT_FARE_CRITERIA, fareTime: 'offpeak' }).get('at')
    expect(offpeak).toBeTruthy()
    expect(offpeak).not.toBe(peak)
  })

  it('omits `at` entirely when following the clock', () => {
    expect(fareQueryParams({ ...DEFAULT_FARE_CRITERIA, fareTime: 'now' }).has('at')).toBe(false)
  })

  // Operator scopes the picker, not the pricing. Sending it would imply the
  // router filters by operator, which it does not.
  it('never sends the operator to the fare endpoint', () => {
    const params = fareQueryParams({ paymentMethod: 'QRIS_TAP', fareTime: 'peak', operator: 'KCI' })
    expect(params.has('operator')).toBe(false)
    expect([...params.keys()].sort()).toEqual(['at', 'paymentMethod'])
  })
})
