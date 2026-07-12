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
  NUL: { code: 'NUL', name: 'Unknown' }
} as const

export type Operator = keyof (typeof OPERATORS)

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
