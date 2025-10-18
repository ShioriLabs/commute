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
