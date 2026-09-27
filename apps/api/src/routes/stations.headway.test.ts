import { describe, expect, it, vi } from 'vitest'

import { DAY_HEADWAYS_S, DIRECTIONAL_HEADWAYS_S, HEADWAYS_S, LINE_TERMINI, STOP_HEADWAYS_S } from 'db/data/headways'

/*
 * The handler reaches D1 through the `db(d1)` Kysely factory, so the query
 * builder is mocked the same way db/repositories/stations.test.ts does it:
 * a chainable no-op whose terminal methods return a queued fixture row. That
 * exercises the real handler and the real row mapping without a live database.
 */
const terminalResults: unknown[] = []

function makeBuilder(): unknown {
  const proxy: unknown = new Proxy({} as Record<string, unknown>, {
    get(_target, prop: string) {
      if (prop === 'then') return undefined
      if (prop === 'execute') return () => Promise.resolve(terminalResults.length ? terminalResults.shift() : [])
      if (prop === 'executeTakeFirst' || prop === 'executeTakeFirstOrThrow') {
        return () => Promise.resolve(terminalResults.length ? terminalResults.shift() : undefined)
      }
      if (prop === 'compile') return () => ({ sql: 'SELECT 1', parameters: [] })
      return () => proxy
    }
  })
  return proxy
}

vi.mock('db', () => ({ db: () => makeBuilder() }))

const app = (await import('app')).default
type Bindings = (typeof import('app'))['Bindings']

/*
 * `/stations/:operator/:code/headway`.
 *
 * The endpoint answers "how often does something come here", which is the only
 * time question this network can answer for TransJakarta at all — it publishes
 * no timetable — and the one rail's departure boards answer badly at a terminus.
 *
 * What is worth pinning is not the arithmetic (that lives in the generator) but
 * the contract the UI reads: which of the station's lines appear, whether the
 * number came from this stop or was borrowed from the line, and that a
 * weekend-only line reports no weekday figure rather than a plausible one.
 *
 * D1 is stubbed. These tests are about the handler's shape, not the database.
 */

const ORIGIN = 'https://api.commute.shiorilabs.id'

/*
 * `app.fetch` without a third argument leaves `c.executionCtx` throwing, and the
 * handler uses `waitUntil` to populate KV. Pass a stub so the cache write is
 * exercised rather than crashing the request.
 */
const ctx = () => ({ waitUntil: () => undefined, passThroughOnException: () => undefined })

const request = (path: string, env: Partial<Bindings>) =>
  app.fetch(new Request(`${ORIGIN}${path}`), env as Bindings, ctx() as unknown as ExecutionContext)

/*
 * Minimal D1 stand-in: one station row, shaped as `stationsQuery` selects it.
 * `lines` arrives as the comma-joined `group_concat` the real subquery produces.
 */
const envFor = (row: Record<string, unknown> | undefined, termini?: unknown[]) => {
  terminalResults.length = 0
  terminalResults.push(row)
  // A split line makes a second query, for the terminus display names.
  if (termini) terminalResults.push(termini)
  return {
    API_VERSION: 'v1',
    KV: { get: async () => null, put: async () => undefined },
    DB: {}
  } as unknown as Partial<Bindings>
}

const station = (overrides: Record<string, unknown>) => ({
  id: 'TJ-H00014P',
  name: 'Blok M',
  formattedName: null,
  code: 'H00014P',
  regionCode: 'CGK',
  operator: 'TJ',
  latitude: -6.24,
  longitude: 106.8,
  score: 0,
  amenities: null,
  searchable: 1,
  ...overrides
})

interface HeadwayBody {
  data: {
    line: string
    headwayS: number | null
    source: 'STOP' | 'LINE'
    weekendOnly?: true
    boundFor?: string
  }[]
}

