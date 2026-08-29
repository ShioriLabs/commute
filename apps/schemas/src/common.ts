import { AMENITY_TYPES, OPERATORS, REGIONS } from '@commute/constants'
import type { AmenityType as ConstantAmenityType, Operator as OperatorCodeConst, RegionCode as RegionCodeConst } from '@commute/constants'
import * as v from 'valibot'

/*
 * Valibot schemas for the Commute API's response shapes — the single definition
 * both apps work from.
 *
 * The API pipes them into the OpenAPI document at /openapi.json; the web app
 * imports the inferred TypeScript types (`import type { Station }`), so Valibot
 * itself stays out of the browser bundle unless a call site opts into `v.parse`.
 *
 * These describe what the API returns; they do not enforce it. No route
 * validates its own response against them. If a schema and a handler disagree,
 * the handler is right and the schema is the bug — schemas.live.test.ts checks
 * exactly that against production.
 *
 * The enums are derived from @commute/constants, so a new operator or amenity
 * can't silently drift out of the docs.
 */

/*
 * Derived from @commute/constants so a new operator, region or amenity can't
 * drift out of the docs. Cast back to the constants' own key unions —
 * Object.keys widens to string[], which would erase the union from every
 * inferred type downstream.
 */
const operatorCodes = Object.keys(OPERATORS).filter(code => code !== 'NUL') as Exclude<OperatorCodeConst, 'NUL'>[]
const regionCodes = Object.keys(REGIONS).filter(code => code !== 'NUL') as Exclude<RegionCodeConst, 'NUL'>[]
const amenityTypes = Object.keys(AMENITY_TYPES) as ConstantAmenityType[]

/*
 * `KCI: Commuter Line · MRTJ: MRT Jakarta · …`
 *
 * An enum of opaque codes documents nothing on its own: the reader learns that
 * `MRTJ` is legal and still has to call /operators to find out it means MRT
 * Jakarta. Folding the labels into the description puts them in the document
 * itself, so generated clients and the reference page both get them for free.
 *
 * Generated from the constants rather than typed out, so a new operator or
 * amenity cannot appear in the enum while going unexplained here.
 */
const glossary = (labels: Record<string, string>, codes: readonly string[]): string =>
  codes.map(code => `\`${code}\`: ${labels[code] ?? code}`).join(' · ')

const NAMED = <T extends Record<string, { name: string }>>(source: T): Record<string, string> =>
  Object.fromEntries(Object.entries(source).map(([code, { name }]) => [code, name]))

export const OperatorCodeSchema = v.pipe(
  v.picklist(operatorCodes),
  v.title('Operator code'),
  v.description(
    `Operator transit. ${glossary(NAMED(OPERATORS), operatorCodes)}. `
    + '`NUL` cuma placeholder internal dan tidak pernah muncul di response.'
  ),
  v.metadata({ examples: ['KCI', 'MRTJ'] })
)

export const RegionCodeSchema = v.pipe(
  v.picklist(regionCodes),
  v.title('Region code'),
  v.description(
    `Wilayah, dinamai dari kode IATA bandara besar terdekat. ${glossary(NAMED(REGIONS), regionCodes)}.`
  ),
  v.metadata({ examples: ['CGK'] })
)

export const AmenityTypeSchema = v.pipe(
  v.picklist(amenityTypes),
  v.title('Amenity type'),
  v.description(`Fasilitas yang ada di stasiun. ${glossary(AMENITY_TYPES, amenityTypes)}.`),
  v.metadata({ examples: ['TOILET', 'ELEVATOR_PAID'] })
)

export const AmenitySchema = v.pipe(
  v.object({
    type: AmenityTypeSchema,
    // Free-text qualifier, e.g. which concourse a lift serves.
    text: v.optional(v.string())
  }),
  v.title('Amenity'),
  v.description('Satu fasilitas yang ada di stasiun, kadang dengan keterangan lokasinya.'),
  v.metadata({ ref: 'Amenity' })
)

/*
 * Mode of transport, named after the GTFS `route_type` it corresponds to:
 * RAIL = 2, SUBWAY = 1, TRAM = 0, BUS = 3, MONORAIL = 12. The name is carried
 * rather than the integer because it survives being read by a human.
 */
