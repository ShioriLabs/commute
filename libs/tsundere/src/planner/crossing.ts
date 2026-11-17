/*
 * Level crossings inside a station: a change whose short way runs across the
 * tracks, and is shut whenever a train is about.
 *
 * From LRT Dukuh Atas, exit C lands riders on Sudirman's platform 1, which
 * serves Kampung Bandan and Tanah Abang. Trains towards Manggarai and Bekasi
 * leave from platform 2, across both tracks. The quick way over is a crossing on
 * the platform floor; the other is to walk the platform, up to the concourse and
 * back down. The crossing closes for any train on either track, the rider's own
 * included, and for KA Bandara running through without stopping. So a fixed
 * walk is wrong in both directions: it quotes trains the shut crossing makes
 * impossible, and it cannot say which way round the rider should go.
 *
 * Closure, as the user observed it on site (2026-11-11): shut about one to two
 * minutes before a train arrives or passes, open again about ten seconds after
 * it has gone. "Sometimes I can't pass because I'm blocked by my very own
 * train."
 *
 * The whole thing reduces to one number per train, its CUTOFF: the latest clock
 * at which a rider standing at the crossing approach still catches it. Arriving
 * earlier never hurts, since a rider can always wait on the far platform, so
 * catchability is monotonic in the rider's clock and a client can test it with
 * one comparison instead of redoing this file.
 */

import { tripsFrom, type IndexedPattern, type Trip, type TripIndex } from './trips'

/** A train running through a station without stopping, timed between its neighbours. */
export interface PassingLine {
  lineCode: string
  /** The stop before the crossing station, on the side `fraction` is measured from. */
  from: string
  /** The stop after it. The two must be back to back on the pattern, in either order. */
  to: string
  /** How far from `from` towards `to` the crossing sits, as a share of the run time. */
  fraction: number
}

export interface LevelCrossing {
  /** The transfer leg that lands riders on the near side, as `from>to`. */
  transfer: string
  /** The station the crossing is in. */
  station: string
  /** Next stops of trains that leave from the FAR platform. Boarding anything else needs no crossing. */
  farSideNextStops: readonly string[]
  /** Across the tracks, approach to far platform. */
  crossWalkM: number
  /** Platform length, up to the concourse and back down, in place of the crossing. */
  concourseDetourM: number
  /** How long before a train arrives or passes the crossing shuts. */
  leadS: number
  /** How long after it has gone the crossing opens. */
  clearS: number
  /** Dwell assumed where the feed has no per-stop arrival (KCI never does). */
  dwellS: number
  passing: readonly PassingLine[]
}

/*
 * Every number here is a PLACEHOLDER until the two runs are timed on site:
 * LRT gate to platform 2 over the crossing when it is open, and round by the
 * concourse at an ordinary crowd. Only `leadS` and `clearS` come from
 * observation, and `leadS` takes the cautious end of "one to two minutes".
 *
 * `fraction`: Commuter Line trains take about 4:00 Manggarai to Sudirman out of
 * about 4:30 Manggarai to BNI City, so a through train is near Sudirman nine
 * tenths of the way along. KA Bandara runs faster and without stopping, which
 * this does not model; the 2:10 closure swamps the error.
 */
export const LEVEL_CROSSINGS: readonly LevelCrossing[] = [
  {
    transfer: 'LRTJBDB-DKA>KCI-SUD',
    station: 'KCI-SUD',
    farSideNextStops: ['KCI-MRI'],
    crossWalkM: 25, // UNMEASURED
    concourseDetourM: 250, // UNMEASURED
    leadS: 120,
    clearS: 10,
    dwellS: 30, // UNMEASURED
    passing: [{ lineCode: 'A', from: 'KCI-MRI', to: 'KCI-SUDB', fraction: 0.9 }] // fraction UNMEASURED
  }
]

const BY_TRANSFER = new Map(LEVEL_CROSSINGS.map(crossing => [crossing.transfer, crossing]))

/** The crossing a transfer leg lands riders in front of, if any. */
export const crossingForTransfer = (fromStationId: string, toStationId: string): LevelCrossing | undefined =>
  BY_TRANSFER.get(`${fromStationId}>${toStationId}`)

/** Whether boarding a leg whose stops are these means crossing to the far platform. */
export const boardsOnFarSide = (crossing: LevelCrossing, stationIds: readonly string[]): boolean =>
  stationIds[0] === crossing.station && crossing.farSideNextStops.includes(stationIds[1] ?? '')

/** Merged closures, sorted: each `[start, end]` with no gap to the next. */
type Blocks = readonly (readonly [number, number])[]

/*
 * The closures every train makes, merged into blocks.
 *
 * Memoised per index and day mask: the index is built once at load, and every
 * journey through this crossing on the same day asks the same question.
 */
