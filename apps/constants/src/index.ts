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

/*
 * Transit modes, named after the GTFS `route_type` values they map to.
 *
 * GTFS spells the mode as an integer on each route; we carry the name and keep
 * the number beside it, because `RAIL` survives a schema change and `2` does
 * not. The five here are the ones Jabodetabek actually runs — GTFS defines
 * others (ferry, cable tram, funicular) that no operator in this dataset uses,
 * so they are left out rather than declared and never referenced.
 *
 * The distinction that matters to a rider is SUBWAY vs RAIL: both are trains,
 * but Commuter Line is a commuter railway sharing national track while MRT
 * Jakarta is a metro. GTFS draws the same line.
 *
 * MONORAIL is the airport Kalayang, an automated people-mover circulating
 * inside Soekarno-Hatta. It is not a tram: it shares no street, runs driverless
 * on its own elevated guideway, and is free. GTFS 12 is the closest honest
 * route_type, and the one Google Maps renders it with.
 */
export const TRANSIT_MODES = {
  RAIL: { name: 'RAIL', gtfsRouteType: 2, label: 'Kereta' },
  SUBWAY: { name: 'SUBWAY', gtfsRouteType: 1, label: 'MRT' },
  TRAM: { name: 'TRAM', gtfsRouteType: 0, label: 'LRT' },
  BUS: { name: 'BUS', gtfsRouteType: 3, label: 'Bus' },
  MONORAIL: { name: 'MONORAIL', gtfsRouteType: 12, label: 'Kalayang' }
} as const

export type TransitMode = keyof typeof TRANSIT_MODES

/*
 * Operators, carrying the fields GTFS puts in `agency.txt`.
 *
 * `code`/`name` are `agency_id`/`agency_name`; `url`, `timezone`, and `lang`
 * are the other three fields GTFS marks Required. They were previously
 * implicit — every timestamp in this API is already Asia/Jakarta and every
 * name already Indonesian — and stating them costs nothing while making an
 * agency.txt export a mapping rather than a research task.
 *
 * `agency_id` here is our own code, not the one an operator publishes in its
 * own feed: TransJakarta's feed calls itself `Tije`. Ours is the ID this API
 * has always used and that every station and line key is built from, so it
 * stays. An exporter that needs to match an upstream feed should map at the
 * boundary rather than have us rename our primary key.
 *
 * `mode` is the operator's predominant mode, used to label an operator when no
 * specific line is in hand. It is NOT a substitute for a per-line mode: GTFS
 * puts route_type on the route, and an operator running mixed modes would need
 * it there. None here do today.
 *
 * `agency_phone`, `agency_email`, and `agency_fare_url` are deliberately
 * absent: they are Optional in GTFS, and publishing an operator's customer
 * service line in a developer API invites it to be used as one.
 */
export const OPERATORS = {
  KCI: {
    code: 'KCI',
    name: 'Commuter Line',
    // commuterline.id redirects here; kci.id is the canonical host.
    url: 'https://kci.id/',
    timezone: 'Asia/Jakarta',
    lang: 'id',
    mode: 'RAIL'
  },
  MRTJ: {
    code: 'MRTJ',
    name: 'MRT Jakarta',
    url: 'https://jakartamrt.co.id/',
    timezone: 'Asia/Jakarta',
    lang: 'id',
    mode: 'SUBWAY'
  },
  LRTJ: {
    code: 'LRTJ',
    name: 'LRT Jakarta',
    url: 'https://lrtjakarta.co.id/',
    timezone: 'Asia/Jakarta',
    lang: 'id',
    mode: 'TRAM'
  },
  LRTJBDB: {
    code: 'LRTJBDB',
    name: 'LRT Jabodebek',
    url: 'https://lrtjabodebek.kai.id/',
    timezone: 'Asia/Jakarta',
    lang: 'id',
    mode: 'TRAM'
  },
  TJ: {
    code: 'TJ',
    name: 'TransJakarta',
    // The URL TransJakarta publishes in its own GTFS agency.txt.
    url: 'https://transjakarta.co.id/',
    timezone: 'Asia/Jakarta',
    lang: 'id',
    mode: 'BUS'
  },
  /*
   * The Soekarno-Hatta airport people-mover (Kalayang), run by the airport
   * operator rather than a transit agency. `APCGK` is Angkasa Pura + the
   * airport's IATA code: InJourney Airports is Angkasa Pura rebranded, so the
   * code outlives the branding and extends to their other airports if those
   * ever appear. The CGK here names the AIRPORT, not REGIONS.CGK (Jabodetabek)
   * — same three letters, unrelated namespaces.
   */
  APCGK: {
    code: 'APCGK',
    name: 'Kalayang Bandara',
    url: 'https://soekarnohatta.injourneyairports.id/',
    timezone: 'Asia/Jakarta',
    lang: 'id',
    mode: 'MONORAIL'
  },
  /*
   * Not a real operator and never served: `getOperatorByCode` returns it for an
   * unknown code, and /operators filters it out. Its fields are placeholders
   * that exist only so the type stays uniform.
   */
  NUL: {
    code: 'NUL',
    name: 'Unknown',
    url: '',
    timezone: 'Asia/Jakarta',
    lang: 'id',
    mode: 'RAIL'
  }
} as const satisfies Record<string, {
  code: string
  name: string
  url: string
  timezone: string
  lang: string
  mode: TransitMode
}>

