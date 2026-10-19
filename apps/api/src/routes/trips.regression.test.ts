import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { EdgeInput, RouteLeg, TransferInput } from '@commute/tsundere'
import { estimateInputs, routerFromInputs } from 'routes/fares'
import { searchTrips } from 'routes/internal'
import { TJ_RUNTIMES } from 'db/data/runtimes.planner'
import { estimateTjLeg } from 'utils/observedRuntimes'
import type { PlaceIndex } from 'utils/places'
import { DEFAULT_AT, ROUTE_CASES, type RouteShape } from './trips.regression.cases'

/*
 * Route regression suite: real journeys, the real network, the question the
 * app asks.
 *
 * Every router change so far has been tuned against the one journey that
 * prompted it, and the next change then broke a journey nobody re-checked
 * (Kuningan Madya, twice). This runs the cases in trips.regression.cases.ts on
 * every `pnpm test`, so a tuning change has to keep all of them right at once.
 *
 * The network is a committed snapshot of prod's graph rows
 * (db/data/network.snapshot.json, from `generate:route-snapshot`), because CI
 * has no D1. The search goes through `searchTrips`, the same function
 * /_internal/trips calls, so endpoints, exclusions, headways and fares are the
 * app's own. Not covered: the arrival-time re-sort applied after the search
 * (utils/journey-times.ts), which needs a clock.
 */

interface NetworkSnapshot {
  generatedAt: string
  edges: EdgeInput[]
  transfers: TransferInput[]
  /** Groups of stations that are one place to a rider (utils/places.ts). */
  places: string[][]
}

const snapshot = JSON.parse(
  readFileSync(`${__dirname}/../db/data/network.snapshot.json`, 'utf-8')
) as NetworkSnapshot

const router = routerFromInputs(snapshot)

const places: PlaceIndex = new Map(
  snapshot.places.flatMap((group) => {
    const members = new Set(group)
    return group.map(id => [id, members] as const)
  })
)

/** A journey as the lines it rides and the walks it takes, in the shapes RouteShape uses. */
interface Summary {
  rides: string[]
  walks: string[][]
  boardings: number
}

function summarise(legs: readonly RouteLeg[], boardings: number): Summary {
  const rides: string[] = []
  const walks: string[][] = []
  let walking: string[] | null = null
  for (const leg of legs) {
    if (leg.type === 'TRANSFER') {
      // Consecutive walk hops are one walk to a rider, so they read as one
      // run of stations: [from, via, to].
      if (walking) walking.push(leg.toStationId)
      else walking = [leg.fromStationId, leg.toStationId]
      continue
    }
    if (walking) {
      walks.push(walking)
      walking = null
    }
    if (rides[rides.length - 1] !== leg.lineCode) rides.push(leg.lineCode)
  }
  if (walking) walks.push(walking)
  return { rides, walks, boardings }
}

const sameRun = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])

function matches(summary: Summary, shape: RouteShape): boolean {
  if (shape.rides && !(
    shape.rides.length === summary.rides.length
    && shape.rides.every((alternatives, i) => alternatives.split('|').includes(summary.rides[i]!))
  )) return false
  if (shape.usesLine && !summary.rides.includes(shape.usesLine)) return false
  if (shape.walks && !(
    shape.walks.length === summary.walks.length
    && shape.walks.every((run, i) => sameRun(run, summary.walks[i]!))
  )) return false
  if (shape.hasWalk && !summary.walks.some(run => sameRun(run, shape.hasWalk!))) return false
  if (shape.maxBoardings !== undefined && summary.boardings > shape.maxBoardings) return false
  return true
}

/** One line per journey, so a failure shows what the router did instead. */
const describeSummary = (s: Summary) =>
  `rides ${s.rides.join(' > ') || '-'}; walks ${s.walks.map(run => run.join('~')).join(', ') || '-'}; ${s.boardings} boarding(s)`

