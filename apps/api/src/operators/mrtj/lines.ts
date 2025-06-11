import { Line } from 'models/line'

export const NORTH_SOUTH_LINE: Line = {
  name: 'Lin Utara Selatan',
  colorCode: '#ca2a51',
  lineCode: 'M'
} as const

export const LINES = [NORTH_SOUTH_LINE] as const