export const TransitModeSchema = v.pipe(
  v.picklist(['RAIL', 'SUBWAY', 'TRAM', 'BUS', 'MONORAIL']),
  v.title('TransitMode'),
  v.description('Moda transportasinya, mengikuti `route_type` di GTFS: `RAIL` (2), `SUBWAY` (1), `TRAM` (0), `BUS` (3), `MONORAIL` (12).'),
  v.metadata({ examples: ['RAIL'], ref: 'TransitMode' })
)

export const OperatorSchema = v.pipe(
  v.object({
    code: OperatorCodeSchema,
    name: v.pipe(v.string(), v.metadata({ examples: ['Commuter Line'] }))
  }),
  v.title('Operator'),
  v.description('Operator transit yang menjalankan lin dan stasiun.'),
  v.metadata({ ref: 'Operator' })
)

/*
 * The operator plus the `agency.txt` fields, as served by /operators.
 *
 * Kept separate from OperatorSchema because most responses embed an operator
 * only to name it — a station does not need to restate the agency's timezone
 * on every row. The full form appears where an operator is the subject.
 *
 * Its `entries` are spread into OperatorWithLines rather than referenced, so
 * these fields appear inline on the one response that carries them instead of
 * as a second component a client has to follow. No `ref` metadata for that
 * reason: nothing emits this schema under its own name.
 */
export const OperatorDetailSchema = v.pipe(
  v.object({
    code: OperatorCodeSchema,
    name: v.pipe(v.string(), v.metadata({ examples: ['Commuter Line'] })),
    url: v.pipe(
      v.string(),
      v.description('Situs resmi operatornya. Sama dengan `agency_url` di GTFS.'),
      v.metadata({ examples: ['https://kci.id/'] })
    ),
    timezone: v.pipe(
      v.string(),
      v.description('Zona waktu yang dipakai semua jadwal operator ini. Sama dengan `agency_timezone` di GTFS, dan selalu `Asia/Jakarta` di sini.'),
      v.metadata({ examples: ['Asia/Jakarta'] })
    ),
    lang: v.pipe(
      v.string(),
      v.description('Bahasa yang dipakai buat nama stasiun dan lin. Sama dengan `agency_lang` di GTFS.'),
      v.metadata({ examples: ['id'] })
    ),
    mode: TransitModeSchema
  }),
  v.title('OperatorDetail'),
  v.description('Operator transit lengkap dengan metadata gaya GTFS `agency.txt`.')
)

export const LineSchema = v.pipe(
  v.object({
    name: v.pipe(v.string(), v.metadata({ examples: ['Lin Cikarang'] })),
    lineCode: v.pipe(v.string(), v.metadata({ examples: ['C'] })),
    colorCode: v.pipe(
      v.string(),
      v.description('Warna hex buat roundel dan branding lin ini.'),
      v.metadata({ examples: ['#25B8EB'] })
    ),
    /*
     * Optional because `Line` is the shape every producer of a line uses, and
     * not all of them carry a mode: /_internal/searchables ships a trimmed
     * SearchableLine for the roundel and has no reason to know the mode. The
     * line dictionary from /operators always sets it (utils/line.ts fills it
     * from the operator), which is where a client should resolve modes anyway.
     */
    mode: v.optional(TransitModeSchema),
    /*
     * Optional for the same reason as `mode`: trimmed producers of a Line
     * (SearchableLine) have no use for it. The dictionary from /operators
     * always sets it.
     */
    searchable: v.optional(v.pipe(
      v.boolean(),
      v.description('False kalau lin ini cuma dipakai buat routing dan sengaja disembunyikan dari pencarian dan sitemap. Lin seperti ini tetap ada di kamus lin, karena stasiun masih merujuk ke sana, tapi halaman detailnya belum tersedia.')
    ))
  }),
  v.title('Line'),
  v.description('Satu lin, dengan kode dan warna yang dipakai di roundel-nya.'),
  v.metadata({ ref: 'Line' })
)

/*
 * A reference to a line, as `OPERATOR:CODE`.
 *
 * Responses carry keys rather than embedded Line objects: a line's name and
 * colour are the same everywhere it appears, and repeating them across hundreds
 * of stations made the payload mostly duplication. Resolve them against the
 * dictionary from `/operators`, which every client already needs.
 *
 * Qualified by operator because codes are only unique within one — TransJakarta
 * corridors are bare numerals that would otherwise collide.
 */
