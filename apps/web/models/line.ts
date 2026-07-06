import type { Operator } from './operator'

export interface Line {
  name: string
  lineCode: string
  colorCode: `#${string}`
}

// ── Line detail (GET /lines/:operator/:lineCode) ────────────────────────────
// Mirrors apps/api/src/models/line.ts.

export interface LineDetailStation {
  id: string // `${operator}-${code}`
  code: string
  name: string
  stationNumber: string // e.g. 'C13', 'b23'
  isInterchange: boolean
  otherLines: Line[]
  distanceFromOriginM: number | null
}

export type LineSegmentKind = 'TRUNK' | 'CONTINUATION' | 'RAMP' | 'LOOP'

export interface LineDetailSegment {
  kind: LineSegmentKind
  joinsAtCode: string | null
  closesAtCode: string | null
  stations: LineDetailStation[]
}

export interface LineDetail {
  operator: Operator
  line: Line
  segments: LineDetailSegment[]
}
