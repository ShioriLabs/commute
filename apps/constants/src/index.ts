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
 * Key: `${stationId}:${lineCode}:${nextHopStationCode}` (e.g. 'KCI-CUK:C:KLD').
 * Value: bare platform identifier per GTFS convention ("3/4", not "Peron 3/4");
 * the UI adds the "Peron" prefix. Missing key -> no badge, direction still renders.
 */
export const PLATFORM_CODES: Record<string, string> = {}

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
