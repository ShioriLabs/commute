import type { FareSegment } from 'utils/fare-summary'

export interface FareResultStation {
  id: string
  name: string
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
  distanceM: number
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
