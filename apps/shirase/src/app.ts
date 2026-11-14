import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { ArchiveNotFound, contentEncoding, getRawTile, openArchive } from './archive'
import { renderMapPage } from './map-page'
import { buildStyle, isTheme, type Theme } from './style'

/*
 * shirase: the basemap behind Peta Bus. Named for the icebreaker Shirase,
 * the ship that carries the girls to Antarctica in A Place Further than the
 * Universe (Sora yori mo Tooi Basho).
 *
 * Serves a Protomaps PMTiles extract out of R2 as plain z/x/y vector tile URLs,
 * so every tile caches at the edge and in the web app's service worker like any
 * other static file, and the browser needs no PMTiles library. Also serves the
 * glyphs (PT Sans and PT Sans Narrow, per JakLingko's guideline) and sprites the
 * basemap style needs, and the finished MapLibre styles themselves
 * (/styles/{theme}.json, src/style.ts), so the web app and Android load one URL
 * and the whole basemap comes from one origin.
 *
 * R2 layout (bucket `shirase-tiles`):
 *   <tileset>.pmtiles             e.g. jabodetabek-20261114.pmtiles
 *   fonts/<font stack>/<a>-<b>.pbf
 *   sprites/<name>.json|.png      light, light@2x, dark, dark@2x
 *
 * Archives are versioned by FILENAME, never replaced in place: the style
 * names the version it was built against, so a refresh is a new tileset name
 * and no cached tile can outlive the archive it came from.
 */

export interface Bindings {
  TILES: R2Bucket
  ALLOWED_ORIGINS: string
}

type AppContext = Context<{ Bindings: Bindings }>

const TILESET = /^[a-z0-9-]+$/
const TILE_FILE = /^(\d+)\.mvt$/
const TILEJSON_FILE = /^([a-z0-9-]+)\.json$/
/*
 * One font per stack. MapLibre asks for the whole comma-joined stack as a
 * single path, and combining stacks on the fly is not something we do, so a
 * multi-font stack is a style bug and gets a 404 rather than silently missing
 * labels.
 */
const FONT_STACK = /^[A-Za-z0-9 -]+$/
const GLYPH_RANGE = /^\d+-\d+\.pbf$/
const SPRITE_FILE = /^[a-z0-9-]+(@2x)?\.(json|png)$/

/*
 * A tile only changes with a new archive, which is a new URL, so a day fresh
 * plus a week of stale-while-revalidate is safe and keeps the edge warm.
 * Glyphs and sprites change even less.
 */
const TILE_CACHE = 'public, max-age=86400, stale-while-revalidate=604800'
const ASSET_CACHE = 'public, max-age=2592000, immutable'
/*
 * A style names the newest tileset, so it changes when an extract is uploaded.
 * Five minutes is how long that takes to reach the apps, with no app release.
 */
const STYLE_CACHE = 'public, max-age=300'
const STYLE_FILE = /^([a-z0-9-]+)\.json$/

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', async (c, next) => {
  const allowed = c.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  return cors({ origin: allowed, allowMethods: ['GET', 'HEAD', 'OPTIONS'], maxAge: 86400 })(c, next)
})

/*
 * The edge cache, around the handlers and INSIDE the CORS middleware: what is
 * stored carries no Access-Control-Allow-Origin, so one entry serves every
 * allowed origin and CORS is decided per request on the way out.
 */
async function cached(c: AppContext, compute: () => Promise<Response>): Promise<Response> {
  const cache = typeof caches === 'undefined' ? undefined : caches.default
  const key = new Request(c.req.url, { method: 'GET' })
  const hit = await cache?.match(key)
  if (hit) return withRawBody(hit)

  const response = await compute()
  if (!cache || response.status !== 200 || c.req.method !== 'GET') return response

  /*
   * Not response.clone(): a clone drops `encodeBody: 'manual'`, so the copy
   * put in the cache was a gzip of the already-gzipped tile, and every cache
   * hit after the first request served a tile the client could not read
   * (measured in wrangler dev). Both copies are rebuilt from the raw bytes
   * with the flag set; a stored-encoded body reads back as those raw bytes.
   */
  const bytes = await response.arrayBuffer()
  c.executionCtx.waitUntil(cache.put(key, withRawBody(response, bytes)))
  return withRawBody(response, bytes)
}

/*
 * A response whose body is sent exactly as given. Wherever a stored-encoded
 * tile is handed back to the runtime it needs `encodeBody: 'manual'`, or the
 * runtime gzips the gzip. The flag does not survive clone(), nor does it come
 * back on what cache.match returns (that body reads as the raw stored bytes
 * but is sent as if unencoded), so every response that leaves this module
 * with a Content-Encoding is rebuilt here. All three were measured
 * double-encoding in wrangler dev before this.
 */
function withRawBody(response: Response, body: BodyInit | null = response.body): Response {
  return new Response(body, {
    status: response.status,
    headers: response.headers,
    encodeBody: response.headers.has('content-encoding') ? 'manual' : 'automatic'
  })
}

async function serveObject(c: AppContext, key: string, contentType: string): Promise<Response> {
  return cached(c, async () => {
    const object = await c.env.TILES.get(key)
    if (!object) return c.notFound()
    return new Response(object.body, {
      headers: {
        'content-type': contentType,
        'cache-control': ASSET_CACHE,
        'etag': object.httpEtag,
        'vary': 'Origin'
      }
    })
  })
}

