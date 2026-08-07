import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FARE_CRITERIA,
  FARE_CRITERIA_KEY,
  fareQueryParams,
  parseFareCriteria,
  readFareCriteria,
  readCriteriaFromUrl,
  criteriaToPersist,
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

// The inbound half of the URL contract. Asymmetric with fareQueryParams on
// purpose: `operator` is read from a link but never written back to one.
describe('readCriteriaFromUrl', () => {
  const read = (search: string) => readCriteriaFromUrl(new URLSearchParams(search))

  it('returns nothing for a bare URL, so storage keeps its say', () => {
    expect(read('')).toBeUndefined()
    expect(read('from=KCI-DU&to=KCI-SUD')).toBeUndefined()
  })

  it('scopes the picker from an operator-specific entry point', () => {
    expect(read('operator=TJ')).toEqual({ operator: 'TJ' })
  })

  // A bogus code would leave the picker with no stations and no obvious way
  // back, so it degrades to unscoped rather than to an empty list.
  it('ignores an operator that is not a real one', () => {
    expect(read('operator=NOPE')).toBeUndefined()
    expect(read('operator=')).toBeUndefined()
  })

  // NUL is an internal placeholder that never names real stations; scoping to
  // it empties the picker just as surely as a typo does.
  it('ignores the internal placeholder operator', () => {
    expect(read('operator=NUL')).toBeUndefined()
  })

  it('reads a payment method, which is the shared-link case', () => {
    expect(read('paymentMethod=QRIS_TAP')).toEqual({ paymentMethod: 'QRIS_TAP' })
    expect(read('paymentMethod=NOPE')).toBeUndefined()
  })

  // Both at once: FDTJ's page is operator-scoped, and the link may still carry
  // a sender's payment method.
  it('reads both independently', () => {
    expect(read('operator=TJ&paymentMethod=QRIS_TAP')).toEqual({
      operator: 'TJ',
      paymentMethod: 'QRIS_TAP'
    })
  })

  // Partial, not whole-object: an unusable operator must not also discard a
  // perfectly good payment method. Same per-field rule as parseFareCriteria.
  it('keeps the good field when the other is junk', () => {
    expect(read('operator=NOPE&paymentMethod=QRIS_TAP')).toEqual({ paymentMethod: 'QRIS_TAP' })
    expect(read('operator=TJ&paymentMethod=NOPE')).toEqual({ operator: 'TJ' })
  })
})

// Landing on an operator-scoped link must not rewrite the rider's own stored
// filter — the scope belongs to that visit, not to them.
describe('criteriaToPersist', () => {
  const scoped: FareCriteria = { paymentMethod: 'QRIS_TAP', fareTime: 'now', operator: 'TJ' }

  it('persists everything when no operator came from the URL', () => {
    expect(criteriaToPersist(scoped, undefined)).toEqual(scoped)
    expect(criteriaToPersist(scoped, { paymentMethod: 'QRIS_TAP' })).toEqual(scoped)
  })

  // The FDTJ case: the rider tweaked payment on an ?operator=TJ page, so the
  // payment method is theirs to keep but the TJ scope is not.
  it('drops an operator the URL supplied, keeping the rest', () => {
    expect(criteriaToPersist(scoped, { operator: 'TJ' })).toEqual({
      paymentMethod: 'QRIS_TAP',
      fareTime: 'now',
      operator: null
    })
  })

  /*
   * The rider overrode the URL's scope by hand. That is their own choice and
   * persists like any other — only the value they inherited stays session-only.
   */
  it('persists an operator the rider picked over the URL one', () => {
    const overridden: FareCriteria = { ...scoped, operator: 'KCI' }
    expect(criteriaToPersist(overridden, { operator: 'TJ' })).toEqual(overridden)
  })

  // Explicitly clearing to "Semua" is also the rider's choice, and must not be
  // confused with never having chosen.
  it('persists an explicit clear made against a URL scope', () => {
    const cleared: FareCriteria = { ...scoped, operator: null }
    expect(criteriaToPersist(cleared, { operator: 'TJ' })).toEqual(cleared)
  })
})
