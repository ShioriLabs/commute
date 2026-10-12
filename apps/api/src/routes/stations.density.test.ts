import { describe, expect, it, vi } from 'vitest'

/*
 * Same D1 stand-in as stations.headway.test.ts: a chainable no-op query builder
 * whose terminal methods return a queued fixture row.
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
vi.mock('db/data/density', () => ({
  DENSITY_LEVELS: {
    'KCI-MRI': { WD: { min: '-----0012222211223322100', max: '-----1123333322333333211' } }
  }
}))

const app = (await import('app')).default
type Bindings = (typeof import('app'))['Bindings']

/*
 * `/stations/:operator/:code/density`.
 *
 * The arithmetic lives in the generator and is pinned by the calibration test.
 * What matters here is the contract a client reads: 24 hours, each a min~max
 * range on 0-3 or null, and null never standing in for an error or for Lengang.
 */

const ORIGIN = 'https://api.commute.shiorilabs.id'
const ctx = () => ({ waitUntil: () => undefined, passThroughOnException: () => undefined })

const envFor = (row: Record<string, unknown> | undefined) => {
  terminalResults.length = 0
  terminalResults.push(row)
  return {
    API_VERSION: 'v1',
    KV: { get: async () => null, put: async () => undefined },
    DB: {}
  } as unknown as Partial<Bindings>
}

const request = (path: string, row: Record<string, unknown> | undefined) =>
  app.fetch(new Request(`${ORIGIN}${path}`), envFor(row) as Bindings, ctx() as unknown as ExecutionContext)

const MANGGARAI = {
  id: 'KCI-MRI',
  name: 'MANGGARAI',
  formattedName: null,
  code: 'MRI',
  regionCode: 'JAK',
  operator: 'KCI',
  latitude: -6.21,
  longitude: 106.85,
  score: 95,
  amenities: null,
  searchable: 1
}

interface DensityBody {
  data: { day: string, hours: { hour: number, level: { min: number, max: number } | null }[] }
}

describe('/stations/:operator/:code/density', () => {
  it('maps the two digit strings to 24 hourly ranges for the requested day', async () => {
    const res = await request('/stations/KCI/MRI/density?day=WD', MANGGARAI)
    expect(res.status).toBe(200)
    const body = await res.json() as DensityBody
    expect(body.data.day).toBe('WD')
    expect(body.data.hours).toHaveLength(24)
    expect(body.data.hours.map(h => h.hour)).toEqual([...Array(24).keys()])
    expect(body.data.hours[3]).toEqual({ hour: 3, level: null })
    expect(body.data.hours[5]!.level).toEqual({ min: 0, max: 1 })
    expect(body.data.hours[8]!.level).toEqual({ min: 2, max: 3 })
  })

  it('answers all-null for a known station with no estimate that day, never an error', async () => {
    const res = await request('/stations/KCI/MRI/density?day=SUN', MANGGARAI)
    expect(res.status).toBe(200)
    const body = await res.json() as DensityBody
    expect(body.data.day).toBe('SUN')
    expect(body.data.hours).toHaveLength(24)
    expect(body.data.hours.every(h => h.level === null)).toBe(true)
  })

  it('404s an unknown station', async () => {
    const res = await request('/stations/KCI/NOPE/density', undefined)
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: 'UNKNOWN_STATION' } })
  })

  it('404s an unknown operator', async () => {
    const res = await request('/stations/ZZZ/MRI/density', MANGGARAI)
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: 'UNKNOWN_OPERATOR' } })
  })
})
