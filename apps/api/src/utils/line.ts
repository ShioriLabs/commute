import { Operator, OPERATORS } from '@commute/constants'
import { TOPOLOGY } from 'db/data/topology'
import { LINES as KCI_LINES } from 'operators/kci/lines'
import { LINES as MRTJ_LINES } from 'operators/mrtj/lines'
import { LINES as LRTJ_LINES } from 'operators/lrtj/lines'
import { LINES as LRTJBDB_LINES } from 'operators/lrtjbdb/lines'
import { LINES as TJ_LINES } from 'operators/tj/lines'
import { LINES as APCGK_LINES } from 'operators/apcgk/lines'
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

/*
 * Lines that findTopology can resolve, as `OPERATOR:CODE`.
 *
 * Read from the topology data rather than from utils/topology to keep the
 * import one-way: utils/topology already depends on the line models, so
 * reaching back through it for this would close a cycle.
 */
const LINES_WITH_TOPOLOGY = new Set(
  TOPOLOGY.map(topology => `${topology.operator}:${topology.lineCode}`)
)

/*
 * Every line carries `searchable`, mirroring the flag on stations: false means
 * the line is real enough to be referenced but has no page to send anyone to.
 *
 * Topology is the condition because it is what /lines/:operator/:code needs —
 * without it that route 404s. TJ's 100 corridors come from the GTFS feed but
 * only the 31 BRT ones have hand-built topology, so the other 69 answered the
 * crawler with the bare SPA shell under a 200. Since the shell is identical for
 * all of them, Google read the set as one page duplicated 69 times.
 *
 * The lines stay in the dictionary either way. Stations still carry `TJ:2C` in
 * their `lines`, and a client resolving that key needs the name and colour.
 */
const withSearchable = (operator: Operator, lines: readonly Line[]): readonly Line[] =>
  lines.map(line => ({
    ...line,
    searchable: LINES_WITH_TOPOLOGY.has(`${operator}:${line.lineCode}`)
  }))

const describe = (operator: Operator, lines: readonly Line[]): readonly Line[] =>
  withSearchable(operator, withMode(operator, lines))

export const ALL_LINES: Record<Operator, readonly Line[]> = {
  [OPERATORS.KCI.code]: describe('KCI', KCI_LINES),
  [OPERATORS.MRTJ.code]: describe('MRTJ', MRTJ_LINES),
  [OPERATORS.LRTJ.code]: describe('LRTJ', LRTJ_LINES),
  [OPERATORS.LRTJBDB.code]: describe('LRTJBDB', LRTJBDB_LINES),
  [OPERATORS.APCGK.code]: describe('APCGK', APCGK_LINES),
  [OPERATORS.TJ.code]: describe('TJ', TJ_LINES),
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
