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

export const OperatorCodeSchema = v.pipe(
  v.picklist(operatorCodes),
  v.title('Operator code'),
  v.description('Transit operator. `NUL` is an internal placeholder and never appears in responses.'),
  v.metadata({ examples: ['KCI', 'MRTJ'] })
)

export const RegionCodeSchema = v.pipe(
  v.picklist(regionCodes),
  v.title('Region code'),
  v.description('Region, named for the nearest major airport\'s IATA code. `CGK` is Jabodetabek.'),
  v.metadata({ examples: ['CGK'] })
)

export const AmenityTypeSchema = v.pipe(
  v.picklist(amenityTypes),
  v.title('Amenity type'),
  v.metadata({ examples: ['TOILET', 'ELEVATOR_PAID'] })
)

export const AmenitySchema = v.pipe(
  v.object({
    type: AmenityTypeSchema,
    // Free-text qualifier, e.g. which concourse a lift serves.
    text: v.optional(v.string())
  }),
  v.title('Amenity')
)

export const OperatorSchema = v.pipe(
  v.object({
    code: OperatorCodeSchema,
    name: v.pipe(v.string(), v.metadata({ examples: ['Commuter Line'] }))
  }),
  v.title('Operator')
)

export const LineSchema = v.pipe(
  v.object({
    name: v.pipe(v.string(), v.metadata({ examples: ['Lin Cikarang'] })),
    lineCode: v.pipe(v.string(), v.metadata({ examples: ['C'] })),
    colorCode: v.pipe(
      v.string(),
      v.description('Hex colour used for this line\'s roundel and branding.'),
      v.metadata({ examples: ['#25B8EB'] })
    )
  }),
  v.title('Line')
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
  v.description('`OPERATOR:CODE`, resolved against the line dictionary from `/operators`.'),
  v.metadata({ examples: ['KCI:C', 'MRTJ:M'] })
)

export const ErrorSchema = v.pipe(
  v.object({
    code: v.pipe(
      v.string(),
      v.description('Machine-readable error code, e.g. `SAME_STATION`, `NOT_FOUND`.'),
      v.metadata({ examples: ['NOT_FOUND'] })
    ),
    message: v.pipe(v.string(), v.metadata({ examples: ['Not found'] }))
  }),
  v.title('Error')
)

/*
 * Every response is wrapped in this envelope — success and failure alike. The
 * HTTP status is mirrored in `status`. On success `data` is present and `error`
 * absent; on failure the reverse.
 */
export function Envelope<T extends v.GenericSchema>(data: T) {
  return v.object({
    status: v.pipe(v.number(), v.description('Mirrors the HTTP status code.'), v.metadata({ examples: [200] })),
    data: v.optional(data),
    error: v.optional(ErrorSchema)
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
export type ApiError = v.InferOutput<typeof ErrorSchema>
export type ErrorResponse = v.InferOutput<typeof ErrorResponseSchema>

/*
 * The envelope's inferred type. `Envelope()` is a function so its return type
 * varies per payload; this mirrors it for callers that just want the shape.
 * Matches apps/api/src/models/response.ts.
 */
export interface StandardResponse<T = unknown> {
  status: number
  data?: T
  error?: ApiError
}
