import { describe, expect, it, vi } from 'vitest'

import { DAY_HEADWAYS_S, DIRECTIONAL_HEADWAYS_S, HEADWAYS_S, LINE_TERMINI, STOP_HEADWAYS_S } from 'db/data/headways'
import { OBSERVED_GTFS_SCALE, OBSERVED_PROFILE_INTERP_S, OBSERVED_PROFILE_S, OBSERVED_STOP_FACTOR } from 'db/data/headways.observed'
import { SERVICE_HOURS } from 'db/data/service-hours'
import { clampHeadway } from 'utils/headwayBounds'

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
    KV: { get: async (key: string) => key === OBSERVED_FLAG ? 'off' : null, put: async () => undefined },
    DB: {}
  } as unknown as Partial<Bindings>
}

/*
 * The handler tests below pin the SCHEDULE contract, so the kill switch is off
 * for them: the response is then exactly what it was before observed values
 * existed. The `observed values` block at the end turns it on.
 */
const OBSERVED_FLAG = 'config:observed-headways'
const envObserved = (row: Record<string, unknown> | undefined, termini?: unknown[]) => {
  const env = envFor(row, termini) as { KV: { get: (key: string) => Promise<unknown> } }
  env.KV.get = async () => null
  return env as unknown as Partial<Bindings>
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
    days?: string[]
    boundFor?: string
    serviceHours?: { start: string, end: string } | { allDay: true }
    basis?: 'OBSERVED' | 'INTERPOLATED' | 'SCALED'
    scheduledS?: number | null
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
      { line: 'TJ:1', headwayS: STOP_HEADWAYS_S['1@TJ-H00014P'], source: 'STOP', serviceHours: { allDay: true } }
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
    expect(body.data).toEqual([{ line: 'TJ:4', headwayS: HEADWAYS_S['4'], source: 'LINE', serviceHours: { allDay: true } }])
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
      { line: 'TJ:1', headwayS: STOP_HEADWAYS_S['1@TJ-H00014P'], source: 'STOP', serviceHours: { allDay: true } }
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

  /*
   * Operating hours ride along on each TJ row. The corridor's span, not this
   * halte's last bus, and only where the source has one: a line with no entry
   * must not be reported as round the clock.
   */
  describe('serviceHours', () => {
    const hoursOf = async (lines: string, day = 'WD') => {
      const res = await request(`/stations/TJ/H00014P/headway?day=${day}`, envFor(station({ lines })))
      return (await res.json() as HeadwayBody).data.map(row => row.serviceHours)
    }

    it('reports a 24-hour corridor as allDay', async () => {
      expect(SERVICE_HOURS['1']?.ALL).toEqual([0, 86399])
      expect(await hoursOf('1')).toEqual([{ allDay: true }])
    })

    it('reports a daytime corridor as a window', async () => {
      expect(SERVICE_HOURS['10H']?.ALL).toEqual([18000, 79200])
      expect(await hoursOf('10H')).toEqual([{ start: '05:00', end: '22:00' }])
    })

    it('reads the day-specific window where a corridor has one', async () => {
      expect(SERVICE_HOURS['13E']?.SAT).toEqual([18000, 79200])
      expect(await hoursOf('13E', 'SAT')).toEqual([{ start: '05:00', end: '22:00' }])
    })

    it('leaves rail rows without hours', async () => {
      const res = await request(
        '/stations/MRTJ/SSM/headway',
        envFor(station({ id: 'MRTJ-SSM', code: 'SSM', name: 'Stasiun ASEAN', operator: 'MRTJ', lines: 'M' }))
      )
      expect((await res.json() as HeadwayBody).data[0]!.serviceHours).toBeUndefined()
    })
  })
})

/*
 * The observed values on top of the schedule ones (utils/observedHeadways.ts).
 *
 * Fixtures are picked from the generated overlay rather than hard-coded, so a
 * refit does not break them: the point is the contract (observed where the model
 * speaks, scaled schedule where it does not, schedule for rail), not a number.
 */
