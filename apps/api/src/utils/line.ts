import { Operator, OPERATORS } from '@commute/constants'
import { LINES as KCI_LINES } from 'operators/kci/lines'
import { LINES as MRTJ_LINES } from 'operators/mrtj/lines'
import { LINES as LRTJ_LINES } from 'operators/lrtj/lines'
import { LINES as LRTJBDB_LINES } from 'operators/lrtjbdb/lines'
import { Line } from 'models/line'

export const ALL_LINES: Record<Operator, readonly Line[]> = {
  [OPERATORS.KCI.code]: KCI_LINES,
  [OPERATORS.MRTJ.code]: MRTJ_LINES,
  [OPERATORS.LRTJ.code]: LRTJ_LINES,
  [OPERATORS.LRTJBDB.code]: LRTJBDB_LINES,
  [OPERATORS.NUL.code]: []
} as const

export const LINE_LOOKUP_TABLE: Map<string, Line> = new Map()

for (const [operator, lines] of Object.entries(ALL_LINES)) {
  for (const line of lines) {
    LINE_LOOKUP_TABLE.set(`${operator}:${line.lineCode}`, line)
  }
}

export function getLineByOperator(operator: Operator, lineCode: string) {
  return LINE_LOOKUP_TABLE.get(`${operator}:${lineCode}`) || null
}