describe('route regression', () => {
  it('has a snapshot to run on', () => {
    expect(snapshot.edges.length).toBeGreaterThan(1000)
  })

  for (const routeCase of ROUTE_CASES) {
    it(routeCase.name, () => {
      const { journeys } = searchTrips(router, routeCase.from, routeCase.to, {
        places,
        context: { paymentMethod: 'STORED_VALUE', departureAt: new Date(routeCase.at ?? DEFAULT_AT) },
        modes: routeCase.modes,
        walking: routeCase.walking,
        observed: true
      })
      const summaries = journeys.map(j => summarise(j.legs, j.criteria.boardings))
      const offered = `\n  why: ${routeCase.why}\n  offered:\n${summaries.map((s, i) => `    ${i + 1}. ${describeSummary(s)}`).join('\n')}`

      expect(summaries.length, `no journey found${offered}`).toBeGreaterThan(0)
      const top = summaries[0]!

      if (routeCase.first) {
        expect(matches(top, routeCase.first), `top journey should match ${JSON.stringify(routeCase.first)}${offered}`).toBe(true)
      }
      for (const shape of routeCase.firstNot ?? []) {
        expect(matches(top, shape), `top journey should not match ${JSON.stringify(shape)}${offered}`).toBe(false)
      }
      for (const shape of routeCase.offers ?? []) {
        expect(summaries.some(s => matches(s, shape)), `some journey should match ${JSON.stringify(shape)}${offered}`).toBe(true)
      }
      for (const shape of routeCase.never ?? []) {
        const hit = summaries.findIndex(s => matches(s, shape))
        expect(hit, `journey ${hit + 1} should not match ${JSON.stringify(shape)}${offered}`).toBe(-1)
      }
    })
  }
})

/*
 * The TransJakarta estimates on real graph legs (utils/observedRuntimes.ts).
 * The point is the join: the graph's station ids and leg splits must land on
 * the runtime table's keys, or every estimate silently comes back null.
 */
describe('TransJakarta estimates on real journeys', () => {
  const at = new Date('2026-10-14T12:00:00+07:00')
  const context = { paymentMethod: 'STORED_VALUE' as const, departureAt: at }
  const inputs = estimateInputs(context, true)
  const departureS = 12 * 3600
  const corridor = TJ_RUNTIMES['1@F']!.stops

  it('estimates a corridor 1 run and leaves its legs untimed', () => {
    const { journeys } = searchTrips(router, corridor[1]!, corridor.at(-2)!, { places, context, observed: true })
    const tj = journeys.find(j => j.legs.every(l => l.type !== 'RIDE' || l.operator === 'TJ'))
    expect(tj, 'a TransJakarta-only journey').toBeDefined()
    expect(router.timeJourney(tj!.legs, { departureS, dayMask: 0b100 }).every(t => t === null)).toBe(true)

    const estimate = router.estimateJourney(tj!.legs, {
      departureS,
      dayMask: 0b100,
      estimateUntimed: (leg, s) => estimateTjLeg(leg, s, inputs)
    })
    expect(estimate, 'an estimate').not.toBeNull()
    // Corridor 1 stop 1 to second-to-last runs ~64 min at weekday midday (docs/tj-observed-timings.md).
    const minutes = (estimate!.arrivalS - departureS) / 60
    expect(minutes).toBeGreaterThan(50)
    expect(minutes).toBeLessThan(100)
  })

  it('estimates the Kuningan Madya to Tanjung Duren change', () => {
    const { journeys } = searchTrips(router, 'TJ-H00114P', 'TJ-H00210S', { places, context, observed: true })
    const estimated = journeys.filter(j => router.estimateJourney(j.legs, {
      departureS,
      dayMask: 0b100,
      estimateUntimed: (leg, s) => estimateTjLeg(leg, s, inputs)
    }) !== null)
    expect(estimated.length, 'journeys with an estimate').toBeGreaterThan(0)
  })
})
