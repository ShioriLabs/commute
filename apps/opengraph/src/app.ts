import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { renderFareCard } from './render'

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

interface FareStation {
  id: string
  name: string
}

interface FareResult {
  from: FareStation
  to: FareStation
  totalFare: number | null
}

// Generic branded fallback served whenever we can't render a real fare card.
// Crawlers must always get a valid image, never a 4xx/5xx.
const DEFAULT_OG_IMAGE = 'https://commute.shiorilabs.id/img/og-image.png'

// Full station IDs look like OPERATOR-CODE (e.g. KCI-BOO, MRTJ-BLA). Cheap
// shape guard before hitting the API; real existence is checked by the fares call.
const STATION_ID = /^[A-Z0-9]+-[A-Z0-9-]+$/

const app = new Hono<{ Bindings: Bindings }>()

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
