import { Line } from 'models/line'

/*
 * Grey is the line's own colour, taken from the roundel FDTJ drew for it
 * (Highlight-✈︎-00 Line Roundle.png) rather than picked: the Kalayang is
 * signed in airport grey, not in a transit-network palette colour.
 */
export const KALAYANG_LINE: Line = {
  name: 'Lin Kalayang Bandara',
  colorCode: '#6D6E71',
  lineCode: 'KLB'
} as const

export const LINES = [KALAYANG_LINE] as const
