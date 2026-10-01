import { beforeAll, describe, expect, it } from 'vitest'
import { buildInternalDocument } from './openapi-internal'

/*
 * Guards on the internal OpenAPI document, the one the Android app generates its
 * models from.
 *
 * In a file of its own on purpose: hono-openapi resolves a schema's components
 * once per process, so generating this after /openapi.json in the same test file
 * would return it with no components at all. routes/openapi.test.ts holds the
 * other half, that nothing under `/_internal` reaches the public document.
 */

interface Spec {
  paths: Record<string, Record<string, { tags?: string[], responses?: Record<string, unknown> }>>
  components?: { schemas?: Record<string, unknown> }
}

let spec: Spec

beforeAll(async () => {
  spec = await buildInternalDocument() as unknown as Spec
})

describe('internal OpenAPI document', () => {
  it('describes the search index', () => {
    const op = spec.paths['/_internal/searchables']?.get
    expect(op?.tags).toEqual(['Internal'])
    expect(JSON.stringify(op?.responses?.['200'])).toContain('#/components/schemas/SearchableIndex')
  })

  // A generator names its classes after these. Inlined, they would come out as
  // anonymous types numbered by position, and renumber whenever a route moved.
  it.each([
    'SearchableIndex',
    'Searchable',
    'SearchableStation',
    'SearchableHub',
    'SearchableLineEntry',
    'SearchableLine'
  ])('registers %s as a named component', (name) => {
    expect(spec.components?.schemas?.[name]).toBeDefined()
  })

  it('is a superset of the public document', () => {
    expect(Object.keys(spec.paths)).toContain('/stations')
    expect(Object.keys(spec.paths)).toContain('/fares/{from}/{to}')
  })

  it('resolves every $ref against components', () => {
    const refs: string[] = []
    JSON.stringify(spec, (key, value) => {
      if (key === '$ref' && typeof value === 'string') refs.push(value)
      return value as unknown
    })

    for (const ref of refs) {
      const name = ref.replace('#/components/schemas/', '')
      expect(spec.components?.schemas?.[name], `dangling $ref: ${ref}`).toBeDefined()
    }
  })

  it('documents no write method', () => {
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const method of Object.keys(methods)) {
        expect(['get', 'head', 'options'], `${path} exposes ${method}`).toContain(method)
      }
    }
  })
})
