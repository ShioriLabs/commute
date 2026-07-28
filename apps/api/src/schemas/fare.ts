import * as v from 'valibot'
import { OperatorCodeSchema } from './common'

const FareStationSchema = v.pipe(
  v.object({
    id: v.pipe(v.string(), v.metadata({ examples: ['KCI-AC'] })),
    name: v.pipe(v.string(), v.metadata({ examples: ['Ancol'] }))
  }),
  v.title('FareStation')
)

const LineRefSchema = v.pipe(
  v.object({
    lineCode: v.string(),
    lineName: v.string(),
    lineColor: v.string(),
    headsign: v.nullable(v.string())
  }),
  v.title('FareLineRef')
)

const RideLegSchema = v.pipe(
  v.object({
    type: v.literal('RIDE'),
    lineCode: v.string(),
    lineName: v.pipe(v.string(), v.metadata({ examples: ['Lin Tanjung Priok'] })),
    lineColor: v.string(),
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

const TransferLegSchema = v.pipe(
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

const FareSegmentSchema = v.pipe(
  v.object({
    operator: OperatorCodeSchema,
    fromStationId: v.string(),
    toStationId: v.string(),
    fromName: v.string(),
    toName: v.string(),
    distanceM: v.number(),
    fare: v.pipe(v.number(), v.description('Fare for this segment, in rupiah.'))
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
      v.metadata({ examples: [8000] })
    ),
    totalDistanceM: v.number(),
    transferCount: v.number()
  }),
  v.title('FareResult')
)
