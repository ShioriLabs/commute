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
