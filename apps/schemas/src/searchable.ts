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
    to: v.pipe(v.string(), v.description('App-relative link for this result.'), v.metadata({ examples: ['/stations/KCI/AC'] })),
    keywords: v.pipe(
      v.array(v.string()),
      v.description('Lowercased match targets. Built server-side because several cannot be derived from the title: hub member codes, and the folded-away names of directional halte pairs.')
    ),
    subtitle: v.optional(v.string()),
    body: v.pipe(
      v.optional(v.array(v.string())),
      v.description('Keys into the response\'s `lines` dictionary, operator-qualified ("KCI:C").')
    ),
    data: v.pipe(
      v.optional(v.record(v.string(), v.string())),
      v.description('Identifiers for the underlying record — `station-id` or `hub-id`.')
    ),
    operator: v.pipe(
      v.optional(OperatorCodeSchema),
      v.description('Absent on hubs, which span operators.')
    ),
    score: v.pipe(
      v.optional(v.number()),
      v.description('Popularity. Omitted when 0; read it as `?? 0`.')
    )
  }),
  v.title('Searchable')
)

export const SearchableLineSchema = v.pipe(
  v.object({
    name: v.string(),
    lineCode: v.pipe(v.string(), v.description('Bare code, for the roundel glyph — the dictionary key is operator-qualified.')),
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
