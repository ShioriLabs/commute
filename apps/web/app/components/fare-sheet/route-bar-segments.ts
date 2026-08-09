import type { FareResultLeg, FareResultRideLeg } from '@commute/schemas'
import { LINE_COLOR_FALLBACK } from '../transit-geometry'

/*
 * The route bar's geometry, worked out as data.
 *
 * Lives in a `.ts` rather than beside the renderer for the same reason
 * journeys.ts does: the vitest config collects `.test.ts` only, so anything
 * inside a `.tsx` is uncoverable. The fit arithmetic below is exactly the part
 * worth pinning down, so it belongs on this side of the line.
 */

/** One line as the bar needs it: what to draw, and what to call it out loud. */
export interface RouteBarLine {
  code: string
  name: string
  color: string
}

/** Resolves a line key to its display identity. Injected so tests need no React. */
export type LineResolver = (leg: FareResultRideLeg) => RouteBarLine[]

export interface RouteBarRide {
  kind: 'RIDE'
  /** Drives flexGrow, so segments stay proportional to ground covered. */
  distanceM: number
  /** Share of the bar's ride width, 0..1. What the fit test is measured against. */
  share: number
  /** One colour per service line; more than one means interlined track. */
  colors: string[]
  code: string
  name: string
  /** Drives the roundel's style: TJ corridors are filled, rail is ringed. */
  operator: string
}

/**
 * A transfer, drawn as a leg in its own right.
 *
 * Not a gap: a walk is something the rider does, and 400m of it between two
 * trains is a real part of the journey — often the part that decides between
 * two options. Giving it the same grammar as a ride, a badge at its head and
 * its own stretch of track, is what lets the bar be read straight through.
 *
 * `distanceM` is null when the response could not measure the walk (11 pairs
 * are still unmeasured) or when the change happens where the rider already
 * stands. The badge then says a change happens without claiming a distance.
 */
export interface RouteBarWalk {
  kind: 'WALK'
  distanceM: number | null
}

export type RouteBarSegment = RouteBarRide | RouteBarWalk

/**
 * Build the bar's segments from a journey's legs.
 *
 * Ride legs are sized against each other by distance. Walks are not: a 400m
 * transfer beside a 14km ride is under 3% of the journey, so drawn to scale it
 * could never hold the figure that makes it worth drawing. Walks take the width
 * their own label needs, and the rides divide what is left — the bar compares
 * rides honestly and reports walks, rather than pretending one scale fits both.
 */
export function routeBarSegments(legs: readonly FareResultLeg[], resolve: LineResolver): RouteBarSegment[] {
  const rides = legs.filter((leg): leg is FareResultRideLeg => leg.type === 'RIDE')
  const total = rides.reduce((sum, leg) => sum + Math.max(0, leg.distanceM), 0)

  /*
   * Only the legs between the first and last ride.
   *
   * A journey often opens or closes with a walk — Sudirman to Dukuh Atas before
   * boarding anything. A walk segment there dangles off the end with no ride to
   * connect to, reading as an orphan rather than a step between two services.
   * It is still counted in the meta row and drawn in full by the timeline; this
   * diagram is about the shape of the ride, and that starts when the rider
   * boards.
   */
  const first = legs.findIndex(leg => leg.type === 'RIDE')
  if (first < 0) return []
  let last = legs.length - 1
  while (last > first && legs[last]!.type !== 'RIDE') last--

  return legs.slice(first, last + 1).map((leg): RouteBarSegment => {
    /*
     * Zero means the response could not measure the walk, not that there is
     * none — 11 pairs are still unmeasured — so it degrades to a bare badge
     * rather than claiming "0 m".
     */
    if (leg.type !== 'RIDE') return { kind: 'WALK', distanceM: leg.distanceM > 0 ? leg.distanceM : null }

    const lines = resolve(leg)
    const distanceM = Math.max(0, leg.distanceM)

    return {
      kind: 'RIDE',
      distanceM,
      /*
       * Guarded against a journey whose ride legs all report zero distance.
       * Rare, but a NaN share would propagate into the fit test and every
       * segment would silently fall to its barest rendering.
       */
      share: total > 0 ? distanceM / total : 0,
      colors: lines.length > 0 ? lines.map(line => line.color) : [LINE_COLOR_FALLBACK],
      code: lines[0]?.code ?? '',
      name: lines[0]?.name ?? '',
      operator: leg.operator
    }
  })
}

/*
 * Do not add a fit test here. Sizing the roundel to its segment hides it on
 * exactly the short unfamiliar legs a rider cannot guess. The roundel marks a
 * boarding point, and a point has no width, so it overhangs a leg too short to
 * contain it. See route-bar.tsx.
 */
