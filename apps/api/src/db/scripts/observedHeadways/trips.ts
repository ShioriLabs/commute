import type { Passing } from './arrivals'
import type { Dir } from './snapshots'

/*
 * One bus's passings cut into trips: runs along one line and direction with
 * the stop index only going up. Run times and first/last buses are read off
 * these (docs/tj-observed-timings.md).
 *
 * A trip may have holes: stops whose passing was never seen because the relay
 * went stale or two observations were too far apart. Its end-to-end time is
 * still real (both ends were seen), so holes don't split it. Only adjacent,
 * directly observed passings make a hop time; see `hops`.
 */

/** Consecutive passings further apart than this are two trips (a layover, a bus parked mid-route). */
export const TRIP_BREAK_MS = 30 * 60_000

export interface Trip {
  route: string
  dir: Dir
  passings: Passing[]
}

export function splitTrips(passings: readonly Passing[], breakMs = TRIP_BREAK_MS): Trip[] {
  const trips: Trip[] = []
  let current: Trip | undefined
  for (const p of passings) {
    const last = current?.passings.at(-1)
    const continues = current && last
      && current.route === p.route
      && current.dir === p.dir
      && p.index > last.index
      && p.t - last.t <= breakMs
    if (continues) {
      current!.passings.push(p)
    } else {
      current = { route: p.route, dir: p.dir, passings: [p] }
      trips.push(current)
    }
  }
  return trips
}

export interface Hop {
  route: string
  dir: Dir
  /** Index of the stop the hop leaves; it ends at `from + 1`. */
  from: number
  /** Passing time at `from`, ms. */
  t: number
  durationMs: number
}

/**
 * Passing-to-passing times between adjacent stops. A passing is the moment
 * `next_stops` moves on, so this is departure to departure: the ride plus the
 * dwell at the next stop. Both ends must come from a single-stop step (span 1),
 * otherwise the time was spread evenly by interpolation rather than seen.
 */
export function hops(trip: Trip, unhealthy?: { overlaps: (from: number, to: number) => boolean }): Hop[] {
  const out: Hop[] = []
  const list = trip.passings
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1]!, b = list[i]!
    if (b.index !== a.index + 1 || a.span !== 1 || b.span !== 1) continue
    if (unhealthy?.overlaps(a.t, b.t)) continue
    out.push({ route: trip.route, dir: trip.dir, from: a.index, t: a.t, durationMs: b.t - a.t })
  }
  return out
}
