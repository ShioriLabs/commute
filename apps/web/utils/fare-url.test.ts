import { describe, expect, it } from 'vitest'
import { buildFarePath, buildFareShareUrl } from './fare-url'
import { DEFAULT_FARE_CRITERIA } from './fare-criteria'

// Only /fare is SEO-decorated (functions/_middleware.ts:322) and rendered by the
// OG image worker. The search sheet shows the same fare UI under /search, so a
// share URL read from the address bar there would preview as a bare link. These
// tests pin the constructed-URL contract that prevents that.

describe('buildFareShareUrl', () => {
  it('always targets /fare regardless of the current page', () => {
    expect(buildFareShareUrl('KCI-MRI', 'MRTJ-DKA', 'https://commute.shiorilabs.id'))
      .toBe('https://commute.shiorilabs.id/fare?from=KCI-MRI&to=MRTJ-DKA')
  })

  it('is unaffected by the surface it is called from', () => {
    // The same pair must produce the same URL whether the user is on /fare, in
    // the search sheet at /search, or on the homepage behind a faked URL.
    const pair = ['KCI-MRI', 'MRTJ-DKA'] as const
    const fromFare = buildFareShareUrl(...pair, 'https://commute.shiorilabs.id')
    const fromSearch = buildFareShareUrl(...pair, 'https://commute.shiorilabs.id')
    expect(fromSearch).toBe(fromFare)
    expect(fromSearch).toContain('/fare?')
    expect(fromSearch).not.toContain('/search')
  })

  it('returns null until both ends are chosen', () => {
    const origin = 'https://commute.shiorilabs.id'
    expect(buildFareShareUrl(null, 'MRTJ-DKA', origin)).toBeNull()
    expect(buildFareShareUrl('KCI-MRI', null, origin)).toBeNull()
    expect(buildFareShareUrl(null, null, origin)).toBeNull()
    expect(buildFareShareUrl(undefined, undefined, origin)).toBeNull()
    expect(buildFareShareUrl('', '', origin)).toBeNull()
  })

  it('percent-encodes station ids', () => {
    const url = buildFareShareUrl('KCI-A B', 'KCI-C&D', 'https://commute.shiorilabs.id')
    expect(url).toBe('https://commute.shiorilabs.id/fare?from=KCI-A+B&to=KCI-C%26D')
  })

  it('honours the origin it is given', () => {
    expect(buildFareShareUrl('KCI-MRI', 'KCI-SUD', 'http://localhost:5174'))
      .toBe('http://localhost:5174/fare?from=KCI-MRI&to=KCI-SUD')
  })
})

describe('buildFarePath', () => {
  it('returns a root-relative path for in-app navigation', () => {
    // Must be relative and must not carry an origin: react-router's <Link>
    // treats an absolute URL as an external destination and falls back to a
    // full page load, which in SPA mode means the hydration spinner.
    const path = buildFarePath('KCI-MRI', 'MRTJ-DKA')
    expect(path).toBe('/fare?from=KCI-MRI&to=MRTJ-DKA')
    expect(path?.startsWith('/')).toBe(true)
    expect(path).not.toContain('://')
  })

  it('returns null until both ends are chosen', () => {
    expect(buildFarePath(null, 'MRTJ-DKA')).toBeNull()
    expect(buildFarePath('KCI-MRI', undefined)).toBeNull()
    expect(buildFarePath('', '')).toBeNull()
  })

  it('agrees with the share URL on the same pair', () => {
    const path = buildFarePath('KCI-MRI', 'MRTJ-DKA')
    const url = buildFareShareUrl('KCI-MRI', 'MRTJ-DKA', 'https://commute.shiorilabs.id')
    expect(url).toBe(`https://commute.shiorilabs.id${path}`)
  })
})

describe('fare URLs with criteria', () => {
  /*
   * The compatibility promise. functions/_middleware.ts and the OG image worker
   * both key on the `?from=&to=` shape, so a default search must produce
   * byte-identical output to what shipped before criteria existed.
   */
  it('is unchanged for default criteria', () => {
    const withDefaults = buildFarePath('KCI-SUD', 'LRTJBDB-DKA', DEFAULT_FARE_CRITERIA)
    expect(withDefaults).toBe(buildFarePath('KCI-SUD', 'LRTJBDB-DKA'))
    expect(withDefaults).toBe('/fare?from=KCI-SUD&to=LRTJBDB-DKA')
  })

  it('carries a non-default payment method so a share reproduces the number', () => {
    const path = buildFarePath('KCI-SUD', 'LRTJBDB-DKA', {
      ...DEFAULT_FARE_CRITERIA,
      paymentMethod: 'QRIS_TAP'
    })
    expect(path).toContain('paymentMethod=QRIS_TAP')
  })

  it('never carries the operator filter, which scopes the picker not the price', () => {
    const path = buildFarePath('KCI-SUD', 'LRTJBDB-DKA', {
      ...DEFAULT_FARE_CRITERIA,
      operator: 'KCI'
    })
    expect(path).toBe('/fare?from=KCI-SUD&to=LRTJBDB-DKA')
  })

  it('keeps station ids percent-encoded alongside criteria', () => {
    const url = buildFareShareUrl('TJ-H00061S', 'KCI-AC', 'https://commute.shiorilabs.id', {
      ...DEFAULT_FARE_CRITERIA,
      paymentMethod: 'QRIS_TAP'
    })
    expect(url).toBe('https://commute.shiorilabs.id/fare?from=TJ-H00061S&to=KCI-AC&paymentMethod=QRIS_TAP')
  })
})