export type Operator = keyof (typeof OPERATORS)

/**
 * Operators that participate in the JakLingko integrated fare (Tarif Integrasi):
 * MRT Jakarta, LRT Jakarta, and TransJakarta (BRT) only. KCI (Commuter Line) and
 * LRT Jabodebek (LRTJBDB) are NOT integrated — their legs are charged at full
 * tariff on top of the capped integrated portion. See JAKLINGKO_JOURNEY_CAP.
 * Verified 2026-07-18 against jaklingkoindonesia.co.id/faq-tarif-integrasi.
 */
export const JAKLINGKO_OPERATORS: ReadonlySet<Operator> = new Set(['MRTJ', 'LRTJ', 'TJ'])

/**
 * MRT Jakarta stations keyed by the CMS slug from the middleware datum feed
 * (see operators/mrtj/sync.ts). `name` is the sponsor-free official base name
 * ("Lebak Bulus"); the sponsored display name comes from the feed at sync time.
 * Slugs can change when a station is re-sponsored (they sometimes embed the
 * sponsor, e.g. bundaran-hi-bank-jakarta) — unknown slugs are skipped by the
 * sync, so update this map when a station drops out of a resync.
 */
export const MRTJ_STATIONS_BY_SLUG: Record<string, { code: string, name: string }> = {
  'stasiun-lebak-bulus': { code: 'LBB', name: 'Lebak Bulus' },
  'stasiun-fatmawati-indomaret': { code: 'FTM', name: 'Fatmawati' },
  'stasiun-cipete-raya': { code: 'CPR', name: 'Cipete Raya' },
  'stasiun-haji-nawi': { code: 'HJN', name: 'Haji Nawi' },
  'stasiun-blok-a': { code: 'BLA', name: 'Blok A' },
  'stasiun-blok-m-bca': { code: 'BLM', name: 'Blok M' },
  'stasiun-asean': { code: 'SSM', name: 'ASEAN' },
  'stasiun-senayan-mastercard': { code: 'SNY', name: 'Senayan' },
  'stasiun-istora-mandiri': { code: 'IST', name: 'Istora' },
  'stasiun-bendungan-hilir': { code: 'BNH', name: 'Bendungan Hilir' },
  'stasiun-setiabudi-astra': { code: 'STB', name: 'Setiabudi' },
  'stasiun-dukuh-atas-bni': { code: 'DKA', name: 'Dukuh Atas' },
  'bundaran-hi-bank-jakarta': { code: 'BHI', name: 'Bundaran HI' }
}

/*
 * Platform number -> station code, for the Phase 1A stations only.
 *
 * NOTE: two of these codes diverge from the initials LRT Jakarta is submitting
 * for GAPEKA (which follow the AFC system): PGD is KPG there, and EQS is EQT.
 * Ours are kept as-is deliberately — the codes are load-bearing across
 * stations.id, edges, schedules and the curated map points.
 *
 * Phase 1B opened 2026-08-26 without disturbing either: the platform signage
 * renumbered the line S01..S11 but still names S01 Kelapa Gading and S05
 * Equestrian, so both codes still read true. Phase 1B's own S09/S10 codes are
 * the ones now out of step with their names — see the note in
 * db/data/topology.ts.
 */
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

