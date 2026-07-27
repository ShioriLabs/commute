import { describe, expect, it } from 'vitest'
import { buildFarePath, buildFareShareUrl } from './fare-url'

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
