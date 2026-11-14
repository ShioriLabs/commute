import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app from './app'
import { closeArchives } from './archive'
import { buildArchive, fakeExecutionContext, FakeBucket, FakeCache } from './test-helpers'

const ORIGIN = 'https://commute.shiorilabs.id'
const TILESET = 'jabodetabek-20261114'
// z14 tile over Monas.
const MONAS = { z: 14, x: 13053, y: 8473 }
const MONAS_BYTES = new Uint8Array([0x1f, 0x8b, 1, 2, 3, 4])

let bucket: FakeBucket

const request = (path: string, init: RequestInit = {}) => {
  const ctx = fakeExecutionContext()
  const env = { TILES: bucket.asR2(), ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173` }
  return { ctx, response: app.request(`https://shirase.example${path}`, init, env, ctx) }
}

beforeEach(() => {
  closeArchives()
  bucket = new FakeBucket()
  bucket.put(`${TILESET}.pmtiles`, buildArchive([
    { ...MONAS, data: MONAS_BYTES },
    { z: 0, x: 0, y: 0, data: new Uint8Array([9]) }
  ], { minZoom: 0, maxZoom: 15 }))
  bucket.put('fonts/PT Sans Narrow Regular/0-255.pbf', new Uint8Array([7, 7]))
  bucket.put('sprites/light@2x.png', new Uint8Array([0x89, 0x50]))
  bucket.put('sprites/light.json', new TextEncoder().encode('{}'))
})

afterEach(() => {
  delete (globalThis as { caches?: unknown }).caches
})

describe('tiles', () => {
  it('serves the stored bytes untouched, under the stored encoding', async () => {
    const res = await request(`/${TILESET}/${MONAS.z}/${MONAS.x}/${MONAS.y}.mvt`).response
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/x-protobuf')
    expect(res.headers.get('content-encoding')).toBe('gzip')
    expect(res.headers.get('cache-control')).toContain('max-age=86400')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(MONAS_BYTES)
  })

  it('answers 204 where the archive has no tile', async () => {
    const res = await request(`/${TILESET}/14/13054/8473.mvt`).response
    expect(res.status).toBe(204)
  })

  it('answers 204 above the archive max zoom', async () => {
    const res = await request(`/${TILESET}/16/0/0.mvt`).response
    expect(res.status).toBe(204)
  })

  it.each([
    ['x outside the zoom level', `/${TILESET}/2/4/0.mvt`],
    ['a non-numeric z', `/${TILESET}/a/0/0.mvt`],
    ['the wrong extension', `/${TILESET}/0/0/0.png`],
    ['an uppercase tileset', '/Jabodetabek/0/0/0.mvt'],
    ['an archive that is not there', '/nowhere/0/0/0.mvt']
  ])('answers 404 for %s', async (_, path) => {
    expect((await request(path).response).status).toBe(404)
  })

  it('re-reads the header when the archive is replaced under a live isolate', async () => {
    expect((await request(`/${TILESET}/0/0/0.mvt`).response).status).toBe(200)
    const replaced = new Uint8Array([5, 5, 5])
    bucket.put(`${TILESET}.pmtiles`, buildArchive([{ z: 0, x: 0, y: 0, data: replaced }]))
    const res = await request(`/${TILESET}/0/0/0.mvt`).response
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(replaced)
  })
})

describe('TileJSON', () => {
  it('points the tiles template back at this origin', async () => {
    const res = await request(`/${TILESET}.json`).response
    expect(res.status).toBe(200)
    const tilejson = await res.json() as Record<string, unknown>
    expect(tilejson.tiles).toEqual([`https://shirase.example/${TILESET}/{z}/{x}/{y}.mvt`])
    expect(tilejson.minzoom).toBe(0)
    expect(tilejson.maxzoom).toBe(15)
    expect(tilejson.vector_layers).toEqual([{ id: 'roads', fields: {} }])
    expect(tilejson.bounds).toEqual([105.9, -6.8, 107.3, -5.85])
  })

  it('answers 404 for an unknown tileset', async () => {
    expect((await request('/nowhere.json').response).status).toBe(404)
  })
})

describe('glyphs and sprites', () => {
  it('serves a glyph range as protobuf', async () => {
    const res = await request('/fonts/PT%20Sans%20Narrow%20Regular/0-255.pbf').response
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/x-protobuf')
    expect(res.headers.get('cache-control')).toContain('immutable')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([7, 7]))
  })

  it('refuses a multi-font stack rather than half-serving it', async () => {
    const res = await request('/fonts/PT%20Sans%20Narrow%20Regular,Noto%20Sans%20Regular/0-255.pbf').response
    expect(res.status).toBe(404)
  })

  it('answers 404 for a glyph range it does not have', async () => {
    expect((await request('/fonts/PT%20Sans%20Regular/0-255.pbf').response).status).toBe(404)
  })

  it('serves sprites with their content types', async () => {
    const png = await request('/sprites/light@2x.png').response
    expect(png.status).toBe(200)
    expect(png.headers.get('content-type')).toBe('image/png')
    const json = await request('/sprites/light.json').response
    expect(json.headers.get('content-type')).toBe('application/json')
  })

  it('answers 404 for a sprite path outside the pattern', async () => {
    expect((await request('/sprites/..%2Fsecret.json').response).status).toBe(404)
  })
})