describe('/stations/:operator/:code/headway', () => {
  it('404s on an unknown operator', async () => {
    const res = await request('/stations/ZZZ/H00014P/headway', envFor(undefined))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: 'UNKNOWN_OPERATOR' } })
  })

  it('404s on an unknown station', async () => {
    const res = await request('/stations/TJ/NOPE/headway', envFor(undefined))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: 'UNKNOWN_STATION' } })
  })

  /*
   * Blok M is served by Koridor 1's trunk and most of its short-turn variants,
   * so it has a measured value of its own rather than the corridor average.
   */
  it('reports a per-stop value as source STOP', async () => {
    const res = await request('/stations/TJ/H00014P/headway', envFor(station({ lines: '1' })))
    expect(res.status).toBe(200)
    const body = await res.json() as HeadwayBody
    expect(body.data).toEqual([
      { line: 'TJ:1', headwayS: STOP_HEADWAYS_S['1@TJ-H00014P'], source: 'STOP' }
    ])
  })

  /*
   * The distinction `source` exists for: a borrowed line-level number must never
   * be presentable as something measured at this stop. Simpang Pramuka is the
   * live case — line 4 serves it, but via roadside stops that do not collapse
   * onto the halte, so no per-stop value can be derived.
   */
  it('falls back to the line value and says so', async () => {
    const res = await request(
      // Pinned to a weekday: the answer is day-dependent, and an unpinned test
      // would assert weekday figures only from Monday to Friday.
      '/stations/TJ/H00181P/headway?day=WD',
      envFor(station({ id: 'TJ-H00181P', code: 'H00181P', name: 'Simpang Pramuka', lines: '4' }))
    )
    const body = await res.json() as HeadwayBody
    expect(STOP_HEADWAYS_S['4@TJ-H00181P']).toBeUndefined()
    expect(body.data).toEqual([{ line: 'TJ:4', headwayS: HEADWAYS_S['4'], source: 'LINE' }])
  })

  /*
   * A day override must REFINE a measurement, never invent one.
   *
   * Corridor 4 reaches Simpang Pramuka only on Sundays, so `SUN:4@TJ-H00181P`
   * exists while the weekday per-stop key does not. Reading the override
   * unguarded would report a per-stop figure for a stop that was never measured
   * as one, which is exactly the borrowed-number confusion `source` exists to
   * prevent.
   */
  it('does not let a Sunday override invent a per-stop measurement', async () => {
    expect(STOP_HEADWAYS_S['4@TJ-H00181P']).toBeUndefined()
    expect(DAY_HEADWAYS_S['SUN:4@TJ-H00181P']).toBeDefined()

    const res = await request(
      '/stations/TJ/H00181P/headway?day=SUN',
      envFor(station({ id: 'TJ-H00181P', code: 'H00181P', name: 'Simpang Pramuka', lines: '4' }))
    )
    const body = await res.json() as HeadwayBody
    const [row] = body.data
    expect(row!.source).toBe('LINE')
    expect(row!.headwayS).toBe(DAY_HEADWAYS_S['SUN:4'] ?? HEADWAYS_S['4'])
  })

  /*
   * A weekend-only corridor has no weekday headway at all. Borrowing one would
   * assert service that does not run, so on a weekday it reports null and says
   * which days it does run.
   */
  it('reports a weekend-only line with no weekday figure', async () => {
    const res = await request(
      '/stations/TJ/H00190P/headway?day=WD',
      envFor(station({ id: 'TJ-H00190P', code: 'H00190P', lines: '13E' }))
    )
    const body = await res.json() as HeadwayBody
    expect(body.data).toEqual([
      { line: 'TJ:13E', headwayS: null, source: 'LINE', days: ['SAT', 'SUN'], weekendOnly: true }
    ])
  })

  /*
   * ...and on the days it DOES run it carries a real number. Before day
   * awareness this corridor was `null` every day of the week, so the halte page
   * could only say "akhir pekan saja" with no frequency at all.
   */
  it('gives a weekend-only line a real figure at the weekend', async () => {
    const res = await request(
      '/stations/TJ/H00190P/headway?day=SAT',
      envFor(station({ id: 'TJ-H00190P', code: 'H00190P', lines: '13E' }))
    )
    const body = await res.json() as HeadwayBody
    const [row] = body.data
    expect(row!.headwayS).toBe(DAY_HEADWAYS_S['SAT:13E'])
    expect(row!.headwayS).not.toBeNull()
    expect(row!.days).toEqual(['SAT', 'SUN'])
    expect(row!.weekendOnly).toBe(true)
  })

  /*
   * A line that runs every day carries no `days` at all — absent means all
   * three, which keeps the common case off the wire.
   */
  it('omits days for a line that runs all week', async () => {
    const res = await request(
      '/stations/TJ/H00014P/headway?day=WD',
      envFor(station({ id: 'TJ-H00014P', code: 'H00014P', lines: '1' }))
    )
    const body = await res.json() as HeadwayBody
    expect(body.data[0]!.days).toBeUndefined()
    expect(body.data[0]!.weekendOnly).toBeUndefined()
  })

  /*
   * Rail is not an afterthought: per-stop medians are exactly where a line-level
   * number is worst, since departures thin out toward a terminus.
   */
  it('serves rail operators too', async () => {
    const res = await request(
      '/stations/MRTJ/SSM/headway',
      envFor(station({ id: 'MRTJ-SSM', code: 'SSM', name: 'Stasiun ASEAN', operator: 'MRTJ', lines: 'M' }))
    )
    const body = await res.json() as HeadwayBody
    expect(body.data).toEqual([
      { line: 'MRTJ:M', headwayS: STOP_HEADWAYS_S['M@MRTJ-SSM'], source: 'STOP' }
    ])
    // The point of per-stop rail data: the terminus waits far longer.
    expect(STOP_HEADWAYS_S['M@MRTJ-SSM']).toBeLessThan(STOP_HEADWAYS_S['M@MRTJ-LBB']!)
  })

  /*
   * A station whose lines we derive nothing for (a feeder with no topology)
   * yields an empty list, not a guess. The frontend reads that as "no data" and
   * keeps the existing empty state.
   */
  it('returns an empty list rather than inventing a figure', async () => {
    const res = await request(
      '/stations/TJ/B08476P/headway',
      envFor(station({ id: 'TJ-B08476P', code: 'B08476P', lines: 'JAK.99' }))
    )
    expect(res.status).toBe(200)
    expect((await res.json() as HeadwayBody).data).toEqual([])
  })

  /*
   * A rider at a halte has not chosen a direction yet, so both are shown. The
   * generated table only carries pairs whose directions genuinely differ, which
   * is why its presence alone decides whether the row splits.
   */
  it('emits two rows, labelled by terminus, where the directions differ', async () => {
    const forward = DIRECTIONAL_HEADWAYS_S['10H@TJ-H00067P@F']!
    const reverse = DIRECTIONAL_HEADWAYS_S['10H@TJ-H00067P@R']!
    expect(forward).not.toBe(reverse)
    const termini = LINE_TERMINI['10H']!

    const res = await request(
      '/stations/TJ/H00067P/headway',
      envFor(
        station({ id: 'TJ-H00067P', code: 'H00067P', name: 'Senayan Bank Jakarta', lines: '10H' }),
        [
          { id: termini.F, name: 'Ujung Depan', formattedName: null, code: 'X', regionCode: 'CGK', operator: 'TJ', latitude: null, longitude: null, score: 0, amenities: null, searchable: 1, lines: '10H' },
          { id: termini.R, name: 'Ujung Belakang', formattedName: null, code: 'Y', regionCode: 'CGK', operator: 'TJ', latitude: null, longitude: null, score: 0, amenities: null, searchable: 1, lines: '10H' }
        ]
      )
    )
    const body = await res.json() as HeadwayBody
    expect(body.data).toHaveLength(2)
    expect(body.data.map(r => r.headwayS)).toEqual([forward, reverse])
    // Both halves describe the same line; only the direction differs.
    expect(new Set(body.data.map(r => r.line))).toEqual(new Set(['TJ:10H']))
    expect(body.data[0]!.boundFor).toBe('Ujung Depan')
    expect(body.data[1]!.boundFor).toBe('Ujung Belakang')
  })

  /*
   * The far more common case, and the one that keeps halte pages from doubling in
   * length: where both directions agree the response is exactly what it was before
   * directions existed, with no boundFor at all.
   */
  it('leaves a non-split line exactly as it was, with no boundFor', async () => {
    expect(DIRECTIONAL_HEADWAYS_S['1@TJ-H00014P@F']).toBeUndefined()
    const res = await request('/stations/TJ/H00014P/headway', envFor(station({ lines: '1' })))
    const body = await res.json() as HeadwayBody
    expect(body.data).toEqual([
      { line: 'TJ:1', headwayS: STOP_HEADWAYS_S['1@TJ-H00014P'], source: 'STOP' }
    ])
    expect(body.data[0]).not.toHaveProperty('boundFor')
  })

  /*
   * A halte the corridor only passes one way. The number was already
   * direction-specific; without a label a rider sees a one-way frequency with no
   * hint that nothing runs the other way. One row, labelled — not two.
   */
  it('labels a single-direction stop without adding a second row', async () => {
    const key = Object.keys(DIRECTIONAL_HEADWAYS_S)
      .find(k => k.startsWith('1@') && DIRECTIONAL_HEADWAYS_S[
        k.endsWith('@F') ? `${k.slice(0, -1)}R` : `${k.slice(0, -1)}F`
      ] === undefined)!
    const [lineCode, stationId] = [key.slice(0, key.indexOf('@')), key.slice(key.indexOf('@') + 1, key.lastIndexOf('@'))]
    const dir = key.slice(-1) as 'F' | 'R'
    const termini = LINE_TERMINI[lineCode]!

    const res = await request(
      `/stations/TJ/${stationId.slice(3)}/headway`,
      envFor(
        station({ id: stationId, code: stationId.slice(3), lines: lineCode }),
        [{ id: termini[dir], name: 'Ujung Satu-Arah', formattedName: null, code: 'Z', regionCode: 'CGK', operator: 'TJ', latitude: null, longitude: null, score: 0, amenities: null, searchable: 1, lines: lineCode }]
      )
    )
    const body = await res.json() as HeadwayBody
    expect(body.data).toHaveLength(1)
    expect(body.data[0]!.headwayS).toBe(DIRECTIONAL_HEADWAYS_S[key])
    expect(body.data[0]!.boundFor).toBe('Ujung Satu-Arah')
  })
})
