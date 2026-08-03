import * as v from 'valibot'
import { LineKeySchema, OperatorCodeSchema } from './common'

export const FareStationSchema = v.pipe(
  v.object({
    id: v.pipe(v.string(), v.metadata({ examples: ['KCI-SUD'] })),
    name: v.pipe(v.string(), v.metadata({ examples: ['Sudirman'] }))
  }),
  v.title('FareStation'),
  v.description('Stasiun di dalam hasil pencarian tarif.'),
  v.metadata({ ref: 'FareStation' })
)

export const LineRefSchema = v.pipe(
  v.object({
    line: LineKeySchema,
    headsign: v.pipe(
      v.nullable(v.string()),
      v.description('Stasiun akhir yang dituju perjalanan ini.')
    )
  }),
  v.title('FareLineRef'),
  v.description('Lin yang dipakai di satu tahap perjalanan.'),
  v.metadata({ ref: 'FareLineRef' })
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
    distanceM: v.pipe(v.number(), v.description('Jarak tempuh tahap ini dalam meter.')),
    serviceLines: v.pipe(
      v.optional(v.array(LineRefSchema)),
      v.description('Cuma muncul di jalur yang dipakai bersama beberapa lin, jadi naik yang mana pun tetap sampai. Lin utamanya ditaruh paling depan.')
    )
  }),
  v.title('FareRideLeg'),
  v.description('Tahap perjalanan naik kendaraan, dari stasiun naik sampai stasiun turun.'),
  v.metadata({ ref: 'FareRideLeg' })
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
    corridorLabel: v.pipe(
      v.optional(v.string()),
      v.description('Nama koridor yang dilewati waktu pindah, kalau ada.')
    )
  }),
  v.title('FareTransferLeg'),
  v.description('Tahap pindah kendaraan, biasanya jalan kaki antar peron atau antar stasiun.'),
  v.metadata({ ref: 'FareTransferLeg' })
)

export const FareLegSchema = v.pipe(
  v.variant('type', [RideLegSchema, TransferLegSchema]),
  v.title('FareLeg'),
  v.description('Satu tahap perjalanan. Dibedakan lewat `type`.'),
  v.metadata({ ref: 'FareLeg' })
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
  v.description('Satu bagian perjalanan yang ditagih. Tiap operator menagih per perjalanan menerus di jaringan mereka sendiri, makanya segment dan leg tidak selalu satu lawan satu.'),
  v.metadata({ ref: 'FareSegment' })
)

export const FareJourneyLabelSchema = v.pipe(
  v.picklist(['FEWEST_CHANGES', 'LEAST_WALKING', 'CHEAPEST', 'SHORTEST_WAIT']),
  v.title('FareJourneyLabel'),
  v.description('Kelebihan yang cuma dipunya satu pilihan rute: `FEWEST_CHANGES` paling jarang ganti kendaraan, `LEAST_WALKING` paling sedikit jalan kaki, `CHEAPEST` paling murah, `SHORTEST_WAIT` kendaraannya paling sering lewat. Kalau ada dua rute yang sama-sama unggul, dua-duanya tidak dapat label, biar labelnya benar-benar membedakan.'),
  v.metadata({ ref: 'FareJourneyLabel' })
)

export const FareJourneySchema = v.pipe(
  v.object({
    legs: v.pipe(v.array(FareLegSchema), v.description('Perjalanan dari sisi penumpang: naik apa saja dan transfer di mana saja.')),
    segments: v.pipe(v.array(FareSegmentSchema), v.description('Perjalanan dari sisi penagihan tarif.')),
    totalFare: v.pipe(
      v.nullable(v.number()),
      v.description('Total dalam rupiah buat pilihan rute ini. Null kalau tarifnya tidak bisa dihitung.'),
      v.metadata({ examples: [14000] })
    ),
    totalDistanceM: v.pipe(v.number(), v.description('Total jarak pilihan rute ini dalam meter.')),
    transferCount: v.pipe(v.number(), v.description('Berapa kali harus pindah kendaraan, dihitung dari sisi penumpang.')),
    labels: v.pipe(
      v.array(FareJourneyLabelSchema),
      v.description('Boleh kosong, dan itu wajar: rute yang tidak menang sendirian di kriteria mana pun memang tidak punya kelebihan khusus buat disebut.')
    ),
    boardings: v.pipe(v.number(), v.description('Berapa kali naik kendaraan. Beda tipis dari `transferCount`: ganti kereta di peron yang sama tetap dihitung naik, tapi tidak dihitung transit.')),
    walkDistanceM: v.pipe(v.number(), v.description('Total jarak jalan kaki di pilihan rute ini dalam meter.'))
  }),
  v.title('FareJourney'),
  v.description('Satu pilihan rute lengkap dengan tarifnya. Yang dibandingkan cuma jumlah naik kendaraan, jarak jalan kaki, rata-rata lama nunggu, dan tarif — bukan waktu tempuh, karena mesinnya memang tidak punya jadwal.'),
  v.metadata({ ref: 'FareJourney' })
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
    totalDistanceM: v.pipe(v.number(), v.description('Total jarak seluruh perjalanan dalam meter.')),
    transferCount: v.pipe(v.number(), v.description('Berapa kali harus pindah kendaraan.'))
  }),
  v.title('FareResult'),
  v.description('Hasil pencarian rute: perjalanannya seperti apa (`legs`) dan tarifnya dihitung bagaimana (`segments`).'),
  v.metadata({ ref: 'FareResult' })
)

/*
 * The multi-journey answer, served from `/_internal/trips/:from/:to`.
 *
 * Not part of the documented API: `/_internal` is shaped around the web app's
 * screen and carries no compatibility promise. The schema lives here anyway so
 * apps/web parses the same definition the API builds, and so the pieces are
 * ready to promote if this ever becomes a public endpoint.
 */
export const TripResultSchema = v.pipe(
  v.object({
    from: FareStationSchema,
    to: FareStationSchema,
    journeys: v.pipe(
      v.array(FareJourneySchema),
      v.description('Pilihan rute buat pasangan stasiun ini, diurutkan dari yang paling masuk akal. Selalu ada isinya kalau rutenya ketemu.')
    )
  }),
  v.title('TripResult'),
  v.description('Beberapa pilihan rute sekaligus buat satu pasangan stasiun, masing-masing lengkap dengan tarifnya.'),
  v.metadata({ ref: 'TripResult' })
)

export type FareStation = v.InferOutput<typeof FareStationSchema>
export type FareLineRef = v.InferOutput<typeof LineRefSchema>
export type FareRideLeg = v.InferOutput<typeof RideLegSchema>
export type FareTransferLeg = v.InferOutput<typeof TransferLegSchema>
export type FareLeg = v.InferOutput<typeof FareLegSchema>
export type FareSegment = v.InferOutput<typeof FareSegmentSchema>
export type FareJourneyLabel = v.InferOutput<typeof FareJourneyLabelSchema>
export type FareJourney = v.InferOutput<typeof FareJourneySchema>
export type FareResult = v.InferOutput<typeof FareResultSchema>
export type TripResult = v.InferOutput<typeof TripResultSchema>

/* Aliases matching the web app's long-standing names for these shapes. */
export type FareResultStation = FareStation
export type FareResultLineRef = FareLineRef
export type FareResultRideLeg = FareRideLeg
export type FareResultTransferLeg = FareTransferLeg
export type FareResultLeg = FareLeg
export type FareResultSegment = FareSegment