app.get('/', c => c.text('shirase: basemap tiles for Commute\n'))

// Browsers ask for it on /map; empty rather than a 404 in the console.
app.get('/favicon.ico', c => c.body(null, 204))

/** Every archive in the bucket, newest first (the build date is in the name). */
async function listTilesets(bucket: R2Bucket): Promise<string[]> {
  const listing = await bucket.list({ delimiter: '/' })
  return listing.objects
    .filter(o => o.key.endsWith('.pmtiles'))
    .map(o => o.key.replace(/\.pmtiles$/, ''))
    .filter(name => TILESET.test(name))
    .sort((a, b) => b.localeCompare(a))
}

/*
 * A finished MapLibre style (src/style.ts) pointing at the newest tileset, or
 * at `?tileset=` when it names one the bucket holds. Every URL inside is
 * absolute, built from this request's origin, so the same document works for
 * the web app and for Android.
 */
app.get('/styles/:file', async (c) => {
  const theme = STYLE_FILE.exec(c.req.param('file'))?.[1]
  if (!theme || !isTheme(theme)) return c.notFound()
  return cached(c, async () => {
    const tilesets = await listTilesets(c.env.TILES)
    const requested = c.req.query('tileset')
    const tileset = requested ?? tilesets[0]
    if (!tileset || !tilesets.includes(tileset)) return c.notFound()

    const style = buildStyle({ origin: new URL(c.req.url).origin, tileset, theme })
    return new Response(JSON.stringify(style), {
      headers: { 'content-type': 'application/json', 'cache-control': STYLE_CACHE, 'vary': 'Origin' }
    })
  })
})

/*
 * A test map over whatever archives the bucket holds (src/map-page.tsx),
 * loading the same /styles/{theme}.json the apps do. Registered before
 * `/:file` so the TileJSON route doesn't swallow it. Not cached: the tileset
 * list changes whenever an extract is uploaded.
 */
app.get('/map', async (c) => {
  const tilesets = await listTilesets(c.env.TILES)
  const requested = c.req.query('tileset')
  const tileset = requested && tilesets.includes(requested) ? requested : tilesets[0] ?? ''
  const themeParam = c.req.query('theme') ?? ''
  const theme: Theme = isTheme(themeParam) ? themeParam : 'light'

  c.header('cache-control', 'no-store')
  return c.html(renderMapPage({ origin: new URL(c.req.url).origin, tilesets, tileset, theme }))
})

app.get('/fonts/:stack/:range', (c) => {
  const stack = c.req.param('stack')
  const range = c.req.param('range')
  if (!FONT_STACK.test(stack) || !GLYPH_RANGE.test(range)) return c.notFound()
  return serveObject(c, `fonts/${stack}/${range}`, 'application/x-protobuf')
})

app.get('/sprites/:file', (c) => {
  const file = c.req.param('file')
  if (!SPRITE_FILE.test(file)) return c.notFound()
  return serveObject(c, `sprites/${file}`, file.endsWith('.json') ? 'application/json' : 'image/png')
})

app.get('/:file', (c) => {
  const match = TILEJSON_FILE.exec(c.req.param('file'))
  if (!match) return c.notFound()
  const tileset = match[1]!
  return cached(c, async () => {
    try {
      const archive = openArchive(c.env.TILES, tileset)
      const origin = new URL(c.req.url).origin
      const tilejson = await archive.pmtiles.getTileJson(`${origin}/${tileset}`)
      return new Response(JSON.stringify(tilejson), {
        headers: { 'content-type': 'application/json', 'cache-control': TILE_CACHE, 'vary': 'Origin' }
      })
    } catch (error) {
      if (error instanceof ArchiveNotFound) return c.notFound()
      throw error
    }
  })
})

app.get('/:tileset/:z/:x/:file', (c) => {
  const { tileset, z, x, file } = c.req.param()
  const y = TILE_FILE.exec(file)?.[1]
  if (!TILESET.test(tileset) || !/^\d+$/.test(z) || !/^\d+$/.test(x) || y === undefined) return c.notFound()

  return cached(c, async () => {
    try {
      const { tile } = await getRawTile(openArchive(c.env.TILES, tileset), Number(z), Number(x), Number(y))
      // No tile here (sea, outside the extract): empty, which MapLibre draws as nothing.
      if (!tile) return new Response(null, { status: 204, headers: { 'cache-control': TILE_CACHE } })

      const headers = new Headers({ 'content-type': 'application/x-protobuf', 'cache-control': TILE_CACHE, 'vary': 'Origin' })
      const encoding = contentEncoding(tile.compression)
      if (encoding) headers.set('content-encoding', encoding)
      /*
       * The bytes are already compressed as stored. `encodeBody: 'manual'`
       * tells the Workers runtime to send them as they are under that
       * Content-Encoding rather than compressing them a second time.
       */
      return new Response(tile.data, { headers, encodeBody: 'manual' })
    } catch (error) {
      if (error instanceof ArchiveNotFound || error instanceof RangeError) return c.notFound()
      throw error
    }
  })
})

export default app
