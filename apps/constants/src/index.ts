/**
 * Code for station's or line's region code, denoted with the core city's nearest airport's IATA code
 */
export const REGIONS = {
  CGK: { code: 'CGK', name: 'Jabodetabek' },
  BDO: { code: 'BDO', name: 'Bandung Raya' },
  YIA: { code: 'YIA', name: 'Jogja-Solo' },
  NUL: { code: 'NUL', name: 'Unknown' },
} as const

export type RegionCode = keyof (typeof REGIONS)

export const OPERATORS = {
  KCI: { code: 'KCI', name: 'Kereta Commuter Indonesia' },
  MRTJ: { code: 'MRTJ', name: 'MRT Jakarta' },
  NUL: { code: 'NUL', name: 'Unknown' },
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
