import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { describe, expect, it } from 'vitest'

import type { Bindings } from 'app'

import { cacheControl, MAX_AGE } from './cache-control'
import { rateLimit, RATE_LIMITS } from './rate-limit'

/*
 * These middlewares are the two halves of one answer to load: cache headers so
 * well-behaved clients stop refetching, and a limiter so a badly-behaved one
 * cannot pin the origin. The tests worth having are the ones that catch a
 * regression a reader would not notice: a 304 that forgets its validators, an
 * error response that becomes cacheable, a limiter that fails closed.
 */

type Env = { Bindings: Bindings }

const app = (...mw: MiddlewareHandler<Env>[]) => {
  const a = new Hono<Env>()
  for (const m of mw) a.use('*', m)
  a.get('/ok', c => c.json({ status: 200, data: { hello: 'world' } }))
  a.get('/missing', c => c.json({ status: 404, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404))
  return a
}

describe('cacheControl', () => {
  it('sets max-age and s-maxage on a 200', async () => {
    const res = await app(cacheControl(MAX_AGE.TOPOLOGY)).request('/ok')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, s-maxage=3600')
  })

  it('attaches a weak ETag', async () => {
    const res = await app(cacheControl(MAX_AGE.STATIC)).request('/ok')
    expect(res.headers.get('ETag')).toMatch(/^W\/"[0-9a-f]+"$/)
  })

  /*
   * The whole point of the ETag. If this breaks, clients silently go back to
   * paying for a full body on every request and nothing else fails.
   */
  it('answers a matching If-None-Match with a bodyless 304', async () => {
    const a = app(cacheControl(MAX_AGE.STATIC))
    const first = await a.request('/ok')
    const etag = first.headers.get('ETag')!

    const second = await a.request('/ok', { headers: { 'If-None-Match': etag } })
    expect(second.status).toBe(304)
    expect(await second.text()).toBe('')
    // A 304 must still carry the validators, or the client cannot extend its copy.
    expect(second.headers.get('ETag')).toBe(etag)
    expect(second.headers.get('Cache-Control')).toBe('public, max-age=86400, s-maxage=86400')
  })

  it('serves the body when If-None-Match does not match', async () => {
    const res = await app(cacheControl(MAX_AGE.STATIC)).request('/ok', {
      headers: { 'If-None-Match': 'W/"stale"' }
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 200, data: { hello: 'world' } })
  })

  it('produces different ETags for different bodies', async () => {
    const a = new Hono()
    a.use('*', cacheControl(MAX_AGE.STATIC))
    a.get('/a', c => c.json({ v: 1 }))
    a.get('/b', c => c.json({ v: 2 }))
    const [x, y] = await Promise.all([a.request('/a'), a.request('/b')])
    expect(x.headers.get('ETag')).not.toBe(y.headers.get('ETag'))
  })

  /*
   * A cached 404 outlives the import that fixes it. Errors must stay fresh.
   */
  it('does not cache non-200 responses', async () => {
    const res = await app(cacheControl(MAX_AGE.STATIC)).request('/missing')
    expect(res.status).toBe(404)
    expect(res.headers.get('Cache-Control')).toBeNull()
    expect(res.headers.get('ETag')).toBeNull()
  })
})

/** Minimal stand-in for the Cloudflare binding. */
const limiter = (success: boolean, seen: string[] = []) => ({
  limit: async ({ key }: { key: string }) => {
    seen.push(key)
    return { success }
  }
})

const withEnv = async (
  a: Hono<Env>,
  path: string,
  env: Partial<Bindings>,
  init?: RequestInit
) => a.fetch(new Request(`http://localhost${path}`, init), env as Bindings)

describe('rateLimit', () => {
  it('passes the request through when under the limit', async () => {
    const a = app(rateLimit('DEFAULT'))
    const res = await withEnv(a, '/ok', { RATE_LIMIT_DEFAULT: limiter(true) })
    expect(res.status).toBe(200)
  })

  it('returns a 429 in the standard error envelope when over', async () => {
    const a = app(rateLimit('DEFAULT'))
    const res = await withEnv(a, '/ok', { RATE_LIMIT_DEFAULT: limiter(false) })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(await res.json()).toEqual({
      status: 429,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down and try again shortly.' }
    })
  })

  /*
   * A limiter fault must not take down a read API for open data. Both the
   * missing-binding and throwing cases fail open.
   */
  it('fails open when the binding is absent', async () => {
    const res = await withEnv(app(rateLimit('DEFAULT')), '/ok', {})
    expect(res.status).toBe(200)
  })

  it('fails open when the binding throws', async () => {
    const throwing = {
      limit: async () => {
        throw new Error('binding down')
      }
    }
    const res = await withEnv(app(rateLimit('DEFAULT')), '/ok', { RATE_LIMIT_DEFAULT: throwing })
    expect(res.status).toBe(200)
  })

  /*
   * A shared office NAT loading our own map must never rate-limit itself off it.
   */
  it('exempts our own front ends by Origin', async () => {
    const a = app(rateLimit('DEFAULT'))
    const res = await withEnv(a, '/ok', { RATE_LIMIT_DEFAULT: limiter(false) }, {
      headers: { Origin: 'https://commute.shiorilabs.id' }
    })
    expect(res.status).toBe(200)
  })

  it('does not exempt an unknown origin', async () => {
    const a = app(rateLimit('DEFAULT'))
    const res = await withEnv(a, '/ok', { RATE_LIMIT_DEFAULT: limiter(false) }, {
      headers: { Origin: 'https://scraper.example' }
    })
    expect(res.status).toBe(429)
  })

  it('keys on the client IP, scoped per class', async () => {
    const seen: string[] = []
    const a = app(rateLimit('FARE'))
    await withEnv(a, '/ok', { RATE_LIMIT_FARE: limiter(true, seen) }, {
      headers: { 'CF-Connecting-IP': '203.0.113.7' }
    })
    expect(seen).toEqual(['FARE:203.0.113.7'])
  })

  /*
   * Two classes must not share a bucket, or one noisy path exhausts the budget
   * for the rest.
   */
  it('uses a separate binding per class', async () => {
    const fareSeen: string[] = []
    const defaultSeen: string[] = []
    const env = {
      RATE_LIMIT_DEFAULT: limiter(true, defaultSeen),
      RATE_LIMIT_FARE: limiter(true, fareSeen)
    }
    await withEnv(app(rateLimit('FARE')), '/ok', env, { headers: { 'CF-Connecting-IP': '1.1.1.1' } })
    expect(fareSeen).toHaveLength(1)
    expect(defaultSeen).toHaveLength(0)
  })

  it('falls back to a single bucket when CF-Connecting-IP is absent', async () => {
    const seen: string[] = []
    await withEnv(app(rateLimit('DEFAULT')), '/ok', { RATE_LIMIT_DEFAULT: limiter(true, seen) })
    expect(seen).toEqual(['DEFAULT:local'])
  })

  it('prices fares tighter than ordinary reads', () => {
    expect(RATE_LIMITS.FARE).toBeLessThan(RATE_LIMITS.DEFAULT)
  })
})