/*
 * `hub` — several distinct, differently-named stations under one complex.
 * `integrated` — one place to a rider, split across operators only in the data.
 * The authoritative definition lives in apps/api/src/db/schemas/hubs.ts; this
 * mirrors it so both the API and the web app can label a hub without importing
 * across app boundaries.
 */
export type HubKind = 'hub' | 'integrated'

/*
 * What we call each kind in the UI. "Pumpunan moda" is the operators' own term
 * for a multi-mode interchange building (CSW is officially Pumpunan Moda Cakra
 * Selaras Wahana), so a real complex gets that name; an `integrated` grouping is
 * one station to a rider and keeps the plainer label.
 *
 * Shared because the API builds hub subtitles for /_internal/searchables while
 * the web app still renders them directly on the hub pages.
 */
export const HUB_KIND_LABEL: Record<HubKind, string> = {
  hub: 'Pumpunan Moda',
  integrated: 'Stasiun Terintegrasi'
}

/**
 * Upper bound of `stations.score` and `hubs.score`.
 *
 * The search surfaces divide by this to get a popularity term in [0, 1], and
 * utils/fuzzy-match.ts spaces its match tiers 2 apart on the strength of that
 * bound — a wider span would let a popular station's window-typo match outrank
 * an unpopular station's exact match. Generated scores are clamped to it; see
 * apps/api/src/db/scripts/generateStationScoresSQL.ts.
 */
