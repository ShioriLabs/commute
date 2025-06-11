import { Operator, OPERATORS } from '@commute/constants'
import { LINES as KCI_LINES } from 'operators/kci/lines'
import { LINES as MRTJ_LINES } from 'operators/mrtj/lines'
import { LINES as LRTJ_LINES } from 'operators/lrtj/lines'
import { Line } from 'models/line'

export const ALL_LINES: Record<Operator, readonly Line[]> = {
  [OPERATORS.KCI.code]: KCI_LINES,
  [OPERATORS.MRTJ.code]: MRTJ_LINES,
  [OPERATORS.LRTJ.code]: LRTJ_LINES,
  [OPERATORS.NUL.code]: []
} as const

export function getLineByOperator(operator: Operator, lineCode: string) {
  const operatorLines = ALL_LINES[operator]
  if (!operatorLines) return null

  const line = operatorLines.find(ln => ln.lineCode === lineCode)
  return line || null
}
