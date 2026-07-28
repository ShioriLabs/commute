import type { Operator } from '@commute/constants'

export interface Line {
  name: string
  lineCode: string
  colorCode: `#${string}`
}

// ── Line detail (GET /lines/:operator/:lineCode) ────────────────────────────
// Ordered line structure for the line page, built from db/data/topology.ts.

export interface LineDetailStation {
  id: string // `${operator}-${code}`
  code: string
  name: string // formattedName ?? name
  stationNumber: string // topology `pos`, e.g. 'C13', 'b23'
  isInterchange: boolean
  // Other same-operator lines at this station (current line excluded), as line
  // keys. Cross-operator interchange lives in transfers.
  otherLines: string[]
}

// TRUNK: the main path. CONTINUATION: a branch that extends the trunk's end
// and reads as the mainline (Bogor branch at Citayam). RAMP: a side branch
// forking off a mid/endpoint (Nambo). LOOP: a branch that closes back onto
// the trunk (Cikarang's central loop at Jatinegara).
export type LineSegmentKind = 'TRUNK' | 'CONTINUATION' | 'RAMP' | 'LOOP'

export interface LineDetailSegment {
  kind: LineSegmentKind
  joinsAtCode: string | null // branch.fromStation; null for TRUNK
  stations: LineDetailStation[]
}

export interface LineDetail {
  operator: { code: Operator, name: string }
  line: Line
  segments: LineDetailSegment[]
}