describe('/stations/:operator/:code/headway with observed values', () => {
  const column = 'WD:12'

  /** A line-stop that is not split by direction, has both directions modelled, and a profile at WD:12. */
  const modelled = (() => {
    const byStop = new Map<string, string[]>()
    for (const key of Object.keys(OBSERVED_STOP_FACTOR)) {
      const at = key.lastIndexOf('@')
      byStop.set(key.slice(0, at), [...(byStop.get(key.slice(0, at)) ?? []), key.slice(at + 1)])
    }
    for (const [lineStop, dirs] of byStop) {
      const line = lineStop.slice(0, lineStop.indexOf('@'))
      const split = DIRECTIONAL_HEADWAYS_S[`${lineStop}@F`] !== undefined || DIRECTIONAL_HEADWAYS_S[`${lineStop}@R`] !== undefined
      const profiled = dirs.every(d => OBSERVED_PROFILE_S[`${column}:${line}@${d}`] !== undefined)
      if (!split && dirs.length === 2 && profiled && STOP_HEADWAYS_S[lineStop] !== undefined && LINE_TERMINI[line]) {
        return { lineStop, line, stationId: lineStop.slice(lineStop.indexOf('@') + 1), dirs }
      }
    }
    throw new Error('no suitable modelled stop in the overlay')
  })()

  const fetchRow = async (hour: number, env = envObserved) => {
    const { line, stationId } = modelled
    const res = await request(
      `/stations/TJ/${stationId.slice(3)}/headway?day=WD&hour=${hour}`,
      env(station({ id: stationId, code: stationId.slice(3), lines: line }))
    )
    expect(res.status).toBe(200)
    return (await res.json() as HeadwayBody).data
  }

  it('reports the observed value, with the schedule number beside it', async () => {
    const [row] = await fetchRow(12)
    const expected = clampHeadway(
      modelled.dirs
        .map(d => OBSERVED_PROFILE_S[`${column}:${modelled.line}@${d}`]! / OBSERVED_STOP_FACTOR[`${modelled.lineStop}@${d}`]!)
        .reduce((a, b) => a + b, 0) / modelled.dirs.length
    )
    expect(row).toMatchObject({ basis: 'OBSERVED', headwayS: expected, scheduledS: STOP_HEADWAYS_S[modelled.lineStop], source: 'STOP' })
    // The whole reason for the feature: the observed wait is longer than the schedule's.
    expect(row!.headwayS!).toBeGreaterThan(STOP_HEADWAYS_S[modelled.lineStop]!)
  })

  it('interpolates an hour the model did not measure, from the same line-direction\'s neighbours', async () => {
    const hour = Array.from({ length: 24 }, (_, h) => h).find(h =>
      OBSERVED_PROFILE_S[`WD:${h}:${modelled.line}@F`] === undefined
      && modelled.dirs.every(d => OBSERVED_PROFILE_INTERP_S[`WD:${h}:${modelled.line}@${d}`] !== undefined))
    if (hour === undefined) return // this fit has no blind hour with both directions interpolated
    const [row] = await fetchRow(hour)
    expect(row).toMatchObject({ basis: 'INTERPOLATED', scheduledS: STOP_HEADWAYS_S[modelled.lineStop] })
  })

  it('scales the schedule value where there is no profile of any kind', async () => {
    const hour = Array.from({ length: 24 }, (_, h) => h).find(h =>
      modelled.dirs.every(d => OBSERVED_PROFILE_S[`WD:${h}:${modelled.line}@${d}`] === undefined
        && OBSERVED_PROFILE_INTERP_S[`WD:${h}:${modelled.line}@${d}`] === undefined)
      && OBSERVED_GTFS_SCALE[`WD:${h}`] !== undefined)
    if (hour === undefined) return
    const [row] = await fetchRow(hour)
    expect(row).toMatchObject({
      basis: 'SCALED',
      scheduledS: STOP_HEADWAYS_S[modelled.lineStop],
      headwayS: clampHeadway(STOP_HEADWAYS_S[modelled.lineStop]! * OBSERVED_GTFS_SCALE[`WD:${hour}`]!)
    })
  })

  it('keeps one KV entry per station and day, holding the schedule numbers', async () => {
    const puts: { key: string, value: string }[] = []
    const record = async (key: string, value: string) => {
      puts.push({ key, value })
    }
    const env = (row: Record<string, unknown> | undefined) => {
      const e = envFor(row) as { KV: Record<string, unknown> }
      e.KV = { get: async () => null, put: record }
      return e as unknown as Partial<Bindings>
    }
    await fetchRow(12, env)
    await fetchRow(17, env)
    expect(new Set(puts.map(p => p.key)).size).toBe(1)
    const stored = JSON.parse(puts[0]!.value) as { row: { headwayS: number } }[]
    expect(stored[0]!.row.headwayS).toBe(STOP_HEADWAYS_S[modelled.lineStop])
  })

  it('leaves rail rows exactly as they were', async () => {
    const res = await request(
      '/stations/MRTJ/SSM/headway?hour=12',
      envObserved(station({ id: 'MRTJ-SSM', code: 'SSM', name: 'Stasiun ASEAN', operator: 'MRTJ', lines: 'M' }))
    )
    const [row] = (await res.json() as HeadwayBody).data
    expect(row).not.toHaveProperty('basis')
    expect(row).not.toHaveProperty('scheduledS')
  })

  it('returns the schedule number untouched when the kill switch is off', async () => {
    const [row] = await fetchRow(12, envFor)
    expect(row).toMatchObject({ headwayS: STOP_HEADWAYS_S[modelled.lineStop] })
    expect(row).not.toHaveProperty('basis')
  })

  it('treats a malformed hour as "now" rather than an error', async () => {
    for (const hour of ['99', '-1', 'abc', '']) {
      const res = await request(
        `/stations/TJ/${modelled.stationId.slice(3)}/headway?day=WD&hour=${hour}`,
        envObserved(station({ id: modelled.stationId, code: modelled.stationId.slice(3), lines: modelled.line }))
      )
      expect(res.status).toBe(200)
    }
  })
})
