import { describe, expect, it, vi } from 'vitest'

import { HEADWAYS_S, STOP_HEADWAYS_S, WEEKEND_ONLY_LINES } from 'db/data/headways'

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
const envFor = (row: Record<string, unknown> | undefined) => {
  terminalResults.length = 0
  terminalResults.push(row)
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
  data: { line: string, headwayS: number | null, source: 'STOP' | 'LINE', weekendOnly?: true }[]
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
      '/stations/TJ/H00181P/headway',
      envFor(station({ id: 'TJ-H00181P', code: 'H00181P', name: 'Simpang Pramuka', lines: '4' }))
    )
    const body = await res.json() as HeadwayBody
    expect(STOP_HEADWAYS_S['4@TJ-H00181P']).toBeUndefined()
    expect(body.data).toEqual([{ line: 'TJ:4', headwayS: HEADWAYS_S['4'], source: 'LINE' }])
  })

  /*
   * A weekend-only corridor has no weekday headway at all. Borrowing one would
   * assert service that does not run, so it reports null and flags itself.
   */
  it('reports a weekend-only line with no figure', async () => {
    const weekendLine = WEEKEND_ONLY_LINES[0]!
    const res = await request(
      '/stations/TJ/H00190P/headway',
      envFor(station({ id: 'TJ-H00190P', code: 'H00190P', lines: weekendLine }))
    )
    const body = await res.json() as HeadwayBody
    expect(body.data).toEqual([
      { line: `TJ:${weekendLine}`, headwayS: null, source: 'LINE', weekendOnly: true }
    ])
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
})
