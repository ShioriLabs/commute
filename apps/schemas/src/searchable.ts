import * as v from 'valibot'
import type { HexColored } from './common'
import { OperatorCodeSchema } from './common'

/*
 * The prebuilt search index served by GET /_internal/searchables.
 *
 * Deliberately absent from the public OpenAPI document: `_internal` is shaped
 * around commute.shiorilabs.id's search sheet and carries no compatibility
 * promise. It lives here anyway so the one consumer that does use it shares the
 * same definition as the endpoint producing it.
 */

export const SearchableTypeSchema = v.picklist(['STATION', 'LINE', 'HUB'])

/*
 * Fields every entry carries, whatever it points at. The per-type fields —
 * which lines it shows, whether it has one operator — live on the variants
 * below, because they genuinely differ.
 */
const searchableBase = {
  title: v.pipe(v.string(), v.metadata({ examples: ['Dukuh Atas'] })),
  to: v.pipe(v.string(), v.description('Link relatif ke aplikasi buat hasil ini.'), v.metadata({ examples: ['/stations/KCI/AC'] })),
  keywords: v.pipe(
    v.array(v.string()),
    v.description('Target pencocokan dalam huruf kecil. Dibuat di server karena sebagiannya tidak bisa diturunkan dari judul saja, seperti kode stasiun anggota pumpunan moda dan nama halte berarah yang sudah digabung.')
  ),
  subtitle: v.optional(v.string()),
  data: v.pipe(
    v.optional(v.record(v.string(), v.string())),
    v.description('Identifier buat data aslinya, `station-id` atau `hub-id`. Halte berarah yang digabung juga bawa `station-ids`: semua anggotanya, dipisah koma, primary di depan. Cuma ada kalau memang ada yang digabung.')
  ),
  score: v.pipe(
    v.optional(v.number()),
    v.description('Seberapa ramai (0-100): jumlah penumpang beneran kalau operatornya merilis, selain itu perkiraan dari frekuensi kereta dan bentuk jaringan. Tidak dikirim kalau nilainya 0, jadi baca pakai `?? 0`.')
  )
}

const lineKeysDescription = 'Key ke kamus `lines` di response ini, pakai awalan operator ("KCI:C").'

export const SearchableStationSchema = v.pipe(
  v.object({
    ...searchableBase,
    type: v.literal('STATION'),
    operator: OperatorCodeSchema,
    lineKeys: v.pipe(v.array(v.string()), v.description(`Lin yang berhenti di stasiun ini. ${lineKeysDescription}`))
  }),
  v.title('SearchableStation')
)

export const SearchableHubSchema = v.pipe(
  v.object({
    ...searchableBase,
    type: v.literal('HUB'),
    // No `operator`: one pumpunan moda can span several.
    lineKeys: v.pipe(v.array(v.string()), v.description(`Gabungan lin dari semua anggotanya. ${lineKeysDescription}`))
  }),
  v.title('SearchableHub')
)

export const SearchableLineEntrySchema = v.pipe(
  v.object({
    ...searchableBase,
    type: v.literal('LINE'),
    operator: OperatorCodeSchema,
    // Singular on purpose: a line entry IS one line, and carrying it as a
    // one-element list is what let a consumer read fields off the array.
    lineKey: v.pipe(v.string(), v.description(`Lin yang diwakili entri ini. ${lineKeysDescription}`))
  }),
  // Not 'SearchableLine' — that title belongs to the dictionary entry below.
  v.title('SearchableLineEntry')
)

/*
 * Discriminated on `type` so each variant states exactly what it carries.
 *
 * `body` used to be one field meaning three things — the lines serving a
 * station/hub, or (array-wrapped) the line an entry represented. A consumer
 * read `.colorCode` off the array for a LINE, got undefined, and crashed the
 * search sheet. Splitting it into `lineKeys` and `lineKey` makes that
 * unrepresentable rather than merely documented.
 *
 * `OPERATOR` was in the old picklist but nothing ever built one; add a variant
 * back when something does.
 */
export const SearchableSchema = v.pipe(
  v.variant('type', [SearchableStationSchema, SearchableHubSchema, SearchableLineEntrySchema]),
  v.title('Searchable')
)

export const SearchableLineSchema = v.pipe(
  v.object({
    name: v.string(),
    lineCode: v.pipe(v.string(), v.description('Kode polosnya, buat ditulis di dalam roundel. Key kamusnya sendiri pakai awalan operator.')),
    colorCode: v.string(),
    operator: OperatorCodeSchema
  }),
  v.title('SearchableLine')
)

export const SearchableIndexSchema = v.pipe(
  v.object({
    lines: v.pipe(
      v.record(v.string(), SearchableLineSchema),
      v.description('Every line referenced by any item, keyed "OPERATOR:CODE" and sent once rather than repeated per entry.')
    ),
    items: v.array(SearchableSchema)
  }),
  v.title('SearchableIndex')
)

export type SearchableType = v.InferOutput<typeof SearchableTypeSchema>
export type SearchableLine = HexColored<v.InferOutput<typeof SearchableLineSchema>>
export type SearchableIndex = HexColored<v.InferOutput<typeof SearchableIndexSchema>>

/*
 * The wire shapes, carrying dictionary KEYS. The client swaps those for
 * resolved lines (see `Searchable` below) before anything renders.
 */
export type RawSearchableStation = v.InferOutput<typeof SearchableStationSchema>
export type RawSearchableHub = v.InferOutput<typeof SearchableHubSchema>
export type RawSearchableLine = v.InferOutput<typeof SearchableLineEntrySchema>
export type RawSearchable = v.InferOutput<typeof SearchableSchema>

/*
 * The resolved shapes components consume: the same entries with their line
 * keys swapped for the lines themselves.
 *
 * Kept as a union rather than one shape with an optional field, so narrowing on
 * `type` proves what an entry carries. A station always has one operator; a hub
 * spans several and has none; a LINE carries exactly ONE line, not a list.
 */
export type ResolvedSearchableStation =
  Omit<RawSearchableStation, 'lineKeys'> & { lines: SearchableLine[] }
export type ResolvedSearchableHub =
  Omit<RawSearchableHub, 'lineKeys'> & { lines: SearchableLine[] }
export type ResolvedSearchableLine =
  Omit<RawSearchableLine, 'lineKey'> & { line: SearchableLine }

export type Searchable =
  | ResolvedSearchableStation
  | ResolvedSearchableHub
  | ResolvedSearchableLine
