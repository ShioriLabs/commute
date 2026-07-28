import { beforeAll, describe, expect, it } from 'vitest'
import app from 'app'

/*
 * Guards on the generated OpenAPI document.
 *
 * The point of generating docs from the code is that they cannot quietly lie.
 * The test that earns its keep here is "every public route is described" — it
 * fails when someone adds a route and forgets to annotate it, which is exactly
 * how hand-maintained API docs rot.
 */

interface Spec {
  openapi: string
  info: { title: string, version: string, description?: string }
  servers?: { url: string }[]
  tags?: { name: string }[]
  paths: Record<string, Record<string, { summary?: string, tags?: string[], responses?: Record<string, unknown> }>>
  components?: { schemas?: Record<string, unknown> }
}

let spec: Spec

beforeAll(async () => {
  const res = await app.request('/openapi.json')
  expect(res.status).toBe(200)
  spec = await res.json() as Spec
})

// Every public read route the API serves. Adding one here without annotating
// the handler fails the "is described" test below, and vice versa.
const PUBLIC_ROUTES = [
  '/stations',
  '/stations/{operator}',
  '/stations/{operator}/{stationCode}',
  '/stations/{operator}/{stationCode}/timetable',
  '/stations/{operator}/{stationCode}/timetable/grouped',
  '/stations/{operator}/{stationCode}/timetable/{line}',
  '/stations/{operator}/{stationCode}/transfers',
  '/hubs',
  '/hubs/{slug}',
  '/lines/{operator}/{lineCode}',
  '/fares/{from}/{to}',
  '/operators'
]

describe('GET /openapi.json', () => {
  it('serves a valid OpenAPI 3.1 document', () => {
    expect(spec.openapi).toMatch(/^3\.1\./)
    expect(spec.info.title).toBe('Commute API')
    expect(spec.info.version).toBeTruthy()
  })

  it('points at the production server', () => {
    expect(spec.servers?.[0]?.url).toBe('https://api.commute.shiorilabs.id')
  })

  it('explains the response envelope, which every route shares', () => {
    expect(spec.info.description).toContain('envelope')
    expect(spec.info.description).toContain('data')
    expect(spec.info.description).toContain('error')
  })
})

/*
 * hono-openapi only emits paths that carry a describeRoute, so comparing the
 * spec against itself can never reveal an unannotated route — it is simply
 * absent from both sides. Hono's own route table is the ground truth, so the
 * coverage check below reads from there.
 */
function registeredRoutes() {
  const routes = (app as unknown as { routes: { path: string, method: string }[] }).routes
  return [...new Set(
    routes
      .filter(route => route.method === 'GET')
      // `ALL /*` is the CORS middleware, not a route.
      .filter(route => route.path !== '/*')
      // Documentation endpoints describe the API; they are not part of it.
      .filter(route => route.path !== '/openapi.json')
      // Mutations and internal endpoints are deliberately undocumented.
      .filter(route => !/^\/(sync|cache|_internal)\b/.test(route.path))
      // Hono writes `:param`; OpenAPI writes `{param}`.
      .map(route => route.path.replace(/:(\w+)/g, '{$1}'))
  )]
}

describe('coverage', () => {
  it.each(PUBLIC_ROUTES)('documents %s', (path) => {
    expect(Object.keys(spec.paths)).toContain(path)
  })

  it('documents no route beyond the known public set', () => {
    expect(Object.keys(spec.paths).sort()).toEqual([...PUBLIC_ROUTES].sort())
  })

  // The test that earns its keep: add a public GET without a describeRoute and
  // this fails, naming the route you forgot.
  it('describes every public GET the app actually serves', () => {
    const undocumented = registeredRoutes().filter(path => !(path in spec.paths))
    expect(undocumented, `these routes are served but undocumented: ${undocumented.join(', ')}`).toEqual([])
  })

  it('describes nothing the app does not serve', () => {
    const registered = registeredRoutes()
    const phantom = Object.keys(spec.paths).filter(path => !registered.includes(path))
    expect(phantom, `documented but not served: ${phantom.join(', ')}`).toEqual([])
  })

  it('gives every route a summary and a tag', () => {
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        expect(op.summary, `${method.toUpperCase()} ${path} has no summary`).toBeTruthy()
        expect(op.tags?.length, `${method.toUpperCase()} ${path} has no tag`).toBeGreaterThan(0)
      }
    }
  })

  it('describes a 200 for every route', () => {
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const op of Object.values(methods)) {
        expect(Object.keys(op.responses ?? {}), `${path} documents no 200`).toContain('200')
      }
    }
  })
})

describe('what must never be published', () => {
  // These mutate data or are shaped for one consumer. Publishing them would
  // invite exactly the traffic they are not built for.
  it.each(['sync', 'cache', '_internal'])('leaks no %s route', (segment) => {
    const leaked = Object.keys(spec.paths).filter(path => path.includes(segment))
    expect(leaked).toEqual([])
  })

  it('documents no write method anywhere', () => {
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const method of Object.keys(methods)) {
        expect(['get', 'head', 'options'], `${path} exposes ${method}`).toContain(method)
      }
    }
  })
})

describe('schema integrity', () => {
  it('resolves every $ref against components', () => {
    const refs: string[] = []
    JSON.stringify(spec, (key, value) => {
      if (key === '$ref' && typeof value === 'string') refs.push(value)
      return value as unknown
    })

    for (const ref of refs) {
      expect(ref, `unexpected $ref target: ${ref}`).toMatch(/^#\/components\/schemas\//)
      const name = ref.replace('#/components/schemas/', '')
      expect(spec.components?.schemas?.[name], `dangling $ref: ${ref}`).toBeDefined()
    }
  })

  it('derives the operator enum from constants, so a new operator cannot drift out', () => {
    const json = JSON.stringify(spec)
    for (const code of ['KCI', 'MRTJ', 'LRTJ', 'LRTJBDB', 'TJ']) {
      expect(json, `operator ${code} missing from the spec`).toContain(`"${code}"`)
    }
    // NUL is an internal placeholder and must not be offered to consumers.
    expect(json).not.toContain('"NUL"')
  })
})

/*
 * There is no /docs route: the reference moved to CDP, which builds it from this
 * document. Asserting its absence keeps a Scalar-style page from creeping back
 * onto the worker.
 */
describe('GET /docs', () => {
  it('is not served by the API', async () => {
    const res = await app.request('/docs')
    expect(res.status).toBe(404)
  })

  it('points readers at the reference from the spec itself', () => {
    expect(spec.info.description).toContain('data.commute.shiorilabs.id/docs')
  })
})
