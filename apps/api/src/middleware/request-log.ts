import { createMiddleware } from 'hono/factory'

import type { Bindings } from 'app'
import { EXEMPT_ORIGINS } from './rate-limit'

/*
 * One structured log line per request: path, status, timing, and who sent it.
 *
 * Written to answer "which route is hottest, which clients are hitting it,
 * what does it cost" after a KV read spike turned out to be crawler traffic
 * with no cache in front of it (see _middleware.ts on the web app for the
 * fix). Cloudflare's automatic per-invocation Workers Log captures request
 * metadata too, but its exact field set isn't documented precisely enough to
 * rely on for grouping by User-Agent - a structured console.log of exactly the
 * fields worth slicing by is what the dashboard's Query Builder can reliably
 * filter and group on, at unlimited cardinality.
 *
 * Mounted first in app.ts, ahead of CORS/rateLimit/cacheControl, so the timing
 * covers the whole request including a 429 from the limiter. This is a
 * worker-side request log, not the client-facing Server-Timing header
 * (utils/server-timing.ts) - that one reports intra-request phase timings to
 * the caller; this one is for us, after the fact, in the dashboard.
 */

// Same substrings as CRAWLER_UA in apps/web/functions/_middleware.ts, kept
// separate rather than shared: that file is a Pages Function (different
// runtime/package), and this classifier only needs to bucket, not exactly
// match the crawler-serving decision made there.
const UA_CLASSES: [label: string, needle: string][] = [
  ['googlebot', 'googlebot'],
  ['bingbot', 'bingbot'],
  ['facebook', 'facebookexternalhit'],
  ['twitter', 'twitterbot'],
  ['slack', 'slackbot'],
  ['discord', 'discordbot'],
  ['whatsapp', 'whatsapp'],
  ['telegram', 'telegrambot'],
  ['linkedin', 'linkedinbot'],
  ['pinterest', 'pinterest'],
  ['reddit', 'redditbot'],
  ['embedly', 'embedly'],
  ['skype', 'skypeuripreview'],
  ['applebot', 'applebot'],
  ['yandex', 'yandex'],
  ['duckduckbot', 'duckduckbot'],
  ['baidu', 'baiduspider']
]

function classifyUa(ua: string | undefined): string {
  if (!ua) return 'none'
  const lower = ua.toLowerCase()
  for (const [label, needle] of UA_CLASSES) {
    if (lower.includes(needle)) return label
  }
  // A browser UA always carries "Mozilla/" for historical reasons; anything
  // else claiming to be neither a known bot nor a browser is worth its own
  // bucket rather than folding into "browser".
  return lower.includes('mozilla/') ? 'browser' : 'other'
}

/*
 * Buckets a Referer against EXEMPT_ORIGINS (middleware/rate-limit.ts) so
 * "which surface sent this" reads as a name instead of a raw URL: our own
 * front end, the FDTJ embed, or CDP, vs. everything else (crawlers and direct
 * API/curl callers rarely send a Referer at all).
 */
function classifyReferer(referer: string | undefined): string {
  if (!referer) return 'none'

  let origin: string
  try {
    origin = new URL(referer).origin
  } catch {
    return 'other'
  }

  if (!EXEMPT_ORIGINS.has(origin)) return 'other'
  if (origin.includes('transportforjakarta.or.id')) return 'fdtj'
  if (origin.includes('data.commute')) return 'cdp'
  if (origin.includes('localhost')) return 'dev'
  return 'commute'
}

export function requestLog() {
  return createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
    const start = performance.now()

    await next()

    /*
     * Never let a logging bug take down a request: this runs after the
     * response is already decided, so a throw here must be swallowed rather
     * than surfaced as a 500 for what was otherwise a successful request.
     */
    try {
      const cf = c.req.raw.cf as IncomingRequestCfProperties | undefined
      console.log(JSON.stringify({
        path: c.req.path,
        method: c.req.method,
        status: c.res.status,
        ua: c.req.header('User-Agent') ?? null,
        uaClass: classifyUa(c.req.header('User-Agent')),
        referer: c.req.header('Referer') ?? null,
        refererClass: classifyReferer(c.req.header('Referer')),
        colo: cf?.colo ?? null,
        country: cf?.country ?? null,
        ms: Math.round((performance.now() - start) * 100) / 100
      }))
    } catch {
      // Logging must never affect the response.
    }
  })
}