export const LineKeySchema = v.pipe(
  v.string(),
  v.title('Line key'),
  v.description('`OPERATOR:CODE`, dicocokkan ke kamus lin dari `/operators`.'),
  v.metadata({ examples: ['KCI:C', 'MRTJ:M'] })
)

export const ErrorSchema = v.pipe(
  v.object({
    code: v.pipe(
      v.string(),
      v.description('Kode error yang bisa dibaca mesin, misalnya `SAME_STATION`, `NOT_FOUND`.'),
      v.metadata({ examples: ['NOT_FOUND'] })
    ),
    message: v.pipe(v.string(), v.metadata({ examples: ['Not found'] }))
  }),
  v.title('Error'),
  v.description('Isi `error` waktu request-nya gagal.'),
  v.metadata({ ref: 'Error' })
)

/*
 * A successful response. `status` mirrors the HTTP status code and `data` holds
 * the payload.
 *
 * `error` is deliberately absent: a 2xx never carries one, and declaring it
 * optional here made the documented 200 shape show an `error` object beside
 * `data` — describing a response the API cannot produce. Failures are
 * ErrorResponseSchema, attached to the 4xx/5xx statuses instead.
 */
export function Envelope<T extends v.GenericSchema>(data: T) {
  return v.object({
    status: v.pipe(v.number(), v.description('Sama dengan HTTP status code-nya.'), v.metadata({ examples: [200] })),
    data
  })
}

/** Envelope for a failure: `error` set, `data` absent. */
export const ErrorResponseSchema = v.pipe(
  v.object({
    status: v.pipe(v.number(), v.metadata({ examples: [404] })),
    error: ErrorSchema
  }),
  v.title('ErrorResponse')
)

export type OperatorCode = v.InferOutput<typeof OperatorCodeSchema>
export type RegionCode = v.InferOutput<typeof RegionCodeSchema>
export type AmenityType = v.InferOutput<typeof AmenityTypeSchema>
export type Amenity = v.InferOutput<typeof AmenitySchema>
export type Operator = v.InferOutput<typeof OperatorSchema>
/*
 * `colorCode` is narrowed to a `#`-prefixed literal in the TYPE only, not the
 * schema. A `v.custom` validator would satisfy TypeScript but drop
 * `"type": "string"` from the generated OpenAPI document — trading the docs'
 * correctness for a compile-time nicety. This keeps both: honest JSON Schema for
 * consumers, strict types for us.
 *
 * `HexColored` applies that narrowing recursively, since `Line` is nested inside
 * Station, Hub, LineDetail and the searchables index.
 */
export type HexColored<T> =
  // Tuples first: the array branch below would widen a fixed-length tuple like
  // CompactSchedule ([string | null, number]) into a plain array.
  T extends readonly [unknown, ...unknown[]] ? { [K in keyof T]: HexColored<T[K]> }
    : T extends (infer U)[] ? HexColored<U>[]
      : T extends object
        ? { [K in keyof T]: K extends 'colorCode' ? `#${string}` : HexColored<T[K]> }
        : T

export type Line = HexColored<v.InferOutput<typeof LineSchema>>
export type LineKey = v.InferOutput<typeof LineKeySchema>
export type APIError = v.InferOutput<typeof ErrorSchema>
export type ErrorResponse = v.InferOutput<typeof ErrorResponseSchema>

/*
 * The envelope as a CLIENT sees it, across every status.
 *
 * A discriminated union rather than one object with two optional fields: the
 * API sends `data` or `error`, never both and never neither, and the type now
 * says so. `error?: never` on the success arm is what does the discriminating —
 * without it, an object carrying both fields would still satisfy the type.
 *
 * Narrow before reading the payload; TypeScript resolves the other field:
 *
 *   if (response.error) return response.error.message
 *   return response.data
 *
 * Optional chaining (`response.data?.name`) still works on the union, so this
 * is not a breaking change for existing call sites.
 *
 * Mirrors apps/api/src/models/response.ts.
 */
export interface SuccessResponse<T = unknown> {
  status: number
  data: T
  error?: never
}

export interface FailureResponse {
  status: number
  data?: never
  error: APIError
}

export type StandardResponse<T = unknown> = SuccessResponse<T> | FailureResponse