describe('/styles', () => {
  it('serves a theme pointing at the newest tileset, briefly cached', async () => {
    bucket.put('jabodetabek-20261001.pmtiles', new Uint8Array([0]))
    const res = await request('/styles/light.json', { headers: { origin: ORIGIN } }).response
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    const style = await res.json() as { sources: { protomaps: { url: string } }, sprite: string }
    expect(style.sources.protomaps.url).toBe(`https://shirase.example/${TILESET}.json`)
    expect(style.sprite).toBe('https://shirase.example/sprites/light')
  })

  it('pins ?tileset= when the bucket holds it', async () => {
    bucket.put('jabodetabek-20261001.pmtiles', new Uint8Array([0]))
    const style = await (await request('/styles/dark.json?tileset=jabodetabek-20261001').response).json() as { sources: { protomaps: { url: string } } }
    expect(style.sources.protomaps.url).toBe('https://shirase.example/jabodetabek-20261001.json')
  })

  it.each([
    ['an unknown theme', '/styles/neon.json'],
    ['the wrong extension', '/styles/light.yaml'],
    ['a tileset the bucket lacks', '/styles/light.json?tileset=nope']
  ])('answers 404 for %s', async (_, path) => {
    expect((await request(path).response).status).toBe(404)
  })

  it('answers 404 when the bucket has no archives', async () => {
    bucket.objects.delete(`${TILESET}.pmtiles`)
    expect((await request('/styles/light.json').response).status).toBe(404)
  })
})

describe('/map test page', () => {
  const configOf = async (res: Response) => {
    const html = await res.text()
    const json = /<script type="application\/json" id="config">(.*?)<\/script>/s.exec(html)?.[1]
    return JSON.parse(json!) as { origin: string, tilesets: string[], tileset: string, theme: string, themes: string[] }
  }

  it('offers every archive, newest first, and opens the newest', async () => {
    bucket.put('jabodetabek-20261001.pmtiles', new Uint8Array([0]))
    const res = await request('/map').response
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const config = await configOf(res)
    expect(config.tilesets).toEqual([TILESET, 'jabodetabek-20261001'])
    expect(config.tileset).toBe(TILESET)
    expect(config.origin).toBe('https://shirase.example')
    expect(config.theme).toBe('light')
    expect(config.themes).toEqual(['light', 'dark'])
  })

  it('opens the requested tileset and theme, ignoring unknown ones', async () => {
    bucket.put('jabodetabek-20261001.pmtiles', new Uint8Array([0]))
    expect(await configOf(await request('/map?tileset=jabodetabek-20261001&theme=dark').response))
      .toMatchObject({ tileset: 'jabodetabek-20261001', theme: 'dark' })
    expect(await configOf(await request('/map?tileset=nope&theme=neon').response))
      .toMatchObject({ tileset: TILESET, theme: 'light' })
  })

  it('says so when the bucket has no archives', async () => {
    bucket.objects.delete(`${TILESET}.pmtiles`)
    const html = await (await request('/map').response).text()
    expect(html).toContain('No tilesets in the bucket')
    expect(html).not.toContain('maplibre-gl.mjs')
  })

  it('is not taken over by the TileJSON route', async () => {
    expect((await request('/map').response).status).toBe(200)
    expect((await request('/map.json').response).status).toBe(404)
  })
})

