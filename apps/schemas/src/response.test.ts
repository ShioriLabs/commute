import { describe, expect, it } from 'vitest'
import type { StandardResponse } from './common'

/*
 * The envelope is a discriminated union, and these are type-level assertions as
 * much as runtime ones. `@ts-expect-error` is doing the real work: if someone
 * relaxes `error?: never` back to `error?: APIError`, the union stops
 * discriminating, those directives become unused, and TYPECHECK fails — which is
 * the point. A green run of this file alone does not prove much; a green
 * `tsc --noEmit` alongside it does.
 */

describe('StandardResponse', () => {
  it('narrows to the payload once `error` is ruled out', () => {
    const response: StandardResponse<{ name: string }> = {
      status: 200,
      data: { name: 'Sudirman' }
    }

    if (response.error) {
      throw new Error('unreachable')
    }

    // `data` is non-optional here — no `?.` and no `!` needed.
    expect(response.data.name).toBe('Sudirman')
  })

  it('narrows to the error once `data` is ruled out', () => {
    const response: StandardResponse<{ name: string }> = {
      status: 404,
      error: { code: 'NOT_FOUND', message: 'Not found' }
    }

    if (response.data) {
      throw new Error('unreachable')
    }

    expect(response.error.code).toBe('NOT_FOUND')
  })

  it('still supports optional chaining, so existing call sites keep working', () => {
    // Typed as the union rather than a literal: that is the shape a caller
    // actually holds — a fetch result, before it knows which arm it got.
    const responses: StandardResponse<{ name: string }>[] = [
      { status: 200, data: { name: 'BNI City' } },
      { status: 404, error: { code: 'NOT_FOUND', message: 'Not found' } }
    ]

    expect(responses.map(response => response.data?.name)).toEqual(['BNI City', undefined])
  })

  it('rejects a response carrying both `data` and `error`', () => {
    // @ts-expect-error a response is never both a success and a failure
    const both: StandardResponse<{ name: string }> = {
      status: 200,
      data: { name: 'Sudirman' },
      error: { code: 'NOT_FOUND', message: 'Not found' }
    }

    // The guarantee is compile-time; at runtime the object still exists.
    expect(both.status).toBe(200)
  })

  it('rejects a response carrying neither', () => {
    // @ts-expect-error one of `data` or `error` is always present
    const neither: StandardResponse<{ name: string }> = { status: 204 }

    expect(neither.status).toBe(204)
  })
})
