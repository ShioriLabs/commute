import type { FareResultLeg, FareResultTransferLeg } from '@commute/schemas'

/*
 * Back-to-back walks, as one.
 *
 * The router emits a TRANSFER per walking hop, so a rider who walks from a bus
 * stop to a station and on to the next station's concourse got two rows —
 * "Transit ke Sudirman", "Transit ke Dukuh Atas BNI" — for what they experience
 * as one walk, and the route bar and the transfer count agreed with the rows
 * rather than the rider. Merged here, on the API, so every client draws the
 * same thing without each having to learn the rule.
 *
 * The merged leg runs from where the first began to where the last ended, so
 * its destination label is the last stop reached. Walking is rounded UP: a
 * figure that sums two measured hops to the metre claims precision nobody walks
 * to, and rounding down would promise a shorter walk than the one on offer.
 */

/** Under this the walk is rounded to WALK_STEP_NEAR; at or over, to WALK_STEP_FAR. */
const WALK_NEAR_LIMIT_M = 500
const WALK_STEP_NEAR_M = 50
const WALK_STEP_FAR_M = 100

/** A merged walk's distance: up to the next 50 m under 500 m, else up to the next 100 m. */
export function roundWalkM(distanceM: number): number {
  const step = distanceM < WALK_NEAR_LIMIT_M ? WALK_STEP_NEAR_M : WALK_STEP_FAR_M
  return Math.ceil(distanceM / step) * step
}

/*
 * A walk that can be folded in: not a paid corridor.
 *
 * Those carry a fare and a label that the fare breakdown lists on their own
 * row, so folding one into a neighbour would either drop the surcharge or
 * smear it across a walk that does not cost it.
 */
const isPlainWalk = (leg: FareResultLeg): leg is FareResultTransferLeg =>
  leg.type === 'TRANSFER' && leg.fare === undefined && leg.corridorLabel === undefined

export interface MergedWalks {
  legs: FareResultLeg[]
  /** Legs folded away, so the rider-facing transfer count can drop by this many. */
  absorbed: number
  /** Metres added by rounding, so the journey's walking total can follow the legs. */
  roundingExtraM: number
}

/** Two or more consecutive plain walks become one; a lone walk keeps its exact distance. */
export function mergeConsecutiveWalks(legs: readonly FareResultLeg[]): MergedWalks {
  const merged: FareResultLeg[] = []
  let absorbed = 0
  let roundingExtraM = 0

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!
    if (!isPlainWalk(leg)) {
      merged.push(leg)
      continue
    }

    const run: FareResultTransferLeg[] = [leg]
    while (i + 1 < legs.length && isPlainWalk(legs[i + 1]!)) {
      run.push(legs[++i] as FareResultTransferLeg)
    }

    if (run.length === 1) {
      merged.push(leg)
      continue
    }

    const rawM = run.reduce((sum, walk) => sum + walk.distanceM, 0)
    const distanceM = roundWalkM(rawM)
    merged.push({ type: 'TRANSFER', from: run[0]!.from, to: run.at(-1)!.to, distanceM })
    absorbed += run.length - 1
    roundingExtraM += distanceM - rawM
  }

  return { legs: merged, absorbed, roundingExtraM }
}
