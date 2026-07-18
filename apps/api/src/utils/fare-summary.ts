import type { FareContext, Operator } from '@commute/constants'
import { calculateSegmentFare, calculateTransferFare } from 'utils/fare'
import type { RideLeg, RouteLeg } from 'utils/router'

/*
 * Every TRANSFER leg is a tap-out, so each contiguous run of RIDE legs is one
 * paid journey; line changes inside a run happen at shared nodes and cost
 * nothing. Most transfers are free walks, but a few cross a paid corridor (e.g.
 * Dukuh Atas via KCI Sudirman) and carry their own fare — those are collected in
 * `pricedTransfers` and added to the total on top of the ride segments.
 */
export interface FareSegment {
  operator: string
  fromStationId: string
  toStationId: string
  distanceM: number
  fare: number | null
}

export interface PricedTransfer {
  fromStationId: string
  toStationId: string
  fare: number
  label: string
}

export interface FareSummary {
  segments: FareSegment[]
  pricedTransfers: PricedTransfer[]
  totalFare: number | null
  totalDistanceM: number
  transferCount: number
}

const stationCode = (stationId: string) => stationId.split('-').slice(1).join('-')

export function summarizeFares(legs: RouteLeg[], context: FareContext): FareSummary {
  const runs: RideLeg[][] = []
  const pricedTransfers: PricedTransfer[] = []
  let transferCount = 0
  let previousWasRide = false
  for (const leg of legs) {
    if (leg.type === 'TRANSFER') {
      transferCount++
      previousWasRide = false
      const priced = calculateTransferFare(leg.fromStationId, leg.toStationId, context)
      if (priced) {
        pricedTransfers.push({
          fromStationId: leg.fromStationId,
          toStationId: leg.toStationId,
          fare: priced.fare,
          label: priced.corridor.label
        })
      }
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
      }, context)
    }
  })

  const transfersTotal = pricedTransfers.reduce((sum, t) => sum + t.fare, 0)
  return {
    segments,
    pricedTransfers,
    // Any unknown segment fare poisons the total; priced transfers are always
    // concrete so they only add.
    totalFare: segments.some(s => s.fare === null)
      ? null
      : segments.reduce((sum, s) => sum + (s.fare ?? 0), 0) + transfersTotal,
    totalDistanceM: legs.reduce((sum, leg) => sum + leg.distanceM, 0),
    transferCount
  }
}
