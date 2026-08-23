import * as v from 'valibot'
import type { HexColored } from './common'
import { AmenitySchema, LineKeySchema, OperatorCodeSchema, RegionCodeSchema } from './common'

const stationIdentity = {
  id: v.pipe(
    v.string(),
    v.description('Identifier yang stabil, formatnya `{operatorCode}-{stationCode}`. Pakai ini kalau mau cek tarif.'),
    v.metadata({ examples: ['KCI-SUDB'] })
  ),
  name: v.pipe(
    v.string(),
    v.description('Nama yang ditampilkan ke penumpang.'),
    v.metadata({ examples: ['BNI City'] })
  ),
  officialName: v.pipe(
    v.string(),
    v.description('Nama versi operatornya sendiri, yang sering beda jauh dari nama tampilannya. KCI, misalnya, masih menulis "SUDIRMAN BARU" buat stasiun yang kita tampilkan sebagai "BNI City". Berguna buat pencarian, karena banyak penumpang masih menyebut stasiunnya dengan nama ini.'),
    v.metadata({ examples: ['SUDIRMAN BARU'] })
  ),
  code: v.pipe(
    v.string(),
    v.description('Kode stasiun versi operatornya. Unik di dalam satu operator, tapi belum tentu unik antar operator.'),
    v.metadata({ examples: ['SUDB'] })
  ),
  operator: OperatorCodeSchema,
  lines: v.pipe(
    v.array(LineKeySchema),
    v.description('Lin yang berhenti di stasiun ini, dalam bentuk key ke kamus lin dari `/operators`. Kosong kalau stasiunnya cuma dipakai buat routing.')
  )
}

export const StationSchema = v.pipe(
  v.object({
    ...stationIdentity,
    regionCode: RegionCodeSchema,
    amenities: v.array(AmenitySchema),
    latitude: v.pipe(
      v.nullable(v.number()),
      v.description('Lintang WGS84. Null kalau koordinatnya belum disurvei.'),
      v.metadata({ examples: [-6.2015] })
    ),
    longitude: v.pipe(
      v.nullable(v.number()),
      v.metadata({ examples: [106.8196] })
    ),
    score: v.pipe(
      v.number(),
      v.description('Seberapa ramai stasiunnya (0-100), dipakai buat mengurutkan hasil pencarian. Makin tinggi makin ramai. Buat stasiun yang datanya dirilis operator, angkanya dihitung dari jumlah penumpang beneran (gate in-out plus penumpang transit). Sisanya perkiraan dari frekuensi kereta dan bentuk jaringan, bukan hasil pengukuran. TransJakarta belum dihitung, jadi masih 0.')
    ),
    searchable: v.pipe(
      v.boolean(),
      v.description('False kalau stasiunnya cuma dipakai buat routing dan sengaja disembunyikan dari pencarian. Di response daftar selalu true, karena yang seperti itu sudah difilter duluan.')
    )
  }),
  v.title('Station'),
  v.description('Satu stasiun lengkap dengan fasilitas, koordinat, dan lin yang berhenti di sana.'),
  v.metadata({ ref: 'Station' })
)

/*
 * A station as referenced from another resource — a hub's members, a transfer's
 * destination. Enough to render and link; fetch the station itself for detail.
 */
export const StationRefSchema = v.pipe(
  v.object(stationIdentity),
  v.title('StationRef'),
  v.description('Rujukan ringkas ke sebuah stasiun. Dipakai di tempat yang cuma butuh nama dan kodenya, tanpa detail lengkap.'),
  v.metadata({ ref: 'StationRef' })
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
    v.description('Petunjuk tambahan buat jalan kakinya. Null kalau tidak ada yang perlu dijelaskan.')
  )
}

export const InternalTransferSchema = v.pipe(
  v.object({
    ...TransferBaseEntries,
    dataType: v.literal('INTERNAL'),
    toStation: StationRefSchema
  }),
  v.title('InternalTransfer'),
  v.description('Sambungan ke stasiun lain yang ada di API ini. `toStation` berisi referensi stasiun lengkap.'),
  v.metadata({ ref: 'InternalTransfer' })
)

