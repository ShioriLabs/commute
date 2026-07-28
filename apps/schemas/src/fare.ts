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
      v.description('Stasiun akhir yang dituju perjalanan ini.')
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
    stationCount: v.pipe(v.number(), v.description('Jumlah stasiun yang dilewati, termasuk stasiun awal dan akhir.')),
    stops: v.pipe(v.array(FareStationSchema), v.description('Daftar stasiun lengkap dan urut, dari tempat naik sampai tempat turun.')),
    headsign: v.pipe(
      v.nullable(v.string()),
      v.description('Stasiun akhir yang dituju. Null kalau tidak bisa ditentukan.')
    ),
    distanceM: v.number(),
    serviceLines: v.pipe(
      v.optional(v.array(LineRefSchema)),
      v.description('Cuma muncul di jalur yang dipakai bersama beberapa lin, jadi naik yang mana pun tetap sampai. Lin utamanya ditaruh paling depan.')
    )
  }),
  v.title('FareRideLeg')
)

export const TransferLegSchema = v.pipe(
  v.object({
    type: v.literal('TRANSFER'),
    from: FareStationSchema,
    to: FareStationSchema,
    distanceM: v.pipe(v.number(), v.description('Jarak jalan kaki dalam meter.')),
    fare: v.pipe(
      v.optional(v.number()),
      v.description('Cuma ada di koridor berbayar. Transfer jalan kaki biasa gratis, jadi tidak punya ini.')
    ),
    corridorLabel: v.optional(v.string())
  }),
  v.title('FareTransferLeg')
)

export const FareLegSchema = v.pipe(
  v.variant('type', [RideLegSchema, TransferLegSchema]),
  v.title('FareLeg'),
  v.description('Satu tahap perjalanan. Dibedakan lewat `type`.')
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
      v.description('Tarif buat segmen ini dalam rupiah. Null kalau tidak bisa dihitung.')
    )
  }),
  v.title('FareSegment'),
  v.description('Satu bagian perjalanan yang ditagih. Tiap operator menagih per perjalanan menerus di jaringan mereka sendiri, makanya segment dan leg tidak selalu satu lawan satu.')
)

export const FareResultSchema = v.pipe(
  v.object({
    from: FareStationSchema,
    to: FareStationSchema,
    legs: v.pipe(v.array(FareLegSchema), v.description('Perjalanan dari sisi penumpang: naik apa saja dan transfer di mana saja.')),
    segments: v.pipe(v.array(FareSegmentSchema), v.description('Perjalanan dari sisi penagihan tarif.')),
    totalFare: v.pipe(
      v.nullable(v.number()),
      v.description('Total dalam rupiah, sudah termasuk batas tarif integrasi. Null kalau tarif buat pasangan stasiun ini tidak bisa dihitung.'),
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
