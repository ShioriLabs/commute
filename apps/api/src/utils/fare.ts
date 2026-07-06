import { Operator, OPERATORS } from '@commute/constants'
import { getMRTJFare } from 'operators/mrtj/fares'

/*
 * Tariff rules per operator. All amounts in rupiah, all distances in metres.
 * Verified against official tariffs 2026-07-06:
 *  - KCI: progressive, 3000 for the first 25 km + 1000 per started 10 km.
 *  - LRTJ (LRT Jakarta): flat 5000.
 *  - LRTJBDB (LRT Jabodebek, KM 67/2023 jo. KM 70/2024): 5000 for the first
 *    km + 700 per started km, capped. The cap is time-dependent (20000 peak,
 *    10000 off-peak/weekends); we show the normal peak cap since fares here
 *    are time-agnostic.
 *  - MRTJ: published OD matrix (operators/mrtj/fares.ts).
 */
export const KCI_BASE_FARE = 3000
export const LRTJBDB_FARE_CAP = 20000

export interface FareSegmentInput {
  operator: Operator
  distanceM: number
  fromStationCode: string
  toStationCode: string
}

export function calculateSegmentFare(segment: FareSegmentInput): number | null {
  const { operator, distanceM } = segment
  switch (operator) {
    case OPERATORS.KCI.code:
      return KCI_BASE_FARE + Math.max(0, Math.ceil((distanceM - 25000) / 10000)) * 1000
    case OPERATORS.LRTJ.code:
      return 5000
    case OPERATORS.LRTJBDB.code:
      return Math.min(LRTJBDB_FARE_CAP, 5000 + Math.max(0, Math.ceil((distanceM - 1000) / 1000)) * 700)
    case OPERATORS.MRTJ.code:
      return getMRTJFare(segment.fromStationCode, segment.toStationCode)
    default:
      return null
  }
}