export const ExternalTransferSchema = v.pipe(
  v.object({
    ...TransferBaseEntries,
    dataType: v.literal('EXTERNAL'),
    toStation: v.object({
      name: v.string(),
      operatorName: v.pipe(
        v.string(),
        v.description('Nama operatornya dalam teks biasa, karena layanan di luar API ini tidak punya kode operator.')
      )
    })
  }),
  v.title('ExternalTransfer'),
  v.description('Sambungan ke layanan yang belum ada di API ini. Tidak ada station id atau lin, cuma nama.'),
  v.metadata({ ref: 'ExternalTransfer' })
)

export const TransferSchema = v.pipe(
  v.variant('dataType', [InternalTransferSchema, ExternalTransferSchema]),
  v.title('Transfer'),
  v.description('Dibedakan lewat `dataType`. Kebanyakan INTERNAL, tapi EXTERNAL juga ada, jadi tangani dua-duanya.'),
  v.metadata({ ref: 'Transfer' })
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
      v.description('Nomor perjalanan versi operatornya. Null kalau operatornya tidak menerbitkan nomor.'),
      v.metadata({ examples: ['5198B'] })
    ),
    estimatedDeparture: v.pipe(v.string(), v.description('Waktu lokal, `HH:MM:SS`.'), v.metadata({ examples: ['00:05:30'] })),
    boundFor: v.pipe(v.string(), v.description('Stasiun akhir yang dituju perjalanan ini.'), v.metadata({ examples: ['Cikarang'] })),
    lineCode: v.string()
  }),
  v.title('Schedule'),
  v.description('Satu keberangkatan: kapan berangkat, menuju ke mana, dan dari peron berapa.'),
  v.metadata({ ref: 'Schedule' })
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
  v.description('`[tripNumber, minutesSinceMidnight]`. Nomor perjalanannya null kalau operatornya tidak menerbitkan. Menitnya pakai waktu lokal Asia/Jakarta, dari 0 sampai 1439.'),
  v.metadata({ examples: [['5198B', 5]] })
)

const directionGroup = <T extends v.GenericSchema>(schedules: T, title: string) => v.pipe(
  v.object({
    key: v.pipe(v.string(), v.description('Key yang stabil buat kelompok arah ini.')),
    label: v.pipe(v.array(v.string()), v.description('Label arahnya, berisi nama stasiun. Gabungkan pakai " / " kalau mau ditampilkan.')),
    platformCode: v.pipe(
      v.nullable(v.string()),
      v.description('Info peron yang sudah kita kurasi. Null kalau peronnya belum diketahui.')
    ),
    destinations: v.pipe(
      v.array(v.object({
        boundFor: v.pipe(v.string(), v.description('Stasiun akhir yang dituju.')),
        via: v.pipe(
          v.nullable(v.string()),
          v.description('Terisi kalau ada dua perjalanan ke stasiun akhir yang sama tapi lewat jalur berbeda.')
        ),
        schedules: v.pipe(
          v.array(schedules),
          v.description('Keberangkatan menuju stasiun akhir itu, urut dari yang paling awal.')
        )
      })),
      v.description('Satu entri per stasiun akhir di arah ini.')
    )
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
    timetable: v.pipe(
      v.array(directionGroup(ScheduleSchema, 'TimetableDirectionGroup')),
      v.description('Satu entri per arah keberangkatan.')
    )
  }),
  v.title('GroupedTimetable'),
  v.description('Jadwal satu lin, dikelompokkan tiga tingkat: per arah, lalu per stasiun tujuan, lalu daftar keberangkatannya. Ini bentuk yang dipakai papan keberangkatan.'),
  v.metadata({ ref: 'GroupedTimetable' })
)

/** The `?compact=1` variant: identical structure, tuple schedules. */
export const CompactGroupedTimetableSchema = v.pipe(
  v.object({
    line: v.pipe(LineKeySchema, v.description('Lin yang punya keberangkatan ini.')),
    timetable: v.pipe(
      v.array(directionGroup(CompactScheduleSchema, 'CompactTimetableDirectionGroup')),
      v.description('Satu entri per arah keberangkatan.')
    )
  }),
  v.title('CompactGroupedTimetable'),
  v.description('Sama dengan GroupedTimetable, tapi tiap keberangkatan diringkas jadi tuple `[tripNumber, minutesSinceMidnight]` biar payload-nya lebih kecil.'),
  v.metadata({ ref: 'CompactGroupedTimetable' })
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
