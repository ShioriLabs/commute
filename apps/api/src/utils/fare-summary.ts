import { JAKLINGKO_OPERATORS, type FareContext, type Operator } from '@commute/constants'
import { calculateSegmentFare, calculateTransferFare, JAKLINGKO_JOURNEY_CAP } from 'utils/fare'
import type { RideLeg, RouteLeg } from 'utils/router'

/*
 * Every TRANSFER leg is a tap-out, so each contiguous run of RIDE legs is one
 * paid journey; line changes inside a run happen at shared nodes and cost
 * nothing. Most transfers are free walks, but a few cross a surcharged corridor
 * (e.g. Dukuh Atas via KCI Sudirman) and carry a passerby surcharge — those are
 * collected in `surchargedTransfers` and added to the total on top of the ride
 * segments.
 */
export interface FareSegment {
  operator: string
  fromStationId: string
  toStationId: string
  distanceM: number
  fare: number | null
}

export interface SurchargedTransfer {
  fromStationId: string
  toStationId: string
  fare: number
  label: string
}

export interface FareSummary {
  segments: FareSegment[]
  surchargedTransfers: SurchargedTransfer[]
  totalFare: number | null
  totalDistanceM: number
  transferCount: number
}

const stationCode = (stationId: string) => stationId.split('-').slice(1).join('-')

/*
 * JakLingko's integrated fare (Tarif Integrasi) only covers MRTJ / LRTJ / TJ
 * (JAKLINGKO_OPERATORS), and only when the journey spans two or more of them —
 * "lebih dari satu jenis angkutan umum". That participating portion is capped at
 * JAKLINGKO_JOURNEY_CAP; everything else is charged in full and added on top:
 *   - a single-operator trip (even split by a walk, e.g. MRT LBB→BHI = 14000)
 *     is never capped;
 *   - KCI and LRT Jabodebek legs are NOT integrated, so their fares add on top of
 *     the cap rather than being clamped into it.
 * Surcharged transfers (e.g. the Dukuh Atas corridor, which taps KCI-SUD) sit
 * outside the integrated portion too, so they always add. `rawTotal` is the known,
 * uncapped grand total; this returns it clamped only where the cap applies.
 *
 * KNOWN-INCORRECT (deferred, 2026-07-18): this sums each participating operator's
 * OWN tariff and only clamps at the 10k cap. The real Tarif Integrasi REPLACES the
 * per-operator tariffs for the integrated portion with a single distance formula:
 *   integrated = min(2500 boarding once + 250 * (sum of participating leg km), 10000)
 * charged as: full normal tariff deducted up front, the difference refunded as
 * cashback in the JakLingko app. Official worked example (jaklingkoindonesia.co.id/
 * tarif-integrasi): MRT LBB→ASEAN 9km + TJ CSW→Puri Beta 7km ⇒ 2500 + 250*16 =
 * 6500 (not the 10000 this code currently returns). Reworking to the formula is on
 * hold pending a decision on how to present the charge-then-cashback flow; distance
 * will be sum(participating seg.distanceM)/1000. See JAKLINGKO_JOURNEY_CAP.
 */
function applyJakLingkoCap(segments: FareSegment[], rawTotal: number, context: FareContext): number {
  if (context.paymentMethod !== 'JAKLINGKO') return rawTotal

  const participating = segments.filter(s => JAKLINGKO_OPERATORS.has(s.operator as Operator))
  const distinctParticipating = new Set(participating.map(s => s.operator)).size
  if (distinctParticipating < 2) return rawTotal // not a multimodal integrated journey

  const participatingTotal = participating.reduce((sum, s) => sum + (s.fare ?? 0), 0)
  if (participatingTotal <= JAKLINGKO_JOURNEY_CAP) return rawTotal // nothing to clamp

  // Clamp only the integrated portion; the rest of rawTotal (non-participating
  // segments + surcharged transfers) rides along at full price.
  return rawTotal - participatingTotal + JAKLINGKO_JOURNEY_CAP
}

export function summarizeFares(legs: RouteLeg[], context: FareContext): FareSummary {
  const runs: RideLeg[][] = []
  const surchargedTransfers: SurchargedTransfer[] = []
  let transferCount = 0
  let previousWasRide = false
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!
    if (leg.type === 'TRANSFER') {
      transferCount++
      previousWasRide = false
      const surcharge = calculateTransferFare(leg.fromStationId, leg.toStationId, context, {
        prev: legs[i - 1],
        next: legs[i + 1]
      })
      if (surcharge) {
        surchargedTransfers.push({
          fromStationId: leg.fromStationId,
          toStationId: leg.toStationId,
          fare: surcharge.fare,
          label: surcharge.corridor.label
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

  const transfersTotal = surchargedTransfers.reduce((sum, t) => sum + t.fare, 0)
  // Any unknown segment fare poisons the total; surcharged transfers are always
  // concrete so they only add.
  const rawTotal = segments.some(s => s.fare === null)
    ? null
    : segments.reduce((sum, s) => sum + (s.fare ?? 0), 0) + transfersTotal
  const totalFare = rawTotal === null ? null : applyJakLingkoCap(segments, rawTotal, context)
  return {
    segments,
    surchargedTransfers,
    totalFare,
    totalDistanceM: legs.reduce((sum, leg) => sum + leg.distanceM, 0),
    transferCount
  }
}
