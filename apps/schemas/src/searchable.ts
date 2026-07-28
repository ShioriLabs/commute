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

export const SearchableTypeSchema = v.picklist(['STATION', 'LINE', 'HUB', 'OPERATOR'])

export const SearchableSchema = v.pipe(
  v.object({
    type: SearchableTypeSchema,
    title: v.pipe(v.string(), v.metadata({ examples: ['Dukuh Atas'] })),
    to: v.pipe(v.string(), v.description('Link relatif ke aplikasi buat hasil ini.'), v.metadata({ examples: ['/stations/KCI/AC'] })),
    keywords: v.pipe(
      v.array(v.string()),
      v.description('Target pencocokan dalam huruf kecil. Dibangun di server karena sebagiannya nggak bisa diturunkan dari judul: kode stasiun anggota pumpunan moda, dan nama pasangan halte berarah yang digabung.')
    ),
    subtitle: v.optional(v.string()),
    body: v.pipe(
      v.optional(v.array(v.string())),
      v.description('Key ke kamus `lines` di response ini, pakai awalan operator ("KCI:C").')
    ),
    data: v.pipe(
      v.optional(v.record(v.string(), v.string())),
      v.description('Identifier buat data aslinya: `station-id` atau `hub-id`.')
    ),
    operator: v.pipe(
      v.optional(OperatorCodeSchema),
      v.description('Nggak ada di pumpunan moda, yang mencakup beberapa operator.')
    ),
    score: v.pipe(
      v.optional(v.number()),
      v.description('Popularitas. Dihilangkan kalau 0; baca aja pakai `?? 0`.')
    )
  }),
  v.title('Searchable')
)

export const SearchableLineSchema = v.pipe(
  v.object({
    name: v.string(),
    lineCode: v.pipe(v.string(), v.description('Kode polos, buat glyph di roundel. Key kamusnya sendiri pakai awalan operator.')),
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
 * `body` is line keys on the wire, but the web app rehydrates it into Line[]
 * before rendering — hence the type parameter, which matches how the search
 * sheet has always consumed this.
 */
export type Searchable<BodyType = unknown> =
  Omit<v.InferOutput<typeof SearchableSchema>, 'body'> & { body?: BodyType }

/** The wire shape, before the client resolves `body` against the dictionary. */
export type RawSearchable = v.InferOutput<typeof SearchableSchema>
