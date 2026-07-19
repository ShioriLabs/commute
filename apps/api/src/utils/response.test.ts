import { describe, expect, it } from 'vitest'
import { Internal, NotFound, Ok } from 'utils/response'

describe('Ok', () => {
  it('wraps data with status 200 and no error', () => {
    const res = Ok({ hello: 'world' })
    expect(res).toEqual({ status: 200, data: { hello: 'world' } })
    expect('error' in res).toBe(false)
  })

  it('carries null/undefined data through without an error field', () => {
    expect(Ok(null)).toEqual({ status: 200, data: null })
    expect(Ok(undefined)).toEqual({ status: 200, data: undefined })
  })
})

describe('NotFound', () => {
  it('defaults to 404 with NOT_FOUND code', () => {
    expect(NotFound()).toEqual({
      status: 404,
      error: { code: 'NOT_FOUND', message: 'Not found' }
    })
  })

  it('accepts custom code and message', () => {
    expect(NotFound('NO_STATION', 'Station missing')).toEqual({
      status: 404,
      error: { code: 'NO_STATION', message: 'Station missing' }
    })
  })

  it('keeps an empty-string code (default only fires on undefined)', () => {
    expect(NotFound('').error?.code).toBe('')
  })
})

describe('Internal', () => {
  it('defaults to 500 with INTERNAL code', () => {
    expect(Internal()).toEqual({
      status: 500,
      error: { code: 'INTERNAL', message: 'Internal server error' }
    })
  })

  it('accepts custom code and message', () => {
    expect(Internal('DB_DOWN', 'Database unavailable')).toEqual({
      status: 500,
      error: { code: 'DB_DOWN', message: 'Database unavailable' }
    })
  })
})
