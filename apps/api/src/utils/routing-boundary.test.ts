import type { Edge } from 'db/schemas/edges'
import type { Transfer } from 'db/schemas/transfers'
import { loadGraph } from '@commute/tsundere'
import { describe, expect, it } from 'vitest'
import { summarizeFares } from 'utils/fare-summary'

/*
 * The seam between apps/api and @commute/tsundere.
 *
 * The router's own behaviour is covered in libs/tsundere; this asserts the two
 * things that only break at the boundary and that no test on either side of it
 * would catch:
 *
 *   1. A real Kysely row still satisfies the package's structural inputs. The
 *      router used to take `Pick<Edge, …>` directly; it now declares its own
 *      EdgeInput/TransferInput, so the DB row is assignable only by structural
 *      luck. `tsc` proves this at the one production call site in routes/fares.ts,
 *      but that file is otherwise untested — a fixture typed as the DB row keeps
 *      the guarantee visible in the test suite.
 *   2. RouteLeg still flows into the fare pipeline. summarizeFares reads `noTap`
 *      off a TransferLeg, which is the one field the router carries purely as a
 *      passthrough for fares.
 */

// Typed as the FULL Kysely rows, not the router's inputs — that is the point.
const edges: Edge[] = [
  {
    id: 'C:KCI-A->KCI-B',
    lineCode: 'C',
    fromStationId: 'KCI-A',
    toStationId: 'KCI-B',
    distance: 2000,
    durationSeconds: 240,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: 'C:KCI-B->KCI-A',
    lineCode: 'C',
    fromStationId: 'KCI-B',
    toStationId: 'KCI-A',
    distance: 2000,
    durationSeconds: 240,
    createdAt: new Date(),
    updatedAt: new Date()
  }
]

const transfers: Transfer[] = [
  {
    id: 'KCI-B->MRTJ-C',
    dataType: 'INTERNAL',
    fromStationId: 'KCI-B',
    toStationId: 'MRTJ-C',
    toStationData: null,
    distance: 250,
    notes: null,
    // D1 stores this as an integer, which is exactly the coercion under test.
    noTap: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  }
]

describe('apps/api ↔ @commute/tsundere boundary', () => {
  it('accepts real DB rows as graph inputs without a cast', () => {
    // If EdgeInput/TransferInput ever stop being structurally satisfied by the
    // Kysely rows, this stops compiling — which is the failure this guards.
    const tsun = loadGraph({ edges, transfers })
    expect(tsun.stopCount).toBe(3)
  })

  it('routes across a transfer and preserves the D1 noTap integer as a boolean', () => {
    const legs = loadGraph({ edges, transfers }).findRoute('KCI-A', 'MRTJ-C')

    expect(legs).not.toBeNull()
    const transfer = legs!.find(leg => leg.type === 'TRANSFER')
    expect(transfer).toBeDefined()
    expect(transfer!.type === 'TRANSFER' && transfer!.noTap).toBe(true)
  })

  it('hands legs to the fare pipeline unchanged', () => {
    const legs = loadGraph({ edges, transfers }).findRoute('KCI-A', 'MRTJ-C')!
    const summary = summarizeFares(legs, {
      paymentMethod: 'STORED_VALUE',
      departureAt: new Date('2026-08-03T12:00:00+07:00')
    })

    // noTap keeps the ride either side of the walk in one fare segment rather
    // than splitting it at a gate that is not there.
    expect(summary.transferCount).toBe(1)
    expect(summary.totalDistanceM).toBe(2250)
  })
})