describe('CORS', () => {
  it('allows the web app origin', async () => {
    const res = await request(`/${TILESET}/0/0/0.mvt`, { headers: { origin: ORIGIN } }).response
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
  })

  it('does not allow other origins', async () => {
    const res = await request(`/${TILESET}/0/0/0.mvt`, { headers: { origin: 'https://elsewhere.example' } }).response
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('edge cache', () => {
  it('serves a repeat tile from the cache, with CORS decided per request', async () => {
    const cache = new FakeCache();
    (globalThis as { caches?: unknown }).caches = { default: cache }

    const first = request(`/${TILESET}/0/0/0.mvt`, { headers: { origin: ORIGIN } })
    expect((await first.response).status).toBe(200)
    await first.ctx.settle()
    expect(cache.store.size).toBe(1)
    const stored = [...cache.store.values()][0]!
    expect(stored.headers.get('access-control-allow-origin')).toBeNull()

    const gets = bucket.gets
    const second = await request(`/${TILESET}/0/0/0.mvt`, { headers: { origin: 'http://localhost:5173' } }).response
    expect(second.status).toBe(200)
    expect(bucket.gets).toBe(gets)
    expect(second.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(new Uint8Array([9]))
  })

  /*
   * Node ignores `encodeBody`, so the double-gzip this guards against (found
   * in wrangler dev: clone() and cache.match both lose the flag) cannot show
   * up as bytes here. Instead: every Response WE build with a Content-Encoding,
   * on the miss, the cache put and the hit, must ask for manual encoding.
   *
   * Hono also re-wraps responses internally, passing the Response itself as
   * the init. Those carry no readable flag in Node, so they are left out here;
   * end to end in wrangler dev, misses and repeated hits both decode to the
   * stored tile under every Accept-Encoding.
   */
  it('builds every encoded response, cached or not, with manual body encoding', async () => {
    const cache = new FakeCache();
    (globalThis as { caches?: unknown }).caches = { default: cache }
    const inits: ResponseInit[] = []
    const Original = globalThis.Response
    globalThis.Response = class extends Original {
      constructor(body?: BodyInit | null, init?: ResponseInit) {
        super(body, init)
        if (init) inits.push(init)
      }
    } as typeof Response
    try {
      const first = request(`/${TILESET}/0/0/0.mvt`)
      await first.response
      await first.ctx.settle()
      await request(`/${TILESET}/0/0/0.mvt`).response
    } finally {
      globalThis.Response = Original
    }
    const ours = inits.filter(i => !(i instanceof Original) && new Headers(i.headers).has('content-encoding'))
    // The handler's response, the cached copy, the returned copy, the hit.
    expect(ours).toHaveLength(4)
    for (const init of ours) expect((init as { encodeBody?: string }).encodeBody).toBe('manual')
  })

  it('does not cache a miss', async () => {
    const cache = new FakeCache();
    (globalThis as { caches?: unknown }).caches = { default: cache }
    const miss = request(`/${TILESET}/14/13054/8473.mvt`)
    expect((await miss.response).status).toBe(204)
    await miss.ctx.settle()
    expect(cache.store.size).toBe(0)
  })
})
