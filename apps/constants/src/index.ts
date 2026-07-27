/**
 * Code for station's or line's region code, denoted with the core city's nearest airport's IATA code
 */
export const REGIONS = {
  CGK: { code: 'CGK', name: 'Jabodetabek' },
  BDO: { code: 'BDO', name: 'Bandung Raya' },
  YIA: { code: 'YIA', name: 'Jogja-Solo' },
  NUL: { code: 'NUL', name: 'Unknown' }
} as const

export type RegionCode = keyof (typeof REGIONS)

export const OPERATORS = {
  KCI: { code: 'KCI', name: 'Commuter Line' },
  MRTJ: { code: 'MRTJ', name: 'MRT Jakarta' },
  LRTJ: { code: 'LRTJ', name: 'LRT Jakarta' },
  LRTJBDB: { code: 'LRTJBDB', name: 'LRT Jabodebek' },
  TJ: { code: 'TJ', name: 'TransJakarta' },
  NUL: { code: 'NUL', name: 'Unknown' }
} as const

export type Operator = keyof (typeof OPERATORS)

/**
 * Operators that participate in the JakLingko integrated fare (Tarif Integrasi):
 * MRT Jakarta, LRT Jakarta, and TransJakarta (BRT) only. KCI (Commuter Line) and
 * LRT Jabodebek (LRTJBDB) are NOT integrated — their legs are charged at full
 * tariff on top of the capped integrated portion. See JAKLINGKO_JOURNEY_CAP.
 * Verified 2026-07-18 against jaklingkoindonesia.co.id/faq-tarif-integrasi.
 */
export const JAKLINGKO_OPERATORS: ReadonlySet<Operator> = new Set(['MRTJ', 'LRTJ', 'TJ'])

export const MRTJ_STATION_CODES: Record<number, string> = {
  20: 'LBB',
  21: 'FTM',
  29: 'CPR',
  30: 'HJN',
  31: 'BLA',
  32: 'BLM',
  33: 'SSM',
  34: 'SNY',
  35: 'IST',
  36: 'BNH',
  37: 'STB',
  38: 'DKA',
  39: 'BHI'
}

export const LRTJ_STATION_CODES: Record<number, string> = {
  6: 'PGD',
  5: 'BVU',
  4: 'BVS',
  3: 'PUM',
  2: 'EQS',
  1: 'VEL'
}

export const AMENITY_TYPES = {
  TOILET: 'Toilet',
  TOILET_ACCESSIBLE: 'Toilet Difabel',
  PARKING: 'Parkir',
  BIKE_PARKING: 'Parkir Sepeda',
  WIFI: 'WiFi',
  CHARGING_STATION: 'Charging Station',
  PRAYING_ROOM: 'Mushola',
  ESCALATOR_UNPAID: 'Eskalator (Area Umum)',
  ESCALATOR_PAID: 'Eskalator (Area Berbayar)',
  ELEVATOR_UNPAID: 'Lift (Area Umum)',
  ELEVATOR_PAID: 'Lift (Area Berbayar)',
  LOCKERS: 'Loker',
  NURSING_ROOM: 'Ruang Menyusui'
} as const

export type AmenityType = keyof typeof AMENITY_TYPES

export type TransferDataType = 'INTERNAL' | 'EXTERNAL'

/**
 * How the rider pays. STORED_VALUE is per-operator e-money (today's default).
 * JAKLINGKO is the tap-in integrated fare: a journey spanning two or more of the
 * participating operators (MRTJ / LRTJ / TJ — see JAKLINGKO_OPERATORS) — in any
 * order, no starting-operator requirement — has that portion capped at a single
 * Rp 10,000 within a 3-hour window from the first tap-in. KCI and LRT Jabodebek
 * are NOT integrated: their legs are charged at full tariff on top of the cap, and
 * a single-operator trip (e.g. MRT end-to-end) is never capped. There is only one
 * tier (no separate 5k branded-card cap; that Rp 5k figure belongs to the
 * JakLingko *app* QR route-ticket, a different product we don't model). Any
 * qualifying bank e-money (Flazz / e-Money / Brizzi / TapCash / JakCard) or
 * JakLingko card gets this once activated. See JAKLINGKO_JOURNEY_CAP.
 * QRIS_TAP is the tap-to-pay QRIS flow — NOT integrated (no cap), and notably it
 * can't apply the discounted Dukuh Atas surcharge, so it pays the full
 * pass-through (see SURCHARGED_CORRIDORS).
 * Verified 2026-07-18 against jaklingkoindonesia.co.id/faq-tarif-integrasi.
 */
