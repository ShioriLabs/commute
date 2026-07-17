import type { FareSegment } from 'utils/fare-summary'

export interface FareResultStation {
  id: string
  name: string
}

export interface FareResultLineRef {
  lineCode: string
  lineName: string
  lineColor: string
  // Terminus this specific service heads toward (each interlining line forks to
  // its own terminus); null when not determinable.
  headsign: string | null
}

export interface FareResultRideLeg {
  type: 'RIDE'
  lineCode: string
  lineName: string
  lineColor: string
  operator: string
  from: FareResultStation
  to: FareResultStation
  stationCount: number
  // Full ordered station list, boarding → alighting (endpoints included).
  stops: FareResultStation[]
  // Terminus the train heads toward; null when not determinable (off-topology
  // lines, loop-ambiguous directions).
  headsign: string | null
  distanceM: number
  // Set (length ≥ 2) only when the leg runs on interlined/shared track served
  // by several service lines (e.g. the LRT Jabodebek DKA..CWG trunk); any of
  // them gets the rider there. Includes the primary line (first). Omitted for
  // ordinary single-line legs.
  serviceLines?: FareResultLineRef[]
}

export interface FareResultTransferLeg {
  type: 'TRANSFER'
  from: FareResultStation
  to: FareResultStation
  distanceM: number
}

export type FareResultLeg = FareResultRideLeg | FareResultTransferLeg

export type FareResultSegment = FareSegment & { fromName: string, toName: string }

export interface FareResult {
  from: FareResultStation
  to: FareResultStation
  legs: FareResultLeg[]
  segments: FareResultSegment[]
  totalFare: number | null
  totalDistanceM: number
  transferCount: number
}
