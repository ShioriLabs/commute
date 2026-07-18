import { FareContext, Operator, OPERATORS } from '@commute/constants'
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

/*
 * Coarse time bucket for fare purposes. LRT Jabodebek's cap is peak on weekdays
 * 07:00–09:00 and 16:00–19:00, off-peak otherwise (incl. weekends). Bucketing to
 * peak|offpeak — rather than raw time — keeps the fare cache small while staying
 * correct once the cap goes time-dependent (step 2). Times are WIB (UTC+7).
 */
export type FareTimeBucket = 'peak' | 'offpeak'

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000

export function fareTimeBucket(date: Date): FareTimeBucket {
  const wib = new Date(date.getTime() + WIB_OFFSET_MS)
  const day = wib.getUTCDay() // 0 Sun … 6 Sat, in WIB after the shift
  if (day === 0 || day === 6) return 'offpeak'
  const hour = wib.getUTCHours()
  const isPeak = (hour >= 7 && hour < 9) || (hour >= 16 && hour < 19)
  return isPeak ? 'peak' : 'offpeak'
}

// `context` is threaded now for a stable signature; step 2 reads departureAt for
// the LRT cap and step 4 reads paymentMethod. It is intentionally unused here.
export function calculateSegmentFare(segment: FareSegmentInput, context: FareContext): number | null {
  void context
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