export const STATION_SCORE_MAX = 100

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
 * unlike ordinary free walking transfers. The JPM Dukuh Atas footbridge is a
 * public building, freely enterable from the river's south bank; what is gated
 * is the CROSSING from the north, which runs through KCI Sudirman. So this
 * models the northern approach — the KCI-SUD ↔ LRTJBDB-DKA transfer, the only
 * connection the network graph carries. Someone using
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
 *
 * Two things a future reader should not "correct" from a web search:
 *
 * 1. The free south-bank entry noted above is field-verified, not documented.
 *    Operator and press sources only ever describe the northern gated approach,
 *    so they will look like a contradiction. They are not — they just never
 *    cover the other side.
 * 2. KAI Commuter (3 Jan 2026) attaches a condition to the Rp1 we do not model:
 *    it applies only if the rider clears the gates within 15 minutes, otherwise
 *    the normal Rp3.000 applies even on a card. Modelling it needs a dwell time
 *    the router does not have, and at internalWalkM 140 m the discounted fare is
 *    correct for any ordinary walk. Left for the fare-cap rework.
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
  //
  // RECHECK PERIODICALLY: Manggarai is the least stable station on the network.
  // Cikarang services moved in SO-7 (Dec 2023), a further switch-over landed
  // 1 Feb 2025, stopping points on peron 1-4 changed again 1 May 2026, and
  // jalur 10 has been closed for revitalisation at least once. All four entries
  // below are rider-reported and current as of Jul 2026.
  'KCI-MRI:C:SUD': '1/2',
  'KCI-MRI:C:MTR': '3/4',

  // Manggarai (Lin Bogor) — 9/10 to Jakarta Kota, 11/12 to Bogor/Nambo/Depok.
  // Reporting only ever said "peron 9-12 for Bogor services" without splitting
  // them; the rider report supplies the split.
  'KCI-MRI:B:CKI': '9/10',
  'KCI-MRI:B:TEB': '11/12',

  // Jatinegara (Lin Cikarang) — 2 towards Manggarai, 5 towards Pasar Senen.
  // Both rider-reported, superseding the id.wikipedia diagram which spreads
  // commuter services over jalur 1-6 and flags the assignment as provisional.
  'KCI-JNG:C:MTR': '2', // towards Manggarai/BNI City/Kampung Bandan
  'KCI-JNG:C:POK': '5', // towards Kramat/Pasar Senen/Kampung Bandan
  // Eastbound (C:KLD) is deliberately unset — see the omissions note.

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
  // Citayam — 1 towards Manggarai/Jakarta Kota, 2 towards Bogor and towards
  // Nambo. The branch splits south of here, so both southbound groups share
  // jalur 2; rider-reported.
  'KCI-CTA:B:DP': '1',
  'KCI-CTA:B:BJD': '2',
  'KCI-CTA:B:PDRG': '2',
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
  // Gang Sentiong — 1 towards Kramat/Jatinegara, 2 towards Pasar Senen and on
  // to Kampung Bandan. Rider-reported: the published diagram labels these
  // tracks by loop route ("via Pasar Senen" vs "via Manggarai") rather than by
  // which way the train leaves, so it could not be mapped onto these groups.
  'KCI-GST:C:KMT': '1',
  'KCI-GST:C:PSE': '2',
  'KCI-KMO:C:PSE': '1', // Kemayoran — jalur 1 to Pasar Senen/Cikampek
  'KCI-KMO:C:RJW': '2',
  'KCI-RJW:C:KMO': '1', // Rajawali — jalur 1 towards Pasar Senen/Cikarang
  'KCI-RJW:C:KPB': '2',

  // Lin Cikarang, western arc.
  // Karet closed in September 2026: KAI Commuter moved all of its operations to
  // Sudirman Baru/BNI City, which absorbs it as a concourse. Its two entries are
  // gone and BNI City's jalur 1 now points at Tanah Abang, the new next hop.
  // The stop is also out of TOPOLOGY, so the C line runs THB -> SUDB direct.
  'KCI-SUDB:C:THB': '1', // BNI City — jalur 1 towards Angke
  'KCI-SUDB:C:SUD': '2',

  // Depok — four tracks, but only the outer pair is directional: jalur 1 is the
  // northbound sepur lurus and jalur 4 the southbound one. Jalur 2 and 3 are
  // bidirectional and deliberately not represented here.
  'KCI-DP:B:DPB': '1',
  'KCI-DP:B:CTA': '4',

  // Depok Baru — 1 towards Jakarta Kota, 3 towards Depok/Citayam/Nambo/Bogor.
  // Rider-reported. The layout diagram shows jalur 2 serving both directions,
  // which is why this was initially skipped; scheduled services use the outer
  // pair, so jalur 2 is deliberately not represented.
  'KCI-DPB:B:POC': '1',
  'KCI-DPB:B:DP': '3',

  // Lin Tangerang, Duri end. Pesing is REVERSED relative to Grogol and Taman
  // Kota. Batu Ceper's commuter services use jalur 3/4, not 1/2 — the lower
  // numbers there belong to the airport line and long-distance platforms.
  'KCI-GGL:T:DU': '2', // Grogol — jalur 1 to Tangerang, 2 to Duri
  'KCI-GGL:T:PSG': '1',
  'KCI-PSG:T:GGL': '1', // Pesing — REVERSED: jalur 1 to Duri
  'KCI-PSG:T:TKO': '2',
  'KCI-TKO:T:PSG': '2', // Taman Kota — jalur 1 to Tangerang, 2 to Duri
  'KCI-TKO:T:BOI': '1',
  'KCI-BPR:T:PI': '4', // Batu Ceper — jalur 4 to Duri, 3 to Tangerang
  'KCI-BPR:T:TTI': '3',

  // Lin Tanjung Priok. Jalur 3-4 at Ancol and JIS are freight (KA peti kemas)
  // on the Rajawali alignment and carry no passenger service.
  'KCI-AC:TP:KPB': '1', // Ancol — jalur 1 to Jakarta Kota
  'KCI-AC:TP:JIS': '2',
  // JIS has four tracks but only ONE operational side platform: building the
  // opposite face needs trackwork, and that side runs towards Rajawali rather
  // than Jakarta Kota. Every passenger departure therefore uses jalur 1.
  'KCI-JIS:TP:AC': '1',
  // Tanjung Priok terminus — commuter services use jalur 1-2 of the eight.
  'KCI-TPK:TP:JIS': '1/2'

  /*
   * Deliberately omitted — do not fill these in without a field check:
   *
   * Jatinegara eastbound (C:KLD) — UNSET BY DECISION, not for lack of data.
   * Bekasi/Cikarang departures use platform 1 or platform 6 depending on which
   * way the train reached Jatinegara (the Cikarang line is a loop, arriving via
   * Manggarai or via Pasar Senen). All 160 eastbound departures share a single
   * direction group with no `via` split, so this key can hold only one value
   * and either choice would mislead half the riders. Filling it in needs a
   * per-arrival-route platform dimension the schema does not have.
   *
   * Short-turn services (Tanah Abang -> Angke / Manggarai, Duri -> Manggarai)
   * CANNOT be given a platform here, whatever value is written. They are built
   * by syntheticGroup() in utils/directions.ts, which sets nextHopCode: null,
   * and the lookup in routes/stations.ts only fires when a next hop exists —
   * so any key for them would be dead. Supporting them needs a fallback in
   * that lookup, not another entry in this table.
   *
   * Operationally these are Commuter Line Cikarang runs, so they use the same
   * platforms as the Cikarang groups at each station (Tanah Abang: 1 towards
   * Angke, 2 towards Manggarai; Duri: 2 towards Manggarai).
   *
   * They appear under lineCode R/T because KCI'S OWN FEED mislabels them, not
   * because of anything we do: c-access shows trip 1676C badged "Commuter Line
   * Rangkasbitung" while routing it Tanah Abang -> Karet -> Sudirman Baru ->
   * Sudirman -> Manggarai (10:17-10:28), which is Cikarang alignment
   * throughout. (That trace predates Karet's September 2026 closure, hence the
   * stop; the mislabelling it evidences is unaffected.) Do not "fix" this in the importer — a feed refresh would undo
   * it. An override keyed on trip number is the durable shape if these ever
   * need to display on the right line, since lineCode also drives colour and
   * roundel.
   *
   * Stations whose layout has no per-direction mapping (a platform serves both
   * ways, so no badge can be correct):
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
   * Pasar Senen (PSE) and Kampung Bandan (KPB) — PSE has a single direction
   * group (no choice to disambiguate); KPB carries five groups across three
   * lines including the Tanjung Priok shuttle, and no source covers that split.
   *
   * Nambo branch: Pondok Rajeg (PDRG) is single-track and Cibinong (CBN) runs
   * both directions over its jalur 1, so neither has a per-direction platform.
   *
   * Jakarta Kota (JAKK) — Bogor departures are spread over jalur 10 and 11 with
   * no rule for which is used, and the source does not cover the Cikarang
   * groups at all.
   *
   * Single-group termini: Bogor (BOO), Nambo (NMO), Pasar Senen (PSE),
   * Rangkasbitung (RK), Tangerang (TNG). A badge cannot disambiguate a
   * direction at these, but it still tells a rider which platform to walk to,
   * so they are worth filling in when a source names the departure platform —
   * as done for Tanjung Priok (TPK). They are unset here only because no
   * source states which platform scheduled departures use.
   *
   */
}

/**
 * Stations promoted into direction labels despite not being interchanges or
 * junctions. Curated, and staying that way: `stations.score` cannot replace it.
 * Score is constant along a line (every train stops everywhere), so PSE scores
 * identically to every other Line-C station, and the resolution this needs is
 * exactly the resolution score lacks. `groupDirections` is also deliberately
 * DB-free — see utils/directions.ts.
 * Key: `${operator}:${stationCode}`.
 * KMT: Kramat becomes a transfer point when the LRTJ extension opens, so no
 * derived signal could produce it today anyway.
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
  'KCI:C:JAKK': { walkToward: 'KPB', viaFromTripPrefix: { prefix: '6', via: 'PSE', elseVia: 'MRI' } }
}

/**
 * boundFor display names that don't resolve against station names.
 * Key: normalized boundFor (lowercase, alphanumerics only) -> station code.
 * Covers KCI feed quirks still present in synced data: no-space names and the
 * literal "undefined " prefix bug.
 */
export const BOUND_FOR_STATION_ALIASES: Record<string, string> = {
  jakartakota: 'JAKK',
  tanahabang: 'THB',
  tanjungpriuk: 'TPK',
  undefinedparungpanjang: 'PRP'
}
