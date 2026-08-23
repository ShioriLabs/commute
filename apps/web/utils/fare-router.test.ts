import { describe, expect, it } from 'vitest'
import { DEFAULT_FARE_ROUTER, parseFareRouter } from './fare-router'

/*
 * The router choice changes which endpoint answers, so it reaches further than
 * the criteria beside it: into the SWR key, the service worker's cache entry
 * and Cloudflare's edge. It lives in storage and has no URL form, so what is
 * left to pin here is that an unrecognised stored value can never select an
 * endpoint that does not exist.
 */

describe('parseFareRouter', () => {
  it('reads the beta router', () => {
    expect(parseFareRouter('beta')).toBe('beta')
  })

  it('falls back to the default for anything else', () => {
    expect(parseFareRouter(null)).toBe(DEFAULT_FARE_ROUTER)
    expect(parseFareRouter('')).toBe(DEFAULT_FARE_ROUTER)
    expect(parseFareRouter('standard')).toBe(DEFAULT_FARE_ROUTER)
    // Stored values outlive the code that wrote them; an unknown one is not a
    // reason to hand the rider an endpoint that does not exist.
    expect(parseFareRouter('experimental')).toBe(DEFAULT_FARE_ROUTER)
    expect(parseFareRouter('BETA')).toBe(DEFAULT_FARE_ROUTER)
  })
})

/*
 * The module exposes no URL reader or writer, by design: the router is a stored
 * preference and a fare URL says nothing about it. If either ever comes back,
 * the warm-cache invariant in fare-api.test.ts is what has to be re-pinned.
 */
