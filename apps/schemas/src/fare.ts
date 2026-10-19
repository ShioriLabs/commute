import * as v from 'valibot'
import { LineKeySchema, OperatorCodeSchema } from './common'
import { ExitRefSchema } from './station'

export const FareStationSchema = v.pipe(
  v.object({
    id: v.pipe(v.string(), v.metadata({ examples: ['KCI-SUD'] })),
    name: v.pipe(v.string(), v.metadata({ examples: ['Sudirman'] })),
    /*
     * Only /_internal/trips fills these, for the Android trip mode: it confirms
     * where a rider is from a fix near a stop, and `/stations` lists only
     * searchable stations, so the routing-only haltes had no coordinates to
     * confirm against. Absent where the station row has none.
     */
    latitude: v.pipe(
      v.optional(v.number()),
      v.description('Lintang stasiun. Cuma ada kalau koordinat stasiunnya kami punya.'),
      v.metadata({ examples: [-6.2026] })
    ),
    longitude: v.pipe(
      v.optional(v.number()),
      v.description('Bujur stasiun. Cuma ada kalau koordinat stasiunnya kami punya.'),
      v.metadata({ examples: [106.8233] })
    )
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

export const LegDepartureSchema = v.pipe(
  v.object({
    departureAt: v.pipe(v.string(), v.description('Jam berangkat dari stasiun naik.')),
    arrivalAt: v.pipe(v.string(), v.description('Jam tiba di stasiun turun.')),
    tripId: v.pipe(v.string(), v.description('Penanda perjalanan kendaraan ini. Jangan diurai, cuma buat membandingkan.')),
    // May differ from the leg's own line on a trunk two lines share.
    line: LineKeySchema,
    headsign: v.pipe(
      v.optional(v.string()),
      v.description('Stasiun akhir yang dituju kendaraan ini, kalau jadwalnya mencantumkan.')
    )
  }),
  v.title('FareLegDeparture'),
  v.description('Satu kendaraan yang melayani seluruh tahap, dari stasiun naik sampai stasiun turun, sesuai jadwal resmi.'),
  v.metadata({ ref: 'FareLegDeparture' })
)

export const JourneyDepartureSchema = v.pipe(
  v.object({
    departureAt: v.pipe(v.string(), v.description('Jam berangkat kendaraan pertama.')),
    arrivalAt: v.pipe(
      v.optional(v.string()),
      v.description('Jam sampai tujuan. Cuma ada kalau semua tahap naik kendaraannya punya jadwal.')
    )
  }),
  v.title('FareJourneyDeparture'),
  v.description('Keberangkatan lain dari rute yang sama.'),
  v.metadata({ ref: 'FareJourneyDeparture' })
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
    ),
    /*
     * Optional, like serviceLines, and for the same reason: the field appears
     * only where the data genuinely supports it.
     *
     * These are published trip times, not estimates — which is what separates
     * them from the waitS this schema still refuses below. TransJakarta has no
     * timetable at all and never will, and some rail trips reach us without
     * their intermediate stops, so those legs carry nothing rather than a
     * guess. Absent means "we do not know", and the UI must render nothing.
     *
     * That still holds with observed run times: a TransJakarta leg never gets a
     * departure or arrival here. What the observations support is an estimate,
     * and it lives on the journey (`estimate` on FareJourneySchema), where no
     * client can mistake it for a timetable time.
     */
    departureAt: v.pipe(
      v.optional(v.string()),
      v.description('Jam berangkat dari stasiun naik, sesuai jadwal resmi. Cuma ada di tahap yang jadwalnya kami punya.'),
      v.metadata({ examples: ['2026-09-07T07:14:00+07:00'] })
    ),
    arrivalAt: v.pipe(
      v.optional(v.string()),
      v.description('Jam tiba di stasiun turun, sesuai jadwal resmi. Cuma ada di tahap yang jadwalnya kami punya.'),
      v.metadata({ examples: ['2026-09-07T07:31:00+07:00'] })
    ),
    lastService: v.pipe(
      v.optional(v.literal(true)),
      v.description('Ada dan bernilai `true` kalau ini kendaraan terakhir hari ini yang bisa dinaiki dari stasiun naik sampai stasiun turun tahap ini. Ketinggalan berarti tahap ini baru bisa dinaiki besok. Cuma ada di tahap yang jadwalnya kami punya.')
    ),
    /*
     * The boarded trip's time at every stop, index-aligned with `stops`, so a
     * rider followed underground is placed by the schedule rather than by stop
     * count. Per-request like the two stamps above, never cached. The ends
     * always equal `departureAt` and `arrivalAt`; a null is a stop the trip
     * passes without a recorded time, interpolated by the consumer, never
     * filled with a guessed dwell here.
     */
    stopTimes: v.pipe(
      v.optional(v.array(v.nullable(v.string()))),
      v.description('Jam kendaraan ada di tiap stasiun, urut sama dengan `stops`. Null kalau jamnya tidak tercatat. Cuma ada di tahap yang jadwalnya kami punya.'),
      v.metadata({ examples: [['2026-09-07T07:14:00+07:00', '2026-09-07T07:17:00+07:00', '2026-09-07T07:31:00+07:00']] })
    ),
    tripId: v.pipe(
      v.optional(v.string()),
      v.description('Penanda perjalanan kendaraan yang dinaiki. Jangan diurai, cuma buat membandingkan. Cuma ada di tahap yang jadwalnya kami punya.')
    ),
    /*
     * The engine's shortest change into this leg from the timed ride before it,
     * walks and in-station allowances included, at the rider's walking pace.
     * A client offering a later train on an earlier leg uses it to tell which
     * of `upcomingDepartures` that train still makes, instead of guessing.
     */
    minChangeS: v.pipe(
      v.optional(v.number()),
      v.description('Waktu pindah paling singkat dalam detik, dari turun di tahap naik sebelumnya sampai bisa naik di tahap ini, termasuk jalan kaki, sesuai kecepatan jalan penumpang. Tidak ada di tahap naik pertama atau tahap yang tidak punya jadwal.')
    ),
    /*
     * The trains a rider on this platform can take, the caught one first. Per-
     * request like the stamps above, and anchored on the same clock: every
     * entry is one this rider can make after the leg before, so picking a later
     * one never makes an earlier leg wrong. Absent where the leg is untimed.
     */
    upcomingDepartures: v.pipe(
      v.optional(v.array(LegDepartureSchema)),
      v.description('Kendaraan yang bisa dinaiki di tahap ini, urut dari yang paling cepat. Yang pertama selalu kendaraan yang dipakai di `departureAt`. Cuma ada di tahap yang jadwalnya kami punya.')
    ),
    /*
     * Optional for the same reason as the two above, but with a sharper edge:
     * platform assignments are reassigned operationally and change with
     * engineering work, so PLATFORM_CODES carries only field-verified entries
     * and is absent for most legs. Absent means "we do not know" and the UI
     * omits the badge; a guess would send a rider to the wrong trackside.
     *
     * A string, not a number: an island platform between two tracks serving one
     * direction is signed as a range ("1/2"), which is what a rider reads.
     */
    platformCode: v.pipe(
      v.optional(v.string()),
      v.description('Peron tempat naik, kalau datanya sudah diverifikasi. Bisa berupa rentang kalau peronnya pulau.'),
      v.metadata({ examples: ['1/2'] })
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
    distanceM: v.pipe(v.number(), v.description('Jarak jalan kaki dalam meter. Jalan kaki yang berurutan digabung jadi satu tahap, jaraknya dibulatkan ke atas: kelipatan 50 m kalau di bawah 500 m, selebihnya kelipatan 100 m.')),
    fare: v.pipe(
      v.optional(v.number()),
      v.description('Cuma ada di koridor berbayar. Transfer jalan kaki biasa gratis, jadi tidak punya ini.')
    ),
    corridorLabel: v.pipe(
      v.optional(v.string()),
      v.description('Nama koridor yang dilewati waktu pindah, kalau ada.')
    ),
    /*
     * Only /_internal/trips fills these, like the coordinates on FareStation:
     * /fares is the shared URL the OG card and the embed read, so its body does
     * not move. The description sits on the field, but the OpenAPI generator
     * emits a bare $ref for a described object, so it never reaches the spec.
     */
    fromExit: v.pipe(
      v.optional(ExitRefSchema),
      v.description('Pintu di stasiun asal tempat jalan kakinya mulai. Cuma diisi di /_internal/trips, dan cuma kalau sudah dicatat.')
    ),
    toExit: v.pipe(
      v.optional(ExitRefSchema),
      v.description('Pintu di stasiun tujuan tempat jalan kakinya masuk. Cuma diisi di /_internal/trips, dan cuma kalau sudah dicatat.')
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

/*
 * No waitS field, on purpose. It exists in the engine's Criteria and it decides
 * SHORTEST_WAIT, but it is derived from average headways rather than a
 * timetable. A number in seconds invites the UI to render "tunggu ±7 menit",
 * which is a departure-time promise this engine cannot keep. The label carries
 * the comparison; the figure would carry a lie.
 *
 * The per-leg `departureAt` above is not a counterexample to that rule, it is
 * the rule applied: those come from a published trip rather than an average, so
 * they are a promise the timetable already makes. Where there is no timetable
 * the fields are absent — which is why the refusal here still stands.
 */
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
    walkDistanceM: v.pipe(v.number(), v.description('Total jarak jalan kaki di pilihan rute ini dalam meter, apa adanya tanpa pembulatan, buat membandingkan rute. Buat ditampilkan, jumlahkan `distanceM` tahap jalan kakinya supaya sama dengan yang tertulis di tiap tahap.')),
    /*
     * All-or-nothing: present only when EVERY ride leg is timed. A total that
     * skipped an untimed leg would read as more certain than the legs it came
     * from, which is the same reason a leg after an untimed one carries nothing.
     */
    arrivalAt: v.pipe(
      v.optional(v.string()),
      v.description('Jam sampai tujuan. Cuma ada kalau semua tahap naik kendaraannya punya jadwal, jadi kalau ada tahap yang pakai TransJakarta memang tidak muncul.'),
      v.metadata({ examples: ['2026-09-07T08:02:00+07:00'] })
    ),
    /*
     * Separates the two reasons a journey comes back with no clock on it. A
     * route the timetable never covers (TransJakarta, rail trips with gaps in
     * their stop lists) carries nothing, as before. A route it does cover but
     * where tonight's last train has gone carries this, so the UI can say the
     * service is done rather than offer a journey nobody can take.
     */
    resumesAt: v.pipe(
      v.optional(v.string()),
      v.description('Jam berangkat pertama rute ini di hari layanan berikutnya. Cuma ada kalau rutenya punya jadwal tapi layanan hari ini sudah selesai.'),
      v.metadata({ examples: ['2026-09-08T04:05:00+07:00'] })
    ),
    /*
     * One card per route, so the route's later boardings ride along here
     * instead of as cards of their own. Never one that leaves earlier and
     * arrives no sooner than another: that train is only a longer wait.
     */
    moreDepartures: v.pipe(
      v.optional(v.array(JourneyDepartureSchema)),
      v.description('Keberangkatan lain rute ini dalam satu jam ke depan, urut dari yang paling cepat, tidak termasuk yang ditampilkan di tahap-tahapnya. Cuma ada di rute yang jadwalnya kami punya.')
    ),
    /*
     * Estimated, from observed TransJakarta run times and the expected wait
     * (utils/observedRuntimes.ts). Only on a journey with a TransJakarta ride
     * and no `arrivalAt`, and only where every ride leg could be timed or
     * estimated. Kept off the legs on purpose: there, a time is a timetable
     * fact. Never to be shown as a clock time.
     */
    estimate: v.pipe(
      v.optional(v.object({
        durationS: v.pipe(
          v.number(),
          v.description('Perkiraan lama perjalanan dalam detik, dihitung dari jam yang diminta (`at`) sampai tiba, termasuk jalan kaki dan rata-rata waktu tunggu. Perkiraan dari pengamatan bus, bukan jadwal. Lama dari naik kendaraan pertama: `durationS - fromS`.'),
          v.metadata({ examples: [3420] })
        ),
        fromS: v.pipe(
          v.number(),
          v.description('Detik dari `at` sampai naik kendaraan pertama kalau tahap itu terjadwal (`departureAt` ada), selain itu 0. Biar lama perjalanannya bisa dihitung dari naik, sama seperti rute yang jadwalnya lengkap.'),
          v.metadata({ examples: [480] })
        ),
        rideS: v.pipe(
          v.array(v.nullable(v.number())),
          v.description('Sejajar dengan `legs`: perkiraan lama naik bus (detik) di tahap TransJakarta, null di tahap lain.')
        )
      })),
      v.description('Perkiraan waktu tempuh buat rute yang ada TransJakarta-nya, dari waktu tempuh bus yang teramati. Bukan jadwal: jangan ditampilkan sebagai jam berangkat atau jam tiba. Tidak ada kalau tidak bisa diperkirakan dengan jujur.')
    )
  }),
  v.title('FareJourney'),
  v.description('Satu pilihan rute lengkap dengan tarifnya. Yang dibandingkan cuma jumlah naik kendaraan, jarak jalan kaki, rata-rata lama nunggu, dan tarif, bukan waktu tempuh. Lama nunggu TransJakarta ikut menghitung bus yang datang bergerombol, dan di ruas yang dilewati beberapa rute dihitung dari bus rute mana pun yang datang duluan. Jam berangkat dan tiba ikut ditampilkan di tahap yang jadwalnya kami punya.'),
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
export type FareLegDeparture = v.InferOutput<typeof LegDepartureSchema>
export type FareJourneyDeparture = v.InferOutput<typeof JourneyDepartureSchema>
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
