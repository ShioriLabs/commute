import * as v from 'valibot'
import { LineKeySchema, OperatorCodeSchema } from './common'

export const FareStationSchema = v.pipe(
  v.object({
    id: v.pipe(v.string(), v.metadata({ examples: ['KCI-SUD'] })),
    name: v.pipe(v.string(), v.metadata({ examples: ['Sudirman'] }))
  }),
  v.title('FareStation')
)

export const LineRefSchema = v.pipe(
  v.object({
    line: LineKeySchema,
    headsign: v.pipe(
      v.nullable(v.string()),
      v.description('Terminus this particular service heads toward.')
    )
  }),
  v.title('FareLineRef')
)

export const RideLegSchema = v.pipe(
  v.object({
    type: v.literal('RIDE'),
    // A line key; its name and colour resolve against /operators, as everywhere
    // else. `operator` is kept because it is the leg's own fact, not the line's.
    line: LineKeySchema,
    operator: OperatorCodeSchema,
    from: FareStationSchema,
    to: FareStationSchema,
    stationCount: v.pipe(v.number(), v.description('Number of stations travelled, endpoints included.')),
    stops: v.pipe(v.array(FareStationSchema), v.description('Full ordered station list, boarding to alighting.')),
    headsign: v.pipe(
      v.nullable(v.string()),
      v.description('Terminus the service heads toward; null where it cannot be determined.')
    ),
    distanceM: v.number(),
    serviceLines: v.pipe(
      v.optional(v.array(LineRefSchema)),
      v.description('Present only on interlined track served by several lines — any of them gets the rider there. Includes the primary line first.')
    )
  }),
  v.title('FareRideLeg')
)

export const TransferLegSchema = v.pipe(
  v.object({
    type: v.literal('TRANSFER'),
    from: FareStationSchema,
    to: FareStationSchema,
    distanceM: v.pipe(v.number(), v.description('Walking distance in metres.')),
    fare: v.pipe(
      v.optional(v.number()),
      v.description('Present only for paid corridors; ordinary walking transfers are free and omit this.')
    ),
    corridorLabel: v.optional(v.string())
  }),
  v.title('FareTransferLeg')
)

export const FareLegSchema = v.pipe(
  v.variant('type', [RideLegSchema, TransferLegSchema]),
  v.title('FareLeg'),
  v.description('A single stage of the journey. Discriminated on `type`.')
)

export const FareSegmentSchema = v.pipe(
  v.object({
    operator: OperatorCodeSchema,
    // Nested from/to, like every other station reference in the API, rather
    // than four flat fromStationId/fromName/toStationId/toName fields.
    from: FareStationSchema,
    to: FareStationSchema,
    fare: v.pipe(
      v.nullable(v.number()),
      v.description('Fare for this segment, in rupiah; null where it cannot be determined.')
    )
  }),
  v.title('FareSegment'),
  v.description('A billed portion of the journey. Operators charge per continuous run on their own network, so segments and legs do not map one-to-one.')
)

export const FareResultSchema = v.pipe(
  v.object({
    from: FareStationSchema,
    to: FareStationSchema,
    legs: v.pipe(v.array(FareLegSchema), v.description('The journey as a rider experiences it: rides and the transfers between them.')),
    segments: v.pipe(v.array(FareSegmentSchema), v.description('The journey as it is charged.')),
    totalFare: v.pipe(
      v.nullable(v.number()),
      v.description('Total in rupiah, after any integrated-fare capping. Null when a fare cannot be computed for this pair.'),
      v.metadata({ examples: [14000] })
    ),
    totalDistanceM: v.number(),
    transferCount: v.number()
  }),
  v.title('FareResult')
)

export type FareStation = v.InferOutput<typeof FareStationSchema>
export type FareLineRef = v.InferOutput<typeof LineRefSchema>
export type FareRideLeg = v.InferOutput<typeof RideLegSchema>
export type FareTransferLeg = v.InferOutput<typeof TransferLegSchema>
export type FareLeg = v.InferOutput<typeof FareLegSchema>
export type FareSegment = v.InferOutput<typeof FareSegmentSchema>
export type FareResult = v.InferOutput<typeof FareResultSchema>

/* Aliases matching the web app's long-standing names for these shapes. */
export type FareResultStation = FareStation
export type FareResultLineRef = FareLineRef
export type FareResultRideLeg = FareRideLeg
export type FareResultTransferLeg = FareTransferLeg
export type FareResultLeg = FareLeg
export type FareResultSegment = FareSegment