export const PAYMENT_METHODS = {
  STORED_VALUE: 'STORED_VALUE',
  JAKLINGKO: 'JAKLINGKO',
  QRIS_TAP: 'QRIS_TAP'
} as const

export type PaymentMethod = keyof typeof PAYMENT_METHODS

/**
 * Journey-level context that fare calculation depends on beyond the path itself:
 * payment method (integration rules) and departure time (peak/off-peak caps).
 * `departureAt` is always supplied by the caller (the route defaults it to now);
 * optionality lives at the request layer, not here.
 */
export interface FareContext {
  paymentMethod: PaymentMethod
  departureAt: Date
}

/**
 * Transfers that cross a paid area and therefore may carry a passerby surcharge,
 * unlike ordinary free walking transfers. LRT Jabodebek Dukuh Atas is reachable
 * only across the JPM Dukuh Atas footbridge, which is gated behind KCI Sudirman
 * (the KCI-SUD ↔ LRTJBDB-DKA transfer is its sole connection). Someone using
 * Sudirman purely as a pedestrian pass-through taps into and out of its gates
 * without boarding a KAI train — that tap-in/out is the surcharge: a nominal Rp1
 * (card) / full KCI base fare (QRIS_TAP, which can't apply the discount).
 *
 * Riders who actually travel through Sudirman on a KCI train are already inside
 * those gates, so no extra tap happens and the surcharge does not apply. That's
 * `gatedStationId` + `throughOperator`: a `throughOperator` RIDE adjacent to the
 * transfer at `gatedStationId` means the rider transited by train, not on foot.
 *
 * `stationIds` is an unordered pair of full `${operator}-${code}` ids (router
 * transfers are symmetric).
 */
export interface SurchargedCorridor {
  stationIds: [string, string]
  gatedStationId: string // the paid-gate station whose tap-in/out is the surcharge
  throughOperator: Operator // a RIDE on this operator at gatedStationId = transited by train, not a passerby
  discountedFare: number // STORED_VALUE / JAKLINGKO
  fullFare: number // QRIS_TAP
  label: string
  // Metres walked *inside* the gated paid area (gate → peron → gate), between
  // this corridor edge and a chained free-walk transfer on the other side.
  // Edge distances are measured gate-to-gate, so this internal segment is
  // uncounted until the two transfers are merged into one journey step.
  internalWalkM?: number
}

export const SURCHARGED_CORRIDORS: SurchargedCorridor[] = [
  {
    stationIds: ['KCI-SUD', 'LRTJBDB-DKA'],
    gatedStationId: 'KCI-SUD',
    throughOperator: 'KCI',
    discountedFare: 1,
    fullFare: 3000,
    label: 'Transit berbayar via Peron Sudirman',
    internalWalkM: 140
  }
]

export const CIKARANG_LOOP_LINE_INTERLINING_STATION_CODES = new Set([
  'CKR',
  'TLM',
  'CIT',
  'TB',
  'BKST',
  'BKS',
  'KRI',
  'CUK',
  'KLDB',
  'BUA',
  'KLD',
  'JNG'
])

