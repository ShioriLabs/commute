/*
 * Trips: when each vehicle runs, as opposed to how often one comes.
 *
 * The timetable layer. Where `headwaysS` answers "you wait about four minutes
 * for a Koridor 1" and `serviceHours` answers "there is no point waiting at all
 * at 03:00", this answers "the next one leaves at 07:14" — the question neither
 * of the other two can reach.
 *
 * NOTHING IN THE SEARCH READS THIS YET, and that is deliberate. `plan` stays
 * headway-based until this layer is proven against the real network; see
 * docs/go-mode.md. What lives here is the input shape and the index built over
 * it, so the data can be loaded, tested and measured before the hot path is
 * touched.
 *
 * Same boundary as the rest of the package: times are seconds since local
 * midnight, ids are opaque strings, and nothing here knows what a timezone, an
 * operator or a day of the week is. apps/api resolves those and passes numbers.
 */

import { DAY_S } from './service-hours'

/**
 * One vehicle's run over a pattern's stops.
 *
 * `departuresS[i]` is the departure from `TripPattern.stationIds[i]`, so the two
 * arrays are index-aligned and must be the same length.
 *
 * Times MAY EXCEED `DAY_S`. A trip leaving at 23:48 and arriving at 00:23 is
 * stored as 85680 then 87780, never as 85680 then 1380, so that the sequence
 * stays monotonic and "is this departure after that one" is a plain numeric
 * comparison. Take a modulus only when displaying a clock time.
 */
export interface Trip {
  /** Opaque identifier, for tracing back to the feed. Never parsed here. */
  id: string
  /**
   * Days this trip runs, as a bitmask the caller defines.
   *
   * The engine never interprets the bits — it only tests them against a mask
   * the caller passes at query time, so which bit means Saturday stays
   * apps/api's business, exactly as with `ServiceWindow` and timezones.
   */
  dayMask: number
  departuresS: number[]
  /**
   * Arrival per stop, or absent where the feed records no real one.
   *
   * Absent means UNKNOWN, never "same as the departure". KCI stores the
   * terminus arrival on every row of a trip, so it says nothing about the stop
   * it sits on and is dropped rather than misread as a per-stop time; a
   * consumer that wants a dwell must check for this array's presence rather
   * than subtracting and getting a confident zero.
   */
  arrivalsS?: number[]
}

/**
 * A stop sequence several trips share — RAPTOR's "route".
 *
 * Not the same thing as a line. Line M runs six of these once short-turns are
 * counted, and grouping trips under the sequence they actually serve is what
 * lets a scan look at a handful of patterns instead of every trip.
 */
export interface TripPattern {
  lineCode: string
  stationIds: string[]
  trips: Trip[]
}

/*
 * A pattern's trips, kept sorted by departure from the pattern's first stop.
 *
 * Sorted once at load rather than per query: "the next trip after t" is the only
 * question this structure exists to answer, and on a sorted list it is a binary
 * search instead of a scan of every trip on the line.
 *
 * Trips on one pattern do not overtake each other in practice, so ordering by
 * the first stop orders them at every stop. That assumption is worth naming
 * because it is what makes the binary search valid at stops other than the
 * first; a feed with overtaking would need a per-stop index instead.
 */
export interface IndexedPattern extends TripPattern {
  /** Position of each station in `stationIds`, for O(1) "does this pattern serve X". */
  readonly stopIndex: ReadonlyMap<string, number>
}

/**
 * Patterns indexed for lookup by the stop a rider is standing at.
 *
 * Built once at load, beside the adjacency map, and deliberately not exposed
 * outside the package — see README. A caller needs answers about departures,
 * not the structure that produces them.
 */
export interface TripIndex {
  /** Every pattern, in load order. */
  readonly patterns: readonly IndexedPattern[]
  /** Patterns calling at a stop. The entry point for a route scan. */
  readonly byStop: ReadonlyMap<string, readonly IndexedPattern[]>
  /** Patterns run by a line, for filtering a scan to lines a rider may board. */
  readonly byLine: ReadonlyMap<string, readonly IndexedPattern[]>
  readonly tripCount: number
}

