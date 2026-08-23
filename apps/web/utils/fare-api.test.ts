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

  it('appends a fare-time bucket as `at`', () => {
    const peak = fareApiUrl('KCI-SUD', 'MRTJ-BLA', criteriaWith({ fareTime: 'peak' }))
    const offpeak = fareApiUrl('KCI-SUD', 'MRTJ-BLA', criteriaWith({ fareTime: 'offpeak' }))
    expect(peak).toContain('at=')
    expect(offpeak).toContain('at=')
    expect(peak).not.toBe(offpeak)
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
    const criteria = criteriaWith({ paymentMethod: 'QRIS_TAP', fareTime: 'peak' })
    const query = fareQueryParams(criteria).toString()
    const expected = new URL(
      `/fares/KCI-SUD/MRTJ-BLA${query ? `?${query}` : ''}`,
      import.meta.env.VITE_API_BASE_URL
    ).href
    expect(fareApiUrl('KCI-SUD', 'MRTJ-BLA', criteria)).toBe(expected)
  })
})

/*
 * The router toggle means both endpoints are warm for the same pair at the same
 * time — flipping it does not evict what the other one cached. These keys are
 * what keep the two bodies apart in SWR, in IndexedDB and in the service
 * worker, all three of which key on this exact string.
 */
describe('tripApiUrl beside fareApiUrl', () => {
  it('keys the same pair differently per endpoint', () => {
    const fare = fareApiUrl('KCI-SUD', 'MRTJ-BLA', DEFAULT_FARE_CRITERIA)
    const trip = tripApiUrl('KCI-SUD', 'MRTJ-BLA', DEFAULT_FARE_CRITERIA)
    expect(trip).not.toBe(fare)
    expect(trip).toContain('/_internal/trips/KCI-SUD/MRTJ-BLA')
  })

  it('carries no router param on either endpoint', () => {
    // The router picks the path; it is never a query param on the API call, or
    // it would split the cache on a value the server does not read.
    expect(fareApiUrl('KCI-SUD', 'MRTJ-BLA', DEFAULT_FARE_CRITERIA)).not.toContain('router')
    expect(tripApiUrl('KCI-SUD', 'MRTJ-BLA', DEFAULT_FARE_CRITERIA)).not.toContain('router')
  })

  it('keeps the default-criteria silence on the trip endpoint too', () => {
    expect(tripApiUrl('KCI-SUD', 'MRTJ-BLA', DEFAULT_FARE_CRITERIA)).not.toContain('?')
  })
})
