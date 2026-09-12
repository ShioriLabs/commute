import { describe, expect, it } from 'vitest'
import { fareApiUrl, tripApiUrl } from './fare-api'
import { DEFAULT_FARE_CRITERIA, fareQueryParams, type FareCriteria } from './fare-criteria'

/*
 * fareApiUrl is the single fare SWR key, shared by four surfaces: the /fare
 * route, the search sheet's route mode, the map's route overlay, and the map's
 * fare sheet. SWR dedupes across them only when the key string agrees exactly,
 * so a drift here does not fail loudly — it shows the rider two different prices
 * for one route, in the chip and in the sheet, and costs a second request.
 */

const criteriaWith = (patch: Partial<FareCriteria>): FareCriteria => ({
  ...DEFAULT_FARE_CRITERIA,
  ...patch
})

describe('fareApiUrl', () => {
  it('omits the query string entirely at the default criteria', () => {
    // The warm-cache invariant: this must stay byte-identical to the key the app
    // used before criteria existed, or every cached fare misses on deploy.
    const withDefaults = fareApiUrl('KCI-SUD', 'MRTJ-BLA', DEFAULT_FARE_CRITERIA)
    const withNoCriteria = fareApiUrl('KCI-SUD', 'MRTJ-BLA')
    expect(withDefaults).toBe(withNoCriteria)
    expect(withDefaults).not.toContain('?')
    expect(withDefaults).toContain('/fares/KCI-SUD/MRTJ-BLA')
  })

  it('appends a non-default payment method', () => {
    const url = fareApiUrl('KCI-SUD', 'MRTJ-BLA', criteriaWith({ paymentMethod: 'QRIS_TAP' }))
    expect(url).toContain('paymentMethod=QRIS_TAP')
  })

  it('appends a chosen departure as `at`, and keys distinctly per slot', () => {
    // Far enough ahead to stay in the future whenever this suite runs: a past
    // instant is reset to 'now' by design, which would make this pass vacuously.
    const early = fareApiUrl('KCI-SUD', 'MRTJ-BLA', criteriaWith({ fareTime: '2099-01-05T08:00:00+07:00' }))
    const later = fareApiUrl('KCI-SUD', 'MRTJ-BLA', criteriaWith({ fareTime: '2099-01-05T08:40:00+07:00' }))
    expect(early).toContain('at=')
    expect(later).toContain('at=')
    expect(early).not.toBe(later)
  })

  it('leaves the operator criterion out of the key', () => {
    // It decides which stations the picker offers, not how a pair is priced —
    // including it would split the cache on a purely local UI filter.
    const filtered = fareApiUrl('KCI-SUD', 'MRTJ-BLA', criteriaWith({ operator: 'KCI' }))
    expect(filtered).toBe(fareApiUrl('KCI-SUD', 'MRTJ-BLA', DEFAULT_FARE_CRITERIA))
  })

  it('returns null when an endpoint is missing or the pair is degenerate', () => {
    expect(fareApiUrl(null, 'MRTJ-BLA')).toBeNull()
    expect(fareApiUrl('KCI-SUD', null)).toBeNull()
    expect(fareApiUrl(undefined, undefined)).toBeNull()
    expect(fareApiUrl('', 'MRTJ-BLA')).toBeNull()
    // The API would answer SAME_STATION anyway.
    expect(fareApiUrl('KCI-SUD', 'KCI-SUD')).toBeNull()
  })

  it('matches the URL shape use-fare-query used to build inline', () => {
    // Pins the contract the two callers converged on, so a future edit to either
    // side cannot silently reintroduce the split key.
    const criteria = criteriaWith({ paymentMethod: 'QRIS_TAP', fareTime: '2099-01-05T08:00:00+07:00' })
    const query = fareQueryParams(criteria).toString()
    const expected = new URL(
      `/fares/KCI-SUD/MRTJ-BLA${query ? `?${query}` : ''}`,
      import.meta.env.VITE_API_BASE_URL
    ).href
    expect(fareApiUrl('KCI-SUD', 'MRTJ-BLA', criteria)).toBe(expected)
  })
})

/*
 * `tripApiUrl` is the app's only fare key now, so the warm-cache invariant that
 * mattered on `fareApiUrl` has to hold here instead: a default search must
 * produce a byte-identical string forever, or every rider misses SWR, IndexedDB
 * and the service worker at once on the deploy that changes it.
 *
 * `fareApiUrl` is still exercised above because the endpoint it builds is still
 * live for the OG worker and anyone holding a shared link — the app just does
 * not render it any more.
 */
describe('tripApiUrl', () => {
  it('keys the same pair differently from the fare endpoint', () => {
    const fare = fareApiUrl('KCI-SUD', 'MRTJ-BLA', DEFAULT_FARE_CRITERIA)
    const trip = tripApiUrl('KCI-SUD', 'MRTJ-BLA', DEFAULT_FARE_CRITERIA)
    expect(trip).not.toBe(fare)
    expect(trip).toContain('/_internal/trips/KCI-SUD/MRTJ-BLA')
  })

  it('keeps the default-criteria silence on the trip endpoint too', () => {
    expect(tripApiUrl('KCI-SUD', 'MRTJ-BLA', DEFAULT_FARE_CRITERIA)).not.toContain('?')
  })

  // The one param that reaches the router and changes the answer, so it must
  // reach the key too — see fareQueryParams.
  it('carries modes when the rider asked for rail only', () => {
    const rail = tripApiUrl('KCI-SUD', 'MRTJ-BLA', { ...DEFAULT_FARE_CRITERIA, modes: 'rail' })
    expect(rail).toContain('modes=rail')
    expect(rail).not.toBe(tripApiUrl('KCI-SUD', 'MRTJ-BLA', DEFAULT_FARE_CRITERIA))
  })
})
