import * as v from 'valibot'
import type { HexColored } from './common'
import { AmenitySchema, LineKeySchema, OperatorCodeSchema, RegionCodeSchema } from './common'

const stationIdentity = {
  id: v.pipe(
    v.string(),
    v.description('Identifier stabil, `{operatorCode}-{stationCode}`. Pakai ini buat cek tarif.'),
    v.metadata({ examples: ['KCI-SUDB'] })
  ),
  name: v.pipe(
    v.string(),
    v.description('Nama tampilan: yang ditunjukkan ke penumpang.'),
    v.metadata({ examples: ['BNI City'] })
  ),
  officialName: v.pipe(
    v.string(),
    v.description('Penulisan versi operatornya sendiri, yang sering beda bukan cuma soal huruf besar-kecil. KCI masih menulis "SUDIRMAN BARU" buat stasiun yang ditampilkan sebagai "BNI City". Layak dijadikan alias pencarian: banyak penumpang masih menyebut stasiunnya begitu.'),
    v.metadata({ examples: ['SUDIRMAN BARU'] })
  ),
  code: v.pipe(
    v.string(),
    v.description('Kode stasiun dalam lingkup operator, unik per operator dan bukan secara global.'),
    v.metadata({ examples: ['SUDB'] })
  ),
  operator: OperatorCodeSchema,
  lines: v.pipe(
    v.array(LineKeySchema),
    v.description('Lin yang berhenti di stasiun ini, berupa key ke kamus lin dari `/operators`. Kosong buat stasiun yang cuma ada di topologi.')
  )
}

export const StationSchema = v.pipe(
  v.object({
    ...stationIdentity,
    regionCode: RegionCodeSchema,
    amenities: v.array(AmenitySchema),
    latitude: v.pipe(
      v.nullable(v.number()),
      v.description('Lintang WGS84; null kalau koordinatnya belum disurvei.'),
      v.metadata({ examples: [-6.2015] })
    ),
    longitude: v.pipe(
      v.nullable(v.number()),
      v.metadata({ examples: [106.8196] })
    ),
    score: v.pipe(
      v.number(),
      v.description('Popularitas relatif, dipakai buat mengurutkan hasil pencarian. Makin tinggi makin ramai.')
    ),
    searchable: v.pipe(
      v.boolean(),
      v.description('Bernilai false buat perhentian yang cuma ada demi routing dan disembunyikan dari pencarian. Selalu true di response daftar, yang memang sudah memfilternya.')
    )
  }),
  v.title('Station')
)

/*
 * A station as referenced from another resource — a hub's members, a transfer's
 * destination. Enough to render and link; fetch the station itself for detail.
 */
export const StationRefSchema = v.pipe(
  v.object(stationIdentity),
  v.title('StationRef')
)

/*
 * Transfers are a discriminated union on `dataType`: an INTERNAL transfer points
 * at a station this API knows, so it carries the full reference; an EXTERNAL one
 * leads off-network and has only a name and an operator.
 */
const TransferBaseEntries = {
  id: v.string(),
  // `distanceM`, matching FareLeg.distanceM and FareResult.totalDistanceM — one
  // spelling for distance across the whole API.
  distanceM: v.pipe(
    v.number(),
    v.description('Jarak jalan kaki dalam meter.'),
    v.metadata({ examples: [90] })
  ),
  // Null far more often than not — 13 of 15 sampled from production.
  notes: v.pipe(
    v.nullable(v.string()),
    v.description('Petunjuk bebas buat jalan kakinya; null kalau nggak ada yang perlu ditambahkan.')
  )
}

export const InternalTransferSchema = v.pipe(
  v.object({
    ...TransferBaseEntries,
    dataType: v.literal('INTERNAL'),
    toStation: StationRefSchema
  }),
  v.title('InternalTransfer'),
  v.description('Sambungan ke stasiun lain di API ini. `toStation` berisi referensi stasiun lengkap.')
)

export const ExternalTransferSchema = v.pipe(
  v.object({
    ...TransferBaseEntries,
    dataType: v.literal('EXTERNAL'),
    toStation: v.object({
      name: v.string(),
      operatorName: v.pipe(
        v.string(),
        v.description('Nama operator dalam teks bebas, karena layanan luar nggak punya kode operator di API ini.')
      )
    })
  }),
  v.title('ExternalTransfer'),
  v.description('Sambungan ke layanan di luar API ini. Nggak ada station id atau lin, cuma nama.')
)

export const TransferSchema = v.pipe(
  v.variant('dataType', [InternalTransferSchema, ExternalTransferSchema]),
  v.title('Transfer'),
  v.description('Dibedakan lewat `dataType`. Data yang ada sekarang semuanya INTERNAL; cabang EXTERNAL disiapkan buat sambungan ke luar jaringan.')
)

/*
 * A single scheduled departure. The row's own id, its station id and the
 * timestamps are gone: a schedule is always read in the context of the station
 * and line that own it, so repeating them was noise.
 */
export const ScheduleSchema = v.pipe(
  v.object({
    tripNumber: v.pipe(
      v.nullable(v.string()),
      v.description('Nomor perjalanan versi operator; null buat operator yang nggak mempublikasikannya.'),
      v.metadata({ examples: ['5198B'] })
    ),
    estimatedDeparture: v.pipe(v.string(), v.description('Waktu lokal, `HH:MM:SS`.'), v.metadata({ examples: ['00:05:30'] })),
    boundFor: v.pipe(v.string(), v.description('Stasiun akhir yang dituju perjalanan ini.'), v.metadata({ examples: ['Cikarang'] })),
    lineCode: v.string()
  }),
  v.title('Schedule')
)