/**
 * Curated platform overlay for departure direction groups.
 * Key: `${stationId}:${lineCode}:${nextHopStationCode}` (e.g. 'KCI-CUK:C:KLDB').
 * Value: bare platform identifier per GTFS convention ("3/4", not "Peron 3/4");
 * the UI adds the "Peron" prefix. Missing key -> no badge, direction still renders.
 *
 * The next-hop code is the FIRST station served in that direction, which is not
 * always the geographic neighbour — read it off the direction group's `key`
 * (`${nextHopCode}:${via}`) rather than inferring it from the line topology.
 * Several groups can share one next hop (Cakung's Manggarai-via and Senen-via
 * Jakarta-bound groups both leave via KLDB) and correctly share one entry.
 *
 * Verified entries only. Platform assignments change with engineering work and
 * are reassigned operationally, so an unverified guess is worse than no badge:
 * absent -> the UI simply omits it, wrong -> riders wait trackside.
 *
 * Sourcing rule. Two acceptable sources:
 *   (a) field observation;
 *   (b) the id.wikipedia "diagram lintasan stasiun" table, which lists a
 *       direction per numbered jalur — but ONLY for stations whose platforms
 *       map one-to-one onto our direction groups.
 * Wikipedia was validated against field data at Cakung and Sudirman: both
 * matched exactly. It is NOT acceptable where the article flags the layout as
 * provisional/under construction, or where one platform serves several of our
 * direction groups (see the deliberate omissions below).
 *
 * Values are the platform a rider stands on. Where an island platform sits
 * between two tracks that both serve one direction, the range is kept ("1/2")
 * because that is how the station signs it.
 */
