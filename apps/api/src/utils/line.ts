import { Operator, OPERATORS } from '@commute/constants'
import { LINES as KCI_LINES } from 'operators/kci/lines'
import { LINES as MRTJ_LINES } from 'operators/mrtj/lines'
import { LINES as LRTJ_LINES } from 'operators/lrtj/lines'
import { LINES as LRTJBDB_LINES } from 'operators/lrtjbdb/lines'
import { LINES as TJ_LINES } from 'operators/tj/lines'
import { Line } from 'models/line'

/*
 * Every line carries a mode, defaulting to its operator's.
 *
 * GTFS puts route_type on the route, so the API exposes it there too — but no
 * operator in this dataset runs mixed modes, and TJ's 100 corridors are
 * machine-generated from the GTFS feed. Filling the default here keeps the
 * per-line definitions free of a field that would be the same on all 110 of
 * them, while leaving an explicit `mode` on a line free to win when one
 * eventually differs.
 */
const withMode = (operator: Operator, lines: readonly Line[]): readonly Line[] =>
  lines.map(line => (line.mode ? line : { ...line, mode: OPERATORS[operator].mode }))

export const ALL_LINES: Record<Operator, readonly Line[]> = {
  [OPERATORS.KCI.code]: withMode('KCI', KCI_LINES),
  [OPERATORS.MRTJ.code]: withMode('MRTJ', MRTJ_LINES),
  [OPERATORS.LRTJ.code]: withMode('LRTJ', LRTJ_LINES),
  [OPERATORS.LRTJBDB.code]: withMode('LRTJBDB', LRTJBDB_LINES),
  [OPERATORS.TJ.code]: withMode('TJ', TJ_LINES),
  [OPERATORS.NUL.code]: []
} as const

export const LINE_LOOKUP_TABLE: Map<string, Line> = new Map()

for (const [operator, lines] of Object.entries(ALL_LINES)) {
  for (const line of lines) {
    LINE_LOOKUP_TABLE.set(`${operator}:${line.lineCode}`, line)
  }
}

export function getLineByOperator(operator: Operator, lineCode: string) {
  return LINE_LOOKUP_TABLE.get(`${operator}:${lineCode}`) ?? null
}
