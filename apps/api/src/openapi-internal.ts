import { Hono } from 'hono'
import { generateSpecs } from 'hono-openapi'
import { SearchableIndexSchema, TripResultSchema } from '@commute/schemas'
import app, { documentation } from './app'
import { doc, pathParam, queryParam } from './schemas/describe'

/*
 * The public document with the `/_internal` routes left in.
 *
 * For Commute's own clients, which build against `/_internal` and generate their
 * wire models from a document rather than typing them by hand: the Android app
 * checks a snapshot of this in (`pnpm openapi:internal`). It carries the same "no
 * compatibility promise" as the routes it describes, and it is not the published
 * API. That is /openapi.json alone.
 *
 * Built here, and written to a file by a script, rather than annotated on the
 * handlers and served. Two things in hono-openapi rule out the obvious version:
 *
 *   - It collects components from every annotated route BEFORE applying
 *     `exclude`. Annotate the real /_internal/searchables and its schemas are
 *     published as components of /openapi.json, excluded path or not.
 *   - It resolves each schema's components once per process. A second document
 *     generated in the same worker comes back with its paths and no components,
 *     so whichever of two served documents was requested second would be broken.
 *
 * So the annotations live on a shadow app that exists only to be described, and
 * this runs once, in a process of its own.
 */
export async function buildInternalDocument() {
  const described = new Hono()

  // Carries every public route's annotations along, so the internal document is
  // a superset of the public one and a client needs only the one snapshot.
  described.route('/', app)

  // Described, never called: `app` above already serves the real handler.
  described.get(
    '/_internal/searchables',
    doc({
      summary: 'Indeks pencarian',
      description: 'Semua yang bisa dicari dalam satu response: stasiun, pumpunan moda, dan lin, plus kamus lin yang dirujuk tiap entri.',
      tag: 'Internal',
      data: SearchableIndexSchema
    }),
    c => c.body(null)
  )

  // Described, never called: the real handler is routes/internal.ts.
  described.get(
    '/_internal/trips/:from/:to',
    doc({
      summary: 'Beberapa pilihan rute antara dua stasiun',
      description: 'Sama seperti `/fares/{from}/{to}`, tapi menjawab dengan beberapa `journeys`, masing-masing dengan tarif, label, dan jam berangkat/tiba tiap kaki perjalanan kalau jadwalnya ada.',
      tag: 'Internal',
      data: TripResultSchema,
      parameters: [
        pathParam('from', 'Station id asal, `{operator}-{code}`.', 'KCI-SUD'),
        pathParam('to', 'Station id tujuan.', 'MRTJ-LBB'),
        queryParam('paymentMethod', 'Menentukan tarif mana yang dipakai. Default-nya tarif kartu uang elektronik biasa.'),
        queryParam('at', 'Timestamp ISO 8601 buat perjalanannya. Default-nya waktu sekarang.', '2026-07-28T08:00:00Z'),
        queryParam('modes', '`rail` buat rute tanpa TransJakarta. Default-nya semua moda.', 'rail'),
        queryParam('walking', 'Kecepatan jalan kaki: `BRISK`, `AVERAGE`, `SLOW`, atau `SLOWEST`. Default-nya `AVERAGE`.', 'SLOW')
      ],
      errors: {
        404: 'Salah satu stasiunnya tidak ditemukan, tidak ada rute di antara keduanya (`NO_ROUTE`), layanannya sudah tutup (`CLOSED`), atau asal dan tujuannya sama (`SAME_STATION`).',
        500: 'Perhitungan tarif gagal (`DATABASE_ERROR`).'
      }
    }),
    c => c.body(null)
  )

  return generateSpecs(described, {
    documentation: {
      ...documentation,
      tags: [
        ...documentation.tags,
        { name: 'Internal', description: 'Dibentuk khusus buat klien Commute sendiri. Bisa berubah tanpa pemberitahuan.' }
      ]
    },
    excludeStaticFile: true,
    exclude: [/^\/sync/, /^\/cache/]
  })
}
