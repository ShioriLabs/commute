import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { openAPIRouteHandler } from 'hono-openapi'

import stations from './routes/stations'
import hubs from './routes/hubs'
import lines from './routes/lines'
import fares from './routes/fares'
import syncRoutes from './routes/sync'
import cacheRoutes from './routes/cache'
import operatorRoutes from './routes/operators'
import internalRoutes from './routes/internal'

export interface Bindings {
  DB: D1Database
  KV: KVNamespace
  API_VERSION: string
  KCI_API_TOKEN: string
}

const app = new Hono<{ Bindings: Bindings }>()

const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'https://commute.shiorilabs.id',
  'https://dev.commute.shiorilabs.id',
  'https://data.commute.shiorilabs.id',
  'https://transportforjakarta.or.id'
])

app.use('*', cors({
  origin(origin) {
    return ALLOWED_ORIGINS.has(origin) ? origin : null
  },
  allowMethods: ['GET', 'POST', 'OPTIONS']
}))

app.route('stations', stations)
app.route('hubs', hubs)
app.route('lines', lines)
app.route('fares', fares)
app.route('sync/stations', syncRoutes)
app.route('cache', cacheRoutes)
app.route('operators', operatorRoutes)
// Shaped for commute.shiorilabs.id only — see routes/internal.ts.
app.route('_internal', internalRoutes)

/*
 * Machine-readable description of the public read API.
 *
 * Only the read routes are described. The sync and cache mounts are deliberately
 * absent: they mutate data and are not for third-party use. `/_internal` is
 * absent for the same reason — it is shaped around one consumer's screen and its
 * response may change without notice.
 */
app.get('/openapi.json', openAPIRouteHandler(app, {
  documentation: {
    info: {
      title: 'Commute API',
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
        '### Baca versi web-nya',
        'Versi yang lebih enak dibaca ada di [data.commute.shiorilabs.id/docs](https://data.commute.shiorilabs.id/docs).'
      ].join('\n'),
      contact: { name: 'Commute', url: 'https://commute.shiorilabs.id' },
      license: { name: 'MIT', identifier: 'MIT' }
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
