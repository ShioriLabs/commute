import { Line } from 'models/line'

export const BEKASI_LINE: Line = {
  name: 'Lin Bekasi',
  colorCode: '#006838',
  lineCode: 'BK'
} as const

export const CIBUBUR_LINE: Line = {
  name: 'Lin Cibubur',
  colorCode: '#21409A',
  lineCode: 'CB'
} as const

export const LINES = [BEKASI_LINE, CIBUBUR_LINE] as const
