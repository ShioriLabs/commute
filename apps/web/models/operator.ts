import type { Operator as Operators } from '@commute/constants'
import type { Line } from './line'

export interface Operator {
  code: Operators
  name: string
}

export interface OperatorWithLines extends Operator {
  lines: Line[]
}