export const PLATFORM_CODES: Record<string, string> = {
  // ── Field-verified (rider report) ────────────────────────────────────────
  // Cakung (Lin Cikarang) — 1/2 eastbound to Bekasi, 3/4 westbound to Jakarta.
  // Both Jakarta-bound groups (via Manggarai, via Pasar Senen) leave via KLDB.
  // Corroborated by id.wikipedia: jalur 1-2 -> Cikarang, jalur 3-4 ->
  // Jatinegara/Angke/Kampung Bandan.
  'KCI-CUK:C:KRI': '1/2',
  'KCI-CUK:C:KLDB': '3/4',

  // Sudirman (Lin Cikarang) — 1 towards BNI City, 2 towards Manggarai.
  // Corroborated by id.wikipedia: jalur 1 -> Angke/Kampung Bandan, jalur 2 ->
  // Cikarang via Manggarai.
  'KCI-SUD:C:SUDB': '1',
  'KCI-SUD:C:MRI': '2',

  // Kranji (Lin Cikarang) — 1 to Bekasi/Cikarang, 2 the reverse. Worth noting
  // because id.wikipedia still describes the layout as a "trial" arrangement
  // dating from the Jan 2019 new building; the field check supersedes that.
  'KCI-KRI:C:BKS': '1',
  'KCI-KRI:C:CUK': '2',

  // Manggarai (Lin Cikarang) — 1/2 westbound (next hop Sudirman), 3/4 eastbound
  // to Bekasi/Cikarang. The rider report and the Dec 2023 reporting agree here:
  // "peron 1-2 arah Tanah Abang/Kampung Bandan" and "next hop Sudirman" are the
  // same platform described by destination vs by next stop.
  // Lin Bogor at Manggarai is NOT recorded — see the omissions note below.
  'KCI-MRI:C:SUD': '1/2',
  'KCI-MRI:C:MTR': '3/4',

  // Jatinegara (Lin Cikarang) — 1 to Bekasi/Cikarang, 2 to Manggarai. Supersedes
  // the id.wikipedia diagram, which spreads commuter services over jalur 1-6 and
  // flags the assignment as provisional. The third group (via Pasar Senen, next
  // hop Pondok Jati) is a distinct direction and is deliberately left unset.
  'KCI-JNG:C:KLD': '1',
  'KCI-JNG:C:MTR': '2',

  // ── From id.wikipedia layout diagrams ────────────────────────────────────
  // Matraman (Lin Cikarang) — single island platform, two tracks, unambiguous.
  // jalur 1 -> Angke/Kampung Bandan, jalur 2 -> Bekasi/Cikarang (Jatinegara).
  'KCI-MTR:C:MRI': '1',
  'KCI-MTR:C:JNG': '2',

  // Tanah Abang (new building, operational 4 Nov 2025; two outlets agree).
  // Peron 1 -> Duri/Angke/Kampung Bandan AND Cikarang via Pasar Senen;
  // peron 2 -> Bekasi/Cikarang via Manggarai. Rangkasbitung departures leave
  // from 5/6 (arrivals terminate at 3/4 and are shunted across).
  'KCI-THB:C:DU': '1',
  'KCI-THB:C:KAT': '2',
  'KCI-THB:R:PLM': '5/6',

  // Duri — jalur 1 is the diverging track for Cikarang via Pasar Senen
  // (Angke-bound), jalur 2 the straight track for Cikarang via Manggarai
  // (Tanah Abang-bound); jalur 5 is the Tangerang line terminus.
  'KCI-DU:C:AK': '1',
  'KCI-DU:C:THB': '2',
  'KCI-DU:T:GGL': '5',

  // Lin Cikarang, eastern corridor. Each is an island platform between the two
  // KRL tracks; the flanking jalur 3-4 are non-stop long-distance roads. As at
  // Cakung, the via-Manggarai and via-Pasar Senen groups share one next hop and
  // therefore one platform.
  'KCI-KLD:C:BUA': '1', // Klender — jalur 1 to Cikarang
  'KCI-KLD:C:JNG': '2', // jalur 2 to Jatinegara/Angke/Kampung Bandan
  'KCI-BUA:C:KLDB': '1', // Buaran — jalur 1 to Cikarang
  'KCI-BUA:C:KLD': '2',

  // Lin Bogor, southern corridor. NOTE the numbering does NOT run consistently
  // along the line — Tebet, Tanjung Barat and Universitas Pancasila put jalur 1
  // on the Bogor-bound side while their neighbours put it on the Jakarta-bound
  // side. Each was read off its own layout diagram; do not extrapolate.
  'KCI-CW:B:TEB': '1', // Cawang — jalur 1 to Manggarai/Jakarta Kota
  'KCI-CW:B:DRN': '2',
  'KCI-DRN:B:CW': '1', // Duren Kalibata — jalur 1 to Jakarta Kota
  'KCI-DRN:B:PSMB': '2',
  'KCI-PSMB:B:DRN': '1', // Pasar Minggu Baru — jalur 1 to Jakarta Kota
  'KCI-PSMB:B:PSM': '2',
  'KCI-PSM:B:PSMB': '1/2', // Pasar Minggu — paired island platforms per direction
  'KCI-PSM:B:TNT': '3/4',
  'KCI-TEB:B:MRI': '2', // Tebet — REVERSED: jalur 2 to Jakarta Kota
  'KCI-TEB:B:CW': '1',
  'KCI-LNA:B:TNT': '1', // Lenteng Agung — jalur 1 to Manggarai
  'KCI-LNA:B:UP': '2',
  'KCI-TNT:B:PSM': '2', // Tanjung Barat — REVERSED: jalur 2 to Jakarta Kota
  'KCI-TNT:B:LNA': '1',
  'KCI-UP:B:LNA': '2', // Universitas Pancasila — REVERSED: jalur 2 to Jakarta Kota
  'KCI-UP:B:UI': '1',
  'KCI-CKI:B:GDD': '1', // Cikini — jalur 1 to Jakarta Kota
  'KCI-CKI:B:MRI': '2',

  // Lin Bogor, city centre (Manggarai -> Jakarta Kota). Consistent along this
  // stretch: jalur 1 to Jakarta Kota, jalur 2 to Bogor/Nambo.
  'KCI-GDD:B:JUA': '1', // Gondangdia
  'KCI-GDD:B:CKI': '2',
  'KCI-JUA:B:SW': '1', // Juanda
  'KCI-JUA:B:GDD': '2',
  'KCI-SW:B:MGB': '1', // Sawah Besar
  'KCI-SW:B:JUA': '2',
  'KCI-MGB:B:JAY': '1', // Mangga Besar
  'KCI-MGB:B:SW': '2',
  'KCI-JAY:B:JAKK': '1', // Jayakarta
  'KCI-JAY:B:MGB': '2',

  // Lin Bogor, Depok stretch. Universitas Indonesia is REVERSED relative to
  // Pondok Cina next door — jalur 1 southbound rather than northbound.
  'KCI-UI:B:POC': '1', // Universitas Indonesia — jalur 1 to Depok/Bogor
  'KCI-UI:B:UP': '2',
  'KCI-POC:B:UI': '1', // Pondok Cina — jalur 1 to Jakarta Kota
  'KCI-POC:B:DPB': '2',

  // Lin Bogor, south of Depok. Bojonggede and Cilebut are REVERSED — jalur 2
  // northbound, jalur 1 to Bogor.
  'KCI-CTA:B:DP': '1', // Citayam — jalur 1 to Jakarta Kota. The Bogor and Nambo
  // groups both leave on jalur 2 and the source does not separate them, so only
  // the northbound direction is recorded here.
  'KCI-BJD:B:CTA': '2', // Bojonggede
  'KCI-BJD:B:CLT': '1',
  'KCI-CLT:B:BJD': '2', // Cilebut
  'KCI-CLT:B:BOO': '1',

  // Lin Tangerang. Consistent along the line: jalur 1 to Duri, jalur 2 to
  // Tangerang. Rawa Buaya is omitted — its jalur 2 is bidirectional and shared
  // with the Basoetta line, so it has no per-direction mapping.
  'KCI-BOI:T:TKO': '1', // Bojong Indah
  'KCI-BOI:T:RW': '2',
  'KCI-KDS:T:RW': '1', // Kalideres
  'KCI-KDS:T:PI': '2',
  'KCI-PI:T:KDS': '1', // Poris
  'KCI-PI:T:BPR': '2',
  'KCI-TTI:T:BPR': '1', // Tanah Tinggi
  'KCI-TTI:T:TNG': '2',

  // Lin Cikarang, far east. Cibitung and Metland Telagamurni are OPPOSITE to
  // each other despite being adjacent — read each from its own diagram.
  'KCI-CIT:C:TLM': '1', // Cibitung — jalur 1 to Cikarang
  'KCI-CIT:C:TB': '2',
  'KCI-TLM:C:CIT': '1', // Metland Telagamurni — jalur 1 to Jakarta
  'KCI-TLM:C:CKR': '2',

  // Lin Rangkasbitung, Tanah Abang -> Serpong. Mostly jalur 1 outbound
  // (Serpong/Rangkasbitung) and jalur 2 to Tanah Abang, but Jurangmangu and
  // Sudimara are REVERSED — read each from its own diagram.
  'KCI-PLM:R:KBY': '1', // Palmerah
  'KCI-PLM:R:THB': '2',
  'KCI-KBY:R:PDJ': '1', // Kebayoran — jalur 3 exists but is a bidirectional
  'KCI-KBY:R:PLM': '2', // "sepur salah"; only 1 and 2 are scheduled directions
  'KCI-PDJ:R:JMU': '1', // Pondok Ranji
  'KCI-PDJ:R:KBY': '2',
  'KCI-JMU:R:PDJ': '1', // Jurangmangu — REVERSED: jalur 1 to Tanah Abang
  'KCI-JMU:R:SDM': '2',
  'KCI-SDM:R:RU': '1', // Sudimara — jalur 1 outbound, 2 to Tanah Abang
  'KCI-SDM:R:JMU': '2', // (jalur 3 also Tanah Abang-bound but near-disused)
  'KCI-RU:R:SRP': '1', // Rawa Buntu
  'KCI-RU:R:SDM': '2',
  'KCI-CSK:R:CC': '1', // Cisauk
  'KCI-CSK:R:SRP': '2',

  // Lin Rangkasbitung, Cicayur -> Rangkasbitung. Cilejit, Daru and Tenjo are
  // REVERSED (jalur 1 to Tanah Abang) relative to their neighbours. Parung
  // Panjang splits four tracks cleanly by direction, so it carries ranges.
  'KCI-CC:R:JTK': '1', // Cicayur
  'KCI-CC:R:CSK': '2',
  'KCI-JTK:R:PRP': '1', // Jatake
  'KCI-JTK:R:CC': '2',
  'KCI-PRP:R:CJT': '1/2', // Parung Panjang — 1/2 outbound, 3/4 to Tanah Abang
  'KCI-PRP:R:JTK': '3/4',
  'KCI-DAR:R:CJT': '1', // Daru — REVERSED: jalur 1 to Tanah Abang
  'KCI-DAR:R:TEJ': '2', // (jalur 3 is a badug siding)
  'KCI-TEJ:R:DAR': '1', // Tenjo — REVERSED: jalur 1 to Tanah Abang
  'KCI-TEJ:R:TGS': '2',
  'KCI-CKY:R:MJ': '1', // Cikoya
  'KCI-CKY:R:TGS': '2',
  'KCI-MJ:R:CTR': '1', // Maja — jalur 3 is a badug siding
  'KCI-MJ:R:CKY': '2',
  'KCI-CTR:R:RK': '1', // Citeras — jalur 3 is a storage/stopping track
  'KCI-CTR:R:MJ': '2',

  // Lin Cikarang, far east. Bekasi Timur and Klender Baru are OPPOSITE to each
  // other. As elsewhere on this line the via-Manggarai and via-Pasar Senen
  // groups share a next hop and therefore one platform.
  'KCI-BKST:C:TB': '1', // Bekasi Timur — jalur 1 to Cikarang
  'KCI-BKST:C:BKS': '2',
  'KCI-KLDB:C:BUA': '1', // Klender Baru — jalur 1 to Jakarta
  'KCI-KLDB:C:CUK': '2',

  // Lin Cikarang, Pasar Senen branch (the "full racket" loop).
  'KCI-POK:C:JNG': '1', // Pondok Jati — jalur 1 to Jatinegara
  'KCI-POK:C:KMT': '2',
  'KCI-KMT:C:POK': '1', // Kramat — jalur 1 to Pondok Jati
  'KCI-KMT:C:GST': '2',
  'KCI-KMO:C:PSE': '1', // Kemayoran — jalur 1 to Pasar Senen/Cikampek
  'KCI-KMO:C:RJW': '2',
  'KCI-RJW:C:KMO': '1', // Rajawali — jalur 1 towards Pasar Senen/Cikarang
  'KCI-RJW:C:KPB': '2',

  // Lin Cikarang, western arc.
  // NOTE Karet is scheduled to close on 28 Sep 2026 and become a concourse for
  // BNI City; drop its two entries when that happens.
  'KCI-KAT:C:THB': '1', // Karet — jalur 1 towards Tanah Abang/Angke
  'KCI-KAT:C:SUDB': '2',
  'KCI-SUDB:C:KAT': '1', // BNI City — jalur 1 towards Angke
  'KCI-SUDB:C:SUD': '2'

  /*
   * Deliberately omitted — do not fill these in without a field check:
   *
   * Manggarai Lin Bogor (KCI-MRI:B:*). The Cikarang platforms above are from a
   * rider report, but the Bogor-line ones are not. Published figures say peron
   * 9-12, tracing to Dec 2023 reporting — and Manggarai has been reconfigured
   * at least twice since (switch-over 1 Feb 2025; stopping points on peron 1-4
   * moved again 1 May 2026), with jalur 10 closed for revitalisation at one
   * point. Needs eyes on the platform, not a source.
   *
   * Jatinegara C:POK (via Pasar Senen, next hop Pondok Jati). A third departure
   * direction beyond the Bekasi/Manggarai pair recorded above; no report covers
   * it, and it cannot be inferred from the other two.
   *
   * Tanah Abang R:SYN:* — the Angke and Manggarai short-workings. The sources
   * describe Rangkasbitung-line arrivals/departures but do not say which
   * platform these specific short-turn services use.
   *
   * Duri T:SYN:Manggarai — the Basoetta-shared jalur 3/4 distinction does not
   * map cleanly onto this group.
   *
   * Stations whose layout has no per-direction mapping (a platform serves both
   * ways, so no badge can be correct): Depok Baru (jalur 2 both directions),
   * Rawa Buaya (jalur 2 bidirectional and shared with Basoetta), Tambun
   * (services spread over four tracks, jalur 1 both directions), Serpong
   * (jalur 1 both directions, Tanah Abang split over 3 and 4), Tigaraksa
   * (jalur 1 both directions, Tanah Abang split over 3 and 4).
   *
   * Cilejit (CJT) — the id.wikipedia diagram is captioned "rencana" (planned),
   * so it describes an intended layout rather than current operations.
   *
   * Rangkasbitung (RK) — terminus; the source does not say which of its several
   * platforms scheduled Tanah Abang departures use.
   *
   * Cikarang (CKR) and Angke (AK) — a bidirectional jalur 1 at each, with the
   * remaining tracks not splitting cleanly across our direction groups.
   *
   * Bekasi (BKS) — eight tracks; the published jalur 5/6/7 assignments are
   * described as "sepur lurus arah Jakarta Kota / Cikampek", which does not map
   * onto our Manggarai vs Pasar Senen groups.
   *
   * Gang Sentiong (GST) — the source describes its two jalur as via-Pasar-Senen
   * vs via-Manggarai, but our two groups there are towards Pasar Senen and
   * towards Kramat/Jatinegara. The axes do not correspond; needs a field check.
   *
   * Pasar Senen (PSE) and Kampung Bandan (KPB) — PSE has a single direction
   * group (no choice to disambiguate); KPB carries five groups across three
   * lines including the Tanjung Priok shuttle, and no source covers that split.
   *
   * Citayam B:BJD and B:PDRG — the Bogor and Nambo services both depart from
   * jalur 2 and the source does not distinguish them. Only the northbound
   * direction is recorded.
   */
}

