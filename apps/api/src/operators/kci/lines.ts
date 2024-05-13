import { Line } from "models/line";

export const CIKARANG_LINE: Line = {
  name: 'Lin Cikarang',
  colorCode: '#25B8EB',
  lineCode: 'C'
} as const

export const BOGOR_LINE: Line = {
  name: 'Lin Bogor',
  colorCode: '#EE3D43',
  lineCode: 'B'
} as const

export const RANGKASBITUNG_LINE: Line = {
  name: 'Lin Rangkasbitung',
  colorCode: '#96C83E',
  lineCode: 'R'
} as const

export const TANGERANG_LINE: Line = {
  name: 'Lin Tangerang',
  colorCode: '#C15F28',
  lineCode: 'T'
} as const

export const TANJUNG_PRIOK_LINE: Line = {
  name: 'Lin Tanjung Priok',
  colorCode: '#ED4F98',
  lineCode: 'TP'
} as const

export const LINES = [CIKARANG_LINE, BOGOR_LINE, RANGKASBITUNG_LINE, TANGERANG_LINE, TANJUNG_PRIOK_LINE] as const
