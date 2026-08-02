import { createMiddleware } from 'hono/factory'

/*
 * Cache-Control and ETag for the public read API.
 *
 * Every response this worker sends was previously uncacheable by anyone but us:
 * bodies are cached in KV for 20 hours, but the client and Cloudflare's edge
 * were told nothing, so a browser refetched the full body on every mount and a
 * scraper cost us a worker invocation per request.
 *
 * The data barely moves. Operators and lines are constants compiled into the
 * worker; station topology changes when an importer runs; timetables change on
 * a schedule change. So the freshness question is not "how fresh can we be" but
 * "how long may a client hold this before it is wrong", and the answers are
 * long — long enough that caching is a better answer to load than counting
 * requests is. See middleware/rate-limit.ts for the abuse backstop that sits
 * beside this, not instead of it.
 *
 * `s-maxage` is set alongside `max-age` so Cloudflare's edge holds the response
 * even where we want a browser to recheck sooner.
 */

/** Seconds. Grouped by how often the underlying data can actually change. */
export const MAX_AGE = {
  /*
   * Compiled into the worker (operators/<op>/lines.ts). A change here means a
   * deploy, and a deploy busts nothing — but a day is still well inside how
   * often Jakarta gains a line.
   */
  STATIC: 86_400,
  /*
   * Station rows, topology, transfers, hubs. Changes when an importer runs
   * against D1, which is a deliberate operator action rather than a live feed.
   */
  TOPOLOGY: 3_600,
  /*
   * Timetables. Static per service change, but a rider holding a stale board
   * for hours is worse than one holding a stale station name, so this is
   * tighter than the data strictly requires.
   */
  TIMETABLE: 1_800,
  /*
   * Fares depend on a peak/off-peak bucket derived from request time, so a
   * response can go stale on the boundary rather than on a data change. Short
   * enough that crossing into peak is not served yesterday's answer.
   */
  FARE: 600
} as const

/*
 * FNV-1a over the body, hex. Not cryptographic and does not need to be: an
 * ETag only has to change when the bytes change. Cheap enough to run on every
 * response without thinking about it.
 */
function etagFor(body: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `W/"${hash.toString(16)}"`
}

/**
 * Attaches `Cache-Control` and a weak `ETag`, and answers matching
 * `If-None-Match` with a bodyless 304.
 *
 * Applied per route group rather than globally so each group states its own
 * freshness. Errors are never cached: a 404 for a station that is about to be
 * imported should not stick to a client for an hour.
 */
export function cacheControl(maxAge: number) {
  return createMiddleware(async (c, next) => {
    await next()

    if (c.res.status !== 200) return

    c.res.headers.set('Cache-Control', `public, max-age=${maxAge}, s-maxage=${maxAge}`)

    /*
     * Read the body to hash it. Safe because every handler here returns a JSON
     * body already fully in memory — there is nothing streaming to consume.
     */
    const body = await c.res.clone().text()
    const etag = etagFor(body)
    c.res.headers.set('ETag', etag)

    /*
     * A 304 still carries the validators, so the client can extend its copy
     * without us serializing the body again. MBTA's V3 API does the same and
     * does not count a 304 against the caller's rate limit; ours likewise costs
     * the caller nothing, since the limiter runs before this and a 304 is the
     * cheapest thing we can return.
     */
    if (c.req.header('If-None-Match') === etag) {
      c.res = new Response(null, {
        status: 304,
        headers: {
          'Cache-Control': c.res.headers.get('Cache-Control')!,
          'ETag': etag
        }
      })
    }
  })
}
