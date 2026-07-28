import { AMENITY_TYPES, OPERATORS, REGIONS } from '@commute/constants'
import * as v from 'valibot'

/*
 * Valibot schemas describing the public API's responses, used to generate the
 * OpenAPI document served at /openapi.json.
 *
 * These are DESCRIPTIVE, not enforcing. Nothing here validates a response at
 * runtime — the routes return exactly what they always have. If a schema and a
 * handler disagree, the handler is right and the schema is a bug.
 *
 * Keep them mirroring the TypeScript types they document (models/*.ts,
 * db/schemas/*.ts); the enums below are derived from @commute/constants so a new
 * operator or amenity can't silently drift out of the docs.
 */

const operatorCodes = Object.keys(OPERATORS).filter(code => code !== 'NUL')
const regionCodes = Object.keys(REGIONS).filter(code => code !== 'NUL')

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
  v.picklist(Object.keys(AMENITY_TYPES)),
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
