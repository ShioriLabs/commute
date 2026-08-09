import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { openAPIRouteHandler } from 'hono-openapi'

import stations from './routes/stations'
import hubs from './routes/hubs'
import lines from './routes/lines'
import fares from './routes/fares'
import operatorRoutes from './routes/operators'
import internalRoutes from './routes/internal'
import { cacheControl, MAX_AGE } from './middleware/cache-control'
import { rateLimit } from './middleware/rate-limit'

/**
 * Cloudflare's rate limiting binding. Optional because local `wrangler dev` and
 * the test harness run without the namespace; the middleware fails open when it
 * is absent rather than rejecting everything.
 */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export interface Bindings {
  DB: D1Database
  KV: KVNamespace
  API_VERSION: string
  KCI_API_TOKEN: string
  RATE_LIMIT_DEFAULT?: RateLimiter
  RATE_LIMIT_FARE?: RateLimiter
}

const app = new Hono<{ Bindings: Bindings }>()

/*
 * Open CORS, deliberately.
 *
 * Every mounted route is read-only public data, and the docs say so in as many
 * words: "Datanya bebas dipakai dan diolah, asal sumbernya tetap dicantumkan."
 * An origin allowlist contradicts that — it is the one restriction that stops
 * *only* browser JavaScript, so it blocked hobbyists building a map in a page
 * while doing nothing about curl, servers, apps or scrapers, which could always
 * read this API freely. It also meant every new consumer (data.commute, the
 * TransportForJakarta embed, the Commute Lite build on their `maps.` subdomain)
 * needed a deploy here before it could make a single request.
 *
 * What this is NOT: access control. That distinction is already stated where it
 * matters most — routes/sync.ts and routes/cache.ts are unmounted precisely
 * because CORS would not have protected them. Abuse is bounded by rateLimit()
 * below, which is origin-independent and therefore unaffected by this, and by
 * the cacheControl() TTLs plus KV read-through that keep repeat reads off D1.
 *
 * The cost this shifts is load, not risk: a popular site embedding the API puts
 * many client IPs on it at once, which per-IP limiting bounds only loosely. The
 * caching above is what absorbs that, and it is why this is safe to open now.
 *
 * `GET` and `OPTIONS` only. Nothing mounted mutates, so allowing `POST` would
 * advertise a capability that does not exist; if a mutating route is ever
 * mounted it must carry its own credentials rather than inherit trust from an
 * origin header a client controls.
 */
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'OPTIONS'],
  /*
   * Without this the browser hides Server-Timing from any cross-origin caller,
   * which is every caller we have — the web app is on its own domain. The
   * network panel would show the header arriving and refuse to surface it.
   */
  exposeHeaders: ['Server-Timing']
}))

/*
 * Caching and the abuse backstop, applied per group so each states its own
 * freshness rather than inheriting one global guess. Order matters: the limiter
 * runs first, so a rejected request never reaches a handler, and a 304 is
 * cheap for the caller precisely because the limiter already let it through.
 *
 * `/stations` carries the topology TTL rather than the timetable one even
 * though timetables hang beneath it — the tighter value is applied on those
 * subpaths below, and a more specific `app.use` wins by running second.
 */
app.use('/stations/*', rateLimit('DEFAULT'), cacheControl(MAX_AGE.TOPOLOGY))
app.use('/stations/:operator/:stationCode/timetable/*', cacheControl(MAX_AGE.TIMETABLE))
app.use('/hubs/*', rateLimit('DEFAULT'), cacheControl(MAX_AGE.TOPOLOGY))
app.use('/lines/*', rateLimit('DEFAULT'), cacheControl(MAX_AGE.STATIC))
app.use('/operators', rateLimit('DEFAULT'), cacheControl(MAX_AGE.STATIC))
app.use('/fares/*', rateLimit('FARE'), cacheControl(MAX_AGE.FARE))
/*
 * `/_internal` is not public, but it is as reachable as everything else, and
 * `/_internal/trips` runs findRoutes — strictly more work than the findRoute
 * behind `/fares`. It went un-shaped only while nothing linked to it; the beta
 * router switch on /fare is what changes that.
 *
 * The limiter is the weaker half here. Our own front ends are exempt by origin
 * (see EXEMPT_ORIGINS in middleware/rate-limit.ts), and one of them is the
 * TransportForJakarta embed — precisely the surface newly pointed at this
 * endpoint. So the limiter shapes scrapers, and `cacheControl` is what actually
 * spares the origin: 600s at the edge plus a 304 on revalidation.
 *
 * FARE on both counts covers `/_internal/searchables` too. That is fetched once
 * per app boot and served from KV, so 120/min is far above any rider, and 600s
 * is strictly better than the nothing it carried before.
 */
app.use('/_internal/*', rateLimit('FARE'), cacheControl(MAX_AGE.FARE))

app.route('stations', stations)
app.route('hubs', hubs)
app.route('lines', lines)
app.route('fares', fares)
app.route('operators', operatorRoutes)

/*
 * routes/sync.ts and routes/cache.ts are NOT mounted.
 *
 * They are operational tooling — re-importing an operator's stations and
 * timetables, and busting KV entries — and they were reachable by anyone with
 * curl: twelve mutating routes taking no credentials at all. CORS does nothing
 * here; it restrains browsers, not clients.
 *
 * The handlers stay in the repo because the work they do is still needed. To
 * run a sync, mount them again for as long as it takes, or give them a shared
 * secret first (KCI_API_TOKEN is the pattern already in this worker). Leaving
 * them mounted and unauthenticated was the one option worth ruling out.
 */
