import { createMiddleware } from 'hono/factory'

import type { Bindings } from 'app'

/*
 * Abuse backstop for the public read API.
 *
 * This is not a quota and is deliberately not documented as one. The API takes
 * no credentials, so there is no account to meter and no one to bill; the only
 * thing worth stopping is a client hammering the origin hard enough to cost us
 * real money. Everything gentler than that is handled by cache headers
 * (middleware/cache-control.ts), which is the lever that actually reduces load
 * — a well-behaved client revalidating with If-None-Match never reaches here
 * in a state that matters.
 *
 * Design notes, and why the obvious choices were not taken:
 *
 * - KV cannot implement this. It is eventually consistent with no atomic
 *   increment, so a read-modify-write counter races within a colo and drifts
 *   across them. Cloudflare's rate limiting binding is purpose-built and free.
 *
 * - Counters are per-Cloudflare-location, and Cloudflare documents the binding
 *   as "permissive, eventually consistent, and intentionally designed to not be
 *   used as an accurate accounting system". A distributed client therefore gets
 *   somewhat more than LIMIT. That is acceptable for abuse control and would
 *   not be for a quota — another reason not to publish a number.
 *
 * - `period` may only be 10 or 60 seconds. That is a platform constraint, not
 *   a choice.
 *
 * - Cloudflare advises keying on a stable identifier rather than an IP, since
 *   IPs are shared. We have no identifier to use, and in Jakarta mobile CGNAT
 *   puts a lot of real users behind few addresses — so the limit is set high
 *   enough that a shared address full of ordinary riders stays under it, and
 *   the key is scoped per endpoint class so one noisy path cannot exhaust the
 *   budget for the rest. This is the weakest part of the design and the reason
 *   the limit is generous rather than tight.
 */

/**
 * Requests per minute per IP per class, matching the `[[ratelimits]]` blocks in
 * wrangler.toml. Exported so the tests assert against one source of truth
 * rather than a number retyped in a second place.
 *
 * Sized against real usage, not against what the origin could bear: a rider
 * opening the map, searching, and checking a few fares makes well under a
 * hundred calls in a minute, and most of those are served from cache without
 * a body. A scraper walking all 393 searchable stations blows through it.
 */
export const RATE_LIMITS = {
  /** Reads: stations, lines, hubs, operators, timetables. */
  DEFAULT: 600,
  /**
   * Fares run Dijkstra over the whole graph and their cache key includes
   * payment method and time bucket, so they are both the most expensive route
   * and the easiest to deliberately miss cache on. Tighter, but still far above
   * what planning a journey costs.
   */
  FARE: 120
} as const

export type RateLimitClass = keyof typeof RATE_LIMITS

/*
 * Our own front ends are exempt.
 *
 * They are first-party, their traffic is already shaped by the cache headers,
 * and a shared office or campus NAT loading commute.shiorilabs.id should never
 * be able to rate-limit itself off its own map. Origin is trivially spoofable
 * by a non-browser client, which is fine: this is not a security boundary, and
 * anyone willing to forge a header was never going to be stopped by a limit
 * keyed on a shared IP either.
 *
 * Exported so middleware/request-log.ts can classify a request's Referer
 * against the same boundaries, rather than redeclaring them.
 */
export const EXEMPT_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'https://commute.shiorilabs.id',
  'https://dev.commute.shiorilabs.id',
  'https://data.commute.shiorilabs.id',
  'https://transportforjakarta.or.id'
])

/**
 * Rate limit by client IP, scoped to one endpoint class.
 *
 * Fails open. If the binding is missing (local `wrangler dev` without the
 * namespace, or a test harness) or throws, the request is served: a limiter
 * fault must not take down a read API for open data. The cost of failing open
 * is that abuse gets through during an outage of the limiter itself, which is
 * strictly better than every client getting a 429 because a binding was
 * misconfigured.
 */
export function rateLimit(limitClass: RateLimitClass) {
  return createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
    const origin = c.req.header('Origin')
    if (origin && EXEMPT_ORIGINS.has(origin)) return next()

    const limiter = limitClass === 'FARE' ? c.env.RATE_LIMIT_FARE : c.env.RATE_LIMIT_DEFAULT
    if (!limiter) return next()

    /*
     * CF-Connecting-IP is set by Cloudflare and cannot be spoofed by the
     * client. Falling back to a constant when it is absent (local dev) puts
     * every caller in one bucket, which is correct for dev and never happens in
     * production.
     */
    const ip = c.req.header('CF-Connecting-IP') ?? 'local'
    const key = `${limitClass}:${ip}`

    let success = true
    try {
      ({ success } = await limiter.limit({ key }))
    } catch {
      return next()
    }

    if (success) return next()

    /*
     * Retry-After is the window, since the binding does not tell us how much of
     * it is left. Deliberately no `x-ratelimit-limit`/`-remaining`: those
     * describe a budget a caller can plan against, and a per-colo eventually
     * consistent counter cannot honestly promise one. MBTA publishes those
     * headers because it meters per API key; we would be publishing a number we
     * do not actually hold anyone to.
     */
    return c.json(
      {
        status: 429,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Slow down and try again shortly.'
        }
      },
      429,
      { 'Retry-After': '60' }
    )
  })
}