const blockCache = new WeakMap<TripIndex, Map<string, Blocks>>()

export function closureBlocks(trips: TripIndex, crossing: LevelCrossing, dayMask: number): Blocks {
  let perIndex = blockCache.get(trips)
  if (!perIndex) {
    perIndex = new Map()
    blockCache.set(trips, perIndex)
  }
  const key = `${crossing.transfer}|${dayMask}`
  const cached = perIndex.get(key)
  if (cached) return cached

  const intervals: [number, number][] = []
  const runs = (trip: Trip) => (trip.dayMask & dayMask) !== 0

  // Trains calling at the station, either track: shut from before the arrival until they leave.
  for (const pattern of trips.byStop.get(crossing.station) ?? []) {
    const at = pattern.stopIndex.get(crossing.station)!
    for (const trip of pattern.trips) {
      if (!runs(trip)) continue
      const departureS = trip.departuresS[at]!
      const arrivalS = trip.arrivalsS?.[at] ?? departureS - crossing.dwellS
      intervals.push([arrivalS - crossing.leadS, departureS + crossing.clearS])
    }
  }

  // Trains running through.
  for (const passing of crossing.passing) {
    for (const pattern of trips.byLine.get(passing.lineCode) ?? []) {
      const from = pattern.stopIndex.get(passing.from)
      const to = pattern.stopIndex.get(passing.to)
      if (from === undefined || to === undefined || Math.abs(from - to) !== 1) continue
      for (const trip of pattern.trips) {
        if (!runs(trip)) continue
        const fromS = trip.departuresS[from]!
        const toS = trip.departuresS[to]!
        const passS = fromS + passing.fraction * (toS - fromS)
        intervals.push([passS - crossing.leadS, passS + crossing.clearS])
      }
    }
  }

  intervals.sort((a, b) => a[0] - b[0])
  const blocks: [number, number][] = []
  for (const [start, end] of intervals) {
    const last = blocks.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else blocks.push([start, end])
  }
  perIndex.set(key, blocks)
  return blocks
}

/** The block containing `atS`, by binary search, or undefined when the crossing is open then. */
function blockAt(blocks: Blocks, atS: number): readonly [number, number] | undefined {
  let low = 0
  let high = blocks.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (blocks[mid]![1] < atS) low = mid + 1
    else high = mid
  }
  const block = blocks[low]
  return block && block[0] <= atS ? block : undefined
}

/** When a rider at the approach can catch one train, and which way round. */
export interface CrossingCutoff {
  /** The latest clock at the approach that still catches it, either way round. */
  cutoffS: number
  /** The latest clock that catches it over the crossing; past this only the concourse does. */
  crossingCutoffS: number
}

/*
 * The cutoff for one train leaving the far platform at `departureS`.
 *
 * Over the crossing, the rider has to be across before the block that ends with
 * their own train begins: once their train's closure starts, the crossing stays
 * shut until it has gone, and any closure that runs straight into it shuts them
 * out earlier still. They also need the walk across to fit before departure.
 *
 * Round by the concourse, nothing shuts; it just takes longer.
 */
export function cutoffFor(
  crossing: LevelCrossing,
  blocks: Blocks,
  arrivalS: number,
  departureS: number,
  walkSecondsAt: (distanceM: number) => number
): CrossingCutoff {
  const ownClosureS = arrivalS - crossing.leadS
  const block = blockAt(blocks, ownClosureS)
  const shutFromS = block ? block[0] : ownClosureS
  const crossingCutoffS = Math.min(shutFromS - 1, departureS - walkSecondsAt(crossing.crossWalkM))
  const concourseCutoffS = departureS - walkSecondsAt(crossing.concourseDetourM)
  return { cutoffS: Math.max(crossingCutoffS, concourseCutoffS), crossingCutoffS }
}

/** Where a train on `pattern` stops at the crossing station, for its own closure. */
export const arrivalAt = (crossing: LevelCrossing, trip: Trip, boardIndex: number): number =>
  trip.arrivalsS?.[boardIndex] ?? trip.departuresS[boardIndex]! - crossing.dwellS

/*
 * Trains on `pattern` a rider at the approach at `clockS` can catch, soonest
 * first, with their cutoffs. `tripsFrom` bounds the scan from below: nothing
 * leaving before the rider is even at the approach can be caught.
 */
export function * catchableFrom(
  pattern: IndexedPattern,
  boardIndex: number,
  clockS: number,
  dayMask: number,
  cutoffOf: (trip: Trip) => CrossingCutoff
): Generator<{ trip: Trip, cutoff: CrossingCutoff }> {
  for (const trip of tripsFrom(pattern, boardIndex, clockS, dayMask)) {
    const cutoff = cutoffOf(trip)
    if (clockS <= cutoff.cutoffS) yield { trip, cutoff }
  }
}