/*
 * Wire-optimised departure used when `?compact=1` is set: a two-element tuple of
 * the trip number (null where the operator publishes none) and minutes since
 * local Asia/Jakarta midnight, 0–1439. Shaves a large timetable down
 * considerably versus the full Schedule object.
 */
export const CompactScheduleSchema = v.pipe(
  /*
   * Modelled as a 2-element union array rather than v.tuple. The tuple would be
   * the honest shape, but @valibot/to-json-schema emits draft-07 tuple syntax
   * (`items: [...]`) for it, and hono-openapi calls the converter with no
   * options — so the `draft-2020-12` target that would emit `prefixItems` never
   * reaches it. Draft-07 tuple syntax is invalid under OpenAPI 3.1 and fails
   * spec validation. The TypeScript type below restores the real tuple.
   */
  v.pipe(
    v.array(v.union([v.nullable(v.string()), v.number()])),
    v.length(2)
  ),
  v.title('CompactSchedule'),
  v.description('`[tripNumber, minutesSinceMidnight]`. Nomor perjalanan null kalau operatornya nggak mempublikasikan; menitnya waktu lokal Asia/Jakarta, 0–1439.'),
  v.metadata({ examples: [['5198B', 5]] })
)

const directionGroup = <T extends v.GenericSchema>(schedules: T, title: string) => v.pipe(
  v.object({
    key: v.pipe(v.string(), v.description('Key stabil buat kelompok arah ini.')),
    label: v.pipe(v.array(v.string()), v.description('Label arah, berisi nama tampilan stasiun. Gabungkan pakai " / " buat ditampilkan.')),
    platformCode: v.pipe(
      v.nullable(v.string()),
      v.description('Info peron hasil kurasi; null kalau peronnya belum diketahui.')
    ),
    destinations: v.array(v.object({
      boundFor: v.string(),
      via: v.pipe(
        v.nullable(v.string()),
        v.description('Keisi kalau dua perjalanan ke stasiun akhir yang sama lewat jalur berbeda.')
      ),
      schedules: v.array(schedules)
    }))
  }),
  v.title(title)
)

/*
 * The grouped timetable folds a station's departures into lines, then into
 * directions, then into destinations — the shape a departure board renders.
 */
export const GroupedTimetableSchema = v.pipe(
  v.object({
    line: v.pipe(LineKeySchema, v.description('Lin yang punya keberangkatan ini.')),
    timetable: v.array(directionGroup(ScheduleSchema, 'TimetableDirectionGroup'))
  }),
  v.title('GroupedTimetable')
)

/** The `?compact=1` variant: identical structure, tuple schedules. */
export const CompactGroupedTimetableSchema = v.pipe(
  v.object({
    line: v.pipe(LineKeySchema, v.description('Lin yang punya keberangkatan ini.')),
    timetable: v.array(directionGroup(CompactScheduleSchema, 'CompactTimetableDirectionGroup'))
  }),
  v.title('CompactGroupedTimetable')
)

/*
 * Pre-direction-group response entry. No longer served, but still reachable from
 * stale service-worker caches, so the web app keeps normalising it into a
 * direction group.
 */
export const LegacyTimetableEntrySchema = v.pipe(
  v.object({
    boundFor: v.string(),
    via: v.nullable(v.string()),
    schedules: v.union([v.array(ScheduleSchema), v.array(CompactScheduleSchema)])
  }),
  v.title('LegacyTimetableEntry')
)

export type Station = v.InferOutput<typeof StationSchema>
export type StationRef = v.InferOutput<typeof StationRefSchema>
export type Transfer = v.InferOutput<typeof TransferSchema>
export type InternalTransfer = v.InferOutput<typeof InternalTransferSchema>
export type ExternalTransfer = v.InferOutput<typeof ExternalTransferSchema>
export type Schedule = v.InferOutput<typeof ScheduleSchema>
/*
 * The real shape. The schema above widens to `(string | null | number)[]` for
 * the OpenAPI-compat reason documented there; consumers get the precise tuple.
 */
export type CompactSchedule = [tripNumber: string | null, minute: number]
export type GroupedTimetable = v.InferOutput<typeof GroupedTimetableSchema>
/*
 * `schedules` is re-typed to the real CompactSchedule tuple: the schema widens
 * it for OpenAPI-compat reasons (see CompactScheduleSchema), which would
 * otherwise leak `(string | number | null)[]` into every consumer.
 */
type RawCompactGroupedTimetable = HexColored<v.InferOutput<typeof CompactGroupedTimetableSchema>>
export type CompactGroupedTimetable = Omit<RawCompactGroupedTimetable, 'timetable'> & {
  timetable: (Omit<RawCompactGroupedTimetable['timetable'][number], 'destinations'> & {
    destinations: (Omit<RawCompactGroupedTimetable['timetable'][number]['destinations'][number], 'schedules'> & {
      schedules: CompactSchedule[]
    })[]
  })[]
}
export type LegacyTimetableEntry = v.InferOutput<typeof LegacyTimetableEntrySchema>
export type TimetableDirectionGroup = GroupedTimetable['timetable'][number]
export type CompactTimetableDirectionGroup = CompactGroupedTimetable['timetable'][number]
export type TimetableDestination = TimetableDirectionGroup['destinations'][number]
export type CompactTimetableDestination = CompactTimetableDirectionGroup['destinations'][number]
export type LineGroupedTimetable = GroupedTimetable[]
export type CompactLineGroupedTimetable = CompactGroupedTimetable[]

/* Aliases matching the web app's long-standing names. */
export type LineTimetable = GroupedTimetable
export type CompactLineTimetable = CompactGroupedTimetable