// Shaped for commute.shiorilabs.id only — see routes/internal.ts.
app.route('_internal', internalRoutes)

/*
 * Machine-readable description of the public read API.
 *
 * Only the read routes are described. `/_internal` is deliberately absent: it is
 * shaped around one consumer's screen and its response may change without
 * notice. The sync and cache routes are not merely undocumented — they are not
 * mounted at all (see above).
 */
app.get('/openapi.json', openAPIRouteHandler(app, {
  documentation: {
    info: {
      /*
       * One brand line: `Commute` is the rider app, `Commute Data Platform` is
       * the site this document is published on, and this is its interface. The
       * shared "Data" is what separates it from the consumer product — plain
       * `Commute API` read like a description rather than a name, and named
       * nothing in a generated client.
       *
       * This is public API surface: it becomes the class or namespace name in
       * every generated client, so changing it later is a breaking change for
       * anyone who has generated against it.
       */
      title: 'Commute Data API',
      version: '1.0.0',
      description: [
        'Data transit Jakarta dan Jabodetabek: stasiun, lin, pumpunan moda, jadwal, dan tarif dari Commuter Line (KCI), MRT Jakarta, LRT Jakarta, LRT Jabodebek, dan TransJakarta.',
        '',
        '### Bentuk response',
        'Semua response dibungkus object yang sama, baik berhasil maupun gagal. `status` mengikuti HTTP status code-nya. Kalau berhasil, yang terisi `data`. Kalau gagal, yang terisi `error`, lengkap dengan `code` yang bisa dibaca program.',
        '',
        '```json',
        '{ "status": 200, "data": { } }',
        '{ "status": 404, "error": { "code": "NOT_FOUND", "message": "Not found" } }',
        '```',
        '',
        '### Identifier',
        'Station ID bentuknya `{operatorCode}-{stationCode}`, misalnya `KCI-AC`. Kode stasiun cuma unik di dalam satu operator, jadi kebanyakan endpoint minta operator dan kodenya terpisah. Khusus buat cek tarif, pakai ID yang lengkap.',
        '',
        '### Autentikasi dan stabilitas',
        'Semua endpoint yang ada di sini tidak butuh autentikasi. Yang tidak didokumentasikan di sini bukan bagian dari API publik, terutama yang ada di bawah `/_internal`. Itu dibuat khusus buat commute.shiorilabs.id dan bisa berubah sewaktu-waktu tanpa pemberitahuan.',
        '',
        '### Lisensi',
        'Datanya pakai [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/): bebas dipakai dan diolah, asal sumbernya tetap dicantumkan dan hasil olahannya dibagi dengan lisensi yang sama. Kode aplikasinya sendiri MIT.',
        '',
        '### Baca versi web-nya',
        'Versi yang lebih enak dibaca ada di [data.commute.shiorilabs.id/docs](https://data.commute.shiorilabs.id/docs).'
      ].join('\n'),
      contact: { name: 'Commute', url: 'https://commute.shiorilabs.id' },
      /*
       * ODbL, not MIT.
       *
       * Strictly, info.license describes the API DESCRIPTION DOCUMENT rather
       * than the data it returns — but the thing a consumer of this API needs
       * to know is what they may do with Jakarta transit data, and that is
       * ODbL: attribute the source, share derived databases alike. The code in
       * this repo stays MIT (see LICENSE.md); the Lisensi section above states
       * both so the distinction is not left to inference.
       */
      license: { name: 'ODbL-1.0', identifier: 'ODbL-1.0' }
    },
    servers: [
      { url: 'https://api.commute.shiorilabs.id', description: 'Production' }
    ],
    // Declared empty on purpose: the documented read endpoints take no
    // credentials. Stating that beats leaving it unsaid.
    security: [],
    tags: [
      { name: 'Stasiun', description: 'Stasiun, jadwalnya, dan transfer antar stasiun.' },
      { name: 'Lin', description: 'Struktur lin, termasuk percabangan dan loop.' },
      { name: 'Pumpunan Moda', description: 'Kompleks interchange yang menggabungkan beberapa stasiun.' },
      { name: 'Tarif', description: 'Tarif dan rute antara dua stasiun.' },
      { name: 'Operator', description: 'Operator transit dan lin yang mereka jalankan.' }
    ]
  },
  excludeStaticFile: true,
  // Mutations and internal endpoints stay out of the published surface.
  // sync and cache are unmounted rather than excluded, but the patterns stay:
  // they cost nothing and mean remounting the handlers cannot silently publish
  // twelve mutating routes into the public document.
  exclude: [/^\/sync/, /^\/cache/, /^\/_internal/]
}))

/*
 * There is no /docs route here on purpose.
 *
 * The human-readable reference lives at data.commute.shiorilabs.id/docs, built
 * from this same document at deploy time. It replaced a Scalar page that pulled
 * 3.55 MB of JavaScript from a third-party CDN to render a 45 KB spec; the
 * static version ships ~0.5 KB and needs no CDN at all.
 *
 * This worker still serves /openapi.json, which is what tooling and client
 * generators want.
 */

export default app
