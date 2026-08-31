import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { renderFareCard } from './render'
import type { FareResult as SharedFareResult } from '@commute/schemas'

export interface Bindings {
  API_URL: string
  KV: KVNamespace
}

interface StandardResponse<T = unknown> {
  status: number
  data?: T
  error?: {
    message: string
    code: string
  }
}

/*
 * Only the fields the card renders. `Pick` from the shared definition rather
 * than a hand-copy, so a fare reshape breaks the build instead of the image.
 */
type FareResult = Pick<SharedFareResult, 'from' | 'to' | 'totalFare'>

// Generic branded fallback served whenever we can't render a real fare card.
// Crawlers must always get a valid image, never a 4xx/5xx.
const DEFAULT_OG_IMAGE = 'https://commute.shiorilabs.id/img/og-image.png'

// Full station IDs look like OPERATOR-CODE (e.g. KCI-BOO, MRTJ-BLA). Cheap
// shape guard before hitting the API; real existence is checked by the fares call.
const STATION_ID = /^[A-Z0-9]+-[A-Z0-9-]+$/

const app = new Hono<{ Bindings: Bindings }>()

// Same substrings as CRAWLER_UA in apps/web/functions/_middleware.ts / the
// classifier in apps/api/src/middleware/request-log.ts, kept inline rather
// than shared: one route in this worker, not worth a cross-app dependency.
// This worker exists purely to serve OG images to link-preview bots, so which
// bot it is matters more here than almost anywhere else in the system.
const UA_CLASSES: [label: string, needle: string][] = [
  ['facebook', 'facebookexternalhit'],
  ['twitter', 'twitterbot'],
  ['slack', 'slackbot'],
  ['discord', 'discordbot'],
  ['whatsapp', 'whatsapp'],
  ['telegram', 'telegrambot'],
  ['googlebot', 'googlebot'],
  ['bingbot', 'bingbot'],
  ['linkedin', 'linkedinbot'],
  ['pinterest', 'pinterest'],
  ['reddit', 'redditbot'],
  ['embedly', 'embedly'],
  ['skype', 'skypeuripreview'],
  ['applebot', 'applebot'],
  ['yandex', 'yandex']
]

function classifyUa(ua: string | undefined): string {
  if (!ua) return 'none'
  const lower = ua.toLowerCase()
  for (const [label, needle] of UA_CLASSES) {
    if (lower.includes(needle)) return label
  }
  return lower.includes('mozilla/') ? 'browser' : 'other'
}

/*
 * One structured log line per request: path, status, timing, and who sent it.
 * Same reasoning as apps/api/src/middleware/request-log.ts (written after a
 * KV read spike turned out to be crawler traffic hitting a chain with no
 * cache in front of it) - this worker sits downstream of the same crawlers,
 * so it gets the same treatment.
 */
app.use('*', async (c, next) => {
  const start = performance.now()
  await next()
  try {
    const ua = c.req.header('User-Agent')
    const cf = c.req.raw.cf as IncomingRequestCfProperties | undefined
    console.log(JSON.stringify({
      path: c.req.path,
      status: c.res.status,
      ua: ua ?? null,
      uaClass: classifyUa(ua),
      referer: c.req.header('Referer') ?? null,
      colo: cf?.colo ?? null,
      country: cf?.country ?? null,
      ms: Math.round((performance.now() - start) * 100) / 100
    }))
  } catch {
    // Logging must never affect the response.
  }
})

app.use('*', cors({
  origin(origin) {
    if (
      origin === 'http://localhost:3000'
      || origin === 'http://localhost:5173'
      || origin === 'https://commute.shiorilabs.id'
      || origin === 'https://dev.commute.shiorilabs.id'
    ) {
      return origin
    }

    return null
  },
  allowMethods: ['GET', 'POST', 'OPTIONS']
}))

// Short-cache redirect to the generic image. Kept brief so a transient API/render
// outage doesn't get cached for a week.
function fallback(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      'location': DEFAULT_OG_IMAGE,
      'cache-control': 'public, max-age=300'
    }
  })
}

app.get('/fare/:from/:to', async (ctx) => {
  const from = ctx.req.param('from')
  const to = ctx.req.param('to')

  if (!STATION_ID.test(from) || !STATION_ID.test(to) || from === to) {
    return fallback()
  }

  // Edge-cache read-through: repeat crawler hits for the same pair skip the
  // wasm rasterization entirely. Same pattern as the sitemap in the web middleware.
  const cache = caches.default
  const cacheKey = new Request(ctx.req.url)
  const hit = await cache.match(cacheKey)
  if (hit) return hit

  try {
    const url = new URL(`/fares/${encodeURIComponent(from)}/${encodeURIComponent(to)}`, ctx.env.API_URL)
    const res = await fetch(url.href)
    if (!res.ok) return fallback()

    const body = await res.json<StandardResponse<FareResult>>()
    const fromName = body.data?.from?.name
    const toName = body.data?.to?.name
    if (body.error || !fromName || !toName) return fallback()

    const png = await renderFareCard(fromName, toName)

    const image = new Response(png, {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=86400, s-maxage=604800'
      }
    })
    ctx.executionCtx.waitUntil(cache.put(cacheKey, image.clone()))
    return image
  } catch (error) {
    console.error(error)
    return fallback()
  }
})

export default app
