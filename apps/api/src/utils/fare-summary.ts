import type { Operator } from '@commute/constants'
import { calculateSegmentFare } from 'utils/fare'
import type { RideLeg, RouteLeg } from 'utils/router'

/*
 * Every TRANSFER leg is a tap-out (all transfers are physical walks between
 * distinct stations), so each contiguous run of RIDE legs is one paid journey.
 * Line changes inside a run happen at shared station nodes and cost nothing.
 */
export interface FareSegment {
  operator: string
  fromStationId: string
  toStationId: string
  distanceM: number
  fare: number | null
}

export interface FareSummary {
  segments: FareSegment[]
  totalFare: number | null
  totalDistanceM: number
  transferCount: number
}

const stationCode = (stationId: string) => stationId.split('-').slice(1).join('-')

export function summarizeFares(legs: RouteLeg[]): FareSummary {
  const runs: RideLeg[][] = []
  let transferCount = 0
  let previousWasRide = false
  for (const leg of legs) {
    if (leg.type === 'TRANSFER') {
      transferCount++
      previousWasRide = false
      continue
    }
    if (previousWasRide) {
      runs[runs.length - 1]!.push(leg)
    } else {
      runs.push([leg])
    }
    previousWasRide = true
  }

  const segments: FareSegment[] = runs.map((run) => {
    const first = run[0]!
    const fromStationId = first.fromStationId
    const toStationId = run[run.length - 1]!.toStationId
    const distanceM = run.reduce((sum, leg) => sum + leg.distanceM, 0)
    return {
      operator: first.operator,
      fromStationId,
      toStationId,
      distanceM,
      fare: calculateSegmentFare({
        operator: first.operator as Operator,
        distanceM,
        fromStationCode: stationCode(fromStationId),
        toStationCode: stationCode(toStationId)
      })
    }
  })

  return {
    segments,
    totalFare: segments.some(s => s.fare === null) ? null : segments.reduce((sum, s) => sum + (s.fare ?? 0), 0),
    totalDistanceM: legs.reduce((sum, leg) => sum + leg.distanceM, 0),
    transferCount
  }
}
