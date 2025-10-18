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
}