/**
 * Build the lookup index over a set of patterns.
 *
 * Invalid patterns are dropped rather than throwing: this input is generated,
 * and a single malformed row should not take the whole graph down at isolate
 * start. What is dropped is a pattern that cannot be scanned at all — fewer
 * than two stops, or a trip whose times do not line up with the stops.
 */
export function buildTripIndex(patterns: readonly TripPattern[]): TripIndex {
  const indexed: IndexedPattern[] = []
  let tripCount = 0

  for (const pattern of patterns) {
    if (pattern.stationIds.length < 2) continue

    /*
     * A trip must have exactly one departure per stop, and its arrivals — when
     * present — must line up too. A mismatch means the pattern and the trip
     * disagree about which stop a time belongs to, and there is no safe way to
     * guess which is right.
     */
    const trips = pattern.trips.filter(trip =>
      trip.departuresS.length === pattern.stationIds.length
      && (trip.arrivalsS === undefined || trip.arrivalsS.length === pattern.stationIds.length))
    if (trips.length === 0) continue

    /*
     * A station can appear twice on one pattern only if a vehicle doubles back,
     * which no pattern here does. First occurrence wins so the map stays total
     * rather than silently preferring the later one.
     */
    const stopIndex = new Map<string, number>()
    pattern.stationIds.forEach((id, i) => {
      if (!stopIndex.has(id)) stopIndex.set(id, i)
    })

    indexed.push({
      lineCode: pattern.lineCode,
      stationIds: pattern.stationIds,
      trips: [...trips].sort((a, b) => a.departuresS[0]! - b.departuresS[0]!),
      stopIndex
    })
    tripCount += trips.length
  }

  const byStop = new Map<string, IndexedPattern[]>()
  const byLine = new Map<string, IndexedPattern[]>()
  for (const pattern of indexed) {
    for (const stationId of pattern.stopIndex.keys()) {
      const bucket = byStop.get(stationId)
      if (bucket) bucket.push(pattern)
      else byStop.set(stationId, [pattern])
    }
    const line = byLine.get(pattern.lineCode)
    if (line) line.push(pattern)
    else byLine.set(pattern.lineCode, [pattern])
  }

  return { patterns: indexed, byStop, byLine, tripCount }
}

/**
 * The first trip on `pattern` a rider at `stopIndex` can board at or after
 * `afterS`, or null when the pattern is done for the day.
 *
 * `dayMask` is tested by intersection, so a caller asking for Saturday gets
 * trips that run on Saturday among other days. A zero mask matches nothing,
 * which is the honest answer to "what runs on no day".
 *
 * Binary search over the first-stop order (see IndexedPattern), then a short
 * forward walk: the search finds where the boarding stop's times would start,
 * and the walk skips trips filtered out by the day mask.
 */
export function nextTrip(
  pattern: IndexedPattern,
  stopIndex: number,
  afterS: number,
  dayMask: number
): Trip | null {
  const { trips } = pattern

  /*
   * Bound the search by the FIRST stop's time even though the answer is about
   * `stopIndex`, because that is the order the array is in. Every trip departs
   * its first stop before it departs a later one, so a trip whose first-stop
   * time is already past `afterS` cannot have an earlier time at `stopIndex`
   * either — but the converse does not hold, so this only narrows the range and
   * the walk below still checks the real time.
   */
  let low = 0
  let high = trips.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (trips[mid]!.departuresS[0]! < afterS - DAY_S) low = mid + 1
    else high = mid
  }

  for (let i = low; i < trips.length; i++) {
    const trip = trips[i]!
    if ((trip.dayMask & dayMask) === 0) continue
    if (trip.departuresS[stopIndex]! >= afterS) return trip
  }
  return null
}
