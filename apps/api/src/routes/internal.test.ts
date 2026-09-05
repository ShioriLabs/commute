import { describe, expect, it } from 'vitest'

import app from 'app'
import type { Bindings } from 'app'
import { fareCacheKey } from 'routes/fares'
import { tripCacheKey } from 'routes/internal'

/*
 * `/_internal` is not public, but it is as reachable as everything else, and
 * `/_internal/trips` runs findRoutes — more work than the findRoute behind
 * `/fares`. What is tested here is the part that is easy to lose: that the
 * namespace is actually wired to the limiter and the cache headers, and that a
 * trip answer can never be served from a fare's cache entry.
 *
 * The limiter's own behaviour (fail-open, exemptions, per-class keys) is
 * covered in middleware/middleware.test.ts and is not repeated.
 */

const peak = { paymentMethod: 'STORED_VALUE', departureAt: new Date('2026-07-20T08:00:00+07:00') } as const
const offpeak = { paymentMethod: 'STORED_VALUE', departureAt: new Date('2026-07-20T12:00:00+07:00') } as const
const jaklingko = { paymentMethod: 'JAKLINGKO', departureAt: new Date('2026-07-20T08:00:00+07:00') } as const

describe('tripCacheKey', () => {
  it('encodes payment method and time bucket', () => {
    expect(tripCacheKey('KCI-BKS', 'MRTJ-LBB', peak, 'v3')).toBe('trips:KCI-BKS:MRTJ-LBB:STORED_VALUE:peak:v3')
  })

  it('produces distinct keys per payment method and per time bucket', () => {
    const base = tripCacheKey('KCI-BKS', 'MRTJ-LBB', peak, 'v3')
    expect(tripCacheKey('KCI-BKS', 'MRTJ-LBB', jaklingko, 'v3')).not.toBe(base) // method differs
    expect(tripCacheKey('KCI-BKS', 'MRTJ-LBB', offpeak, 'v3')).not.toBe(base) // bucket differs
  })

  /*
   * The two endpoints answer the same question with different shapes — one
   * journey against several. Sharing a key would serve a `TripResult` to a
   * caller parsing a `FareResult`, and the beta router switch means both are
   * warm for the same pair at the same time.
   */
  it('never collides with a fare key for the same arguments', () => {
    expect(tripCacheKey('KCI-BKS', 'MRTJ-LBB', peak, 'v3'))
      .not.toBe(fareCacheKey('KCI-BKS', 'MRTJ-LBB', peak, 'v3'))
  })
})

/** Minimal stand-in for the Cloudflare binding, as in middleware.test.ts. */
const limiter = (success: boolean) => ({ limit: async () => ({ success }) })

/*
 * A deployed host, not localhost: cacheControl disables itself on localhost so a
 * developer's browser cannot serve a stale answer over a change they just made,
 * and these tests are about the production headers.
 */
const ORIGIN = 'https://api.commute.shiorilabs.id'

const request = (path: string, env: Partial<Bindings>, init?: RequestInit) =>
  app.fetch(new Request(`${ORIGIN}${path}`, init), env as Bindings)

describe('/_internal/trips', () => {
  /*
   * Reaches the handler's own guard before any binding is touched, so it holds
   * with an empty env. Also the cheapest proof the route is still mounted.
   */
  it('rejects an identical origin and destination', async () => {
    const res = await request('/_internal/trips/KCI-BKS/KCI-BKS', {})
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: 'SAME_STATION' } })
  })

  /*
   * The wiring these tests exist for. Without the `app.use('/_internal/*')`
   * line these two pass a 404 and a null header instead, which is exactly the
   * state the beta switch must not ship into.
   */
  it('is behind the fare limiter', async () => {
    const res = await request('/_internal/trips/KCI-BKS/MRTJ-LBB', { RATE_LIMIT_FARE: limiter(false) })
    expect(res.status).toBe(429)
  })

  it('exempts our own front ends, the embed included', async () => {
    const res = await request('/_internal/trips/KCI-BKS/KCI-BKS', { RATE_LIMIT_FARE: limiter(false) }, {
      headers: { Origin: 'https://transportforjakarta.or.id' }
    })
    // Past the limiter, so the handler's own 404 is what comes back.
    expect(res.status).toBe(404)
  })
})

/*
 * The half that actually spares the origin.
 *
 * The embed is exempt from the limiter by origin, so for the surface this
 * change newly exposes, edge caching is the only thing standing between a
 * findRoutes call and every rider on FDTJ's page. Asserted on `/searchables`
 * because it is the one route here that reaches a 200 without D1, and the
 * middleware is applied to the namespace rather than per route.
 */
describe('/_internal cache headers', () => {
  it('carries the fare TTL and an ETag on a 200', async () => {
    const env = { KV: { get: async () => ({ stations: [] }) }, API_VERSION: 'v1' }
    const res = await request('/_internal/searchables', env as unknown as Partial<Bindings>)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=600, s-maxage=600')
    expect(res.headers.get('ETag')).toMatch(/^W\/"[0-9a-f]+"$/)
  })

  it('answers a matching If-None-Match with a 304', async () => {
    const env = { KV: { get: async () => ({ stations: [] }) }, API_VERSION: 'v1' }
    const first = await request('/_internal/searchables', env as unknown as Partial<Bindings>)
    const etag = first.headers.get('ETag')!
    const second = await request('/_internal/searchables', env as unknown as Partial<Bindings>, {
      headers: { 'If-None-Match': etag }
    })
    expect(second.status).toBe(304)
  })
})
