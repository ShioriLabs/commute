import type { AmenityType } from '@commute/constants'
import type { Line } from './line'
import type { Operator } from './operator'

export interface Station {
  id: string
  name: string
  formattedName: string | null
  code: string
  region: string
  regionCode: 'CGK' | 'BDO' | 'YIA' | 'NUL'
  operator: Operator
  lines: Line[]
  createdAt: Date
  updatedAt: Date
  timetableSynced: number
  score: number
  // true = searchable (default), false = topology-only (hidden from search).
  searchable: boolean
  amenities: Amenity[]
  latitude: number | null
  longitude: number | null
}

export interface Amenity {
  type: AmenityType
  text?: string
}