/**
 * Stations promoted into direction labels despite not being interchanges or
 * junctions. Stands in for the search score (unset network-wide today).
 * Key: `${operator}:${stationCode}`.
 * KMT: Kramat becomes a transfer point when the LRTJ extension opens.
 */
export const DIRECTION_LABEL_BOOST_STATIONS = new Set([
  'KCI:PSE',
  'KCI:KMT'
])

/**
 * Termini that schedules reference but the routable topology cannot reach.
 * Key: `${operator}:${lineCode}:${destinationStationCode}`.
 * `walkToward` is the in-topology station to path toward instead.
 * `viaFromTripPrefix` splits the trains by trip-number prefix into loop sides,
 * applied only at stations whose timetable is already via-split.
 */
export interface OffTopologyProxy {
  walkToward: string
  viaFromTripPrefix?: { prefix: string, via: string, elseVia: string }
}

export const OFF_TOPOLOGY_TERMINUS_PROXIES: Record<string, OffTopologyProxy> = {
  // Late-night Cikarang-line workings divert beyond Kampung Bandan to Jakarta
  // Kota; Jakarta Kota is deliberately outside the routable C topology.
  'KCI:C:JAKK': { walkToward: 'KPB', viaFromTripPrefix: { prefix: '6', via: 'PSE', elseVia: 'MRI' } },
  // The airport station is absent from the stations DB; Batu Ceper is the
  // last in-topology stop of the Basoetta line.
  'KCI:A:BST': { walkToward: 'BPR' }
}

/**
 * boundFor display names that don't resolve against station names.
 * Key: normalized boundFor (lowercase, alphanumerics only) -> station code.
 * Covers KCI feed quirks still present in synced data (no-space names, the
 * literal "undefined " prefix bug) and the DB-less airport station.
 */
export const BOUND_FOR_STATION_ALIASES: Record<string, string> = {
  jakartakota: 'JAKK',
  tanahabang: 'THB',
  tanjungpriuk: 'TPK',
  bandarasoekarnohatta: 'BST',
  undefinedparungpanjang: 'PRP'
}
