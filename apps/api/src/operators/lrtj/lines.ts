import { Line } from 'models/line'

export const SOUTH_LINE: Line = {
  lineCode: 'S',
  name: 'Lin Selatan',
  colorCode: '#F26324'
} as const

export const LINES = [SOUTH_LINE] as const
