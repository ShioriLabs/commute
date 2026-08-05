import { describe, expect, it } from 'vitest'
import { codeOfLineKey, operatorOfLineKey } from './use-lines'

describe('codeOfLineKey', () => {
  it('takes the bare code off a line key', () => {
    expect(codeOfLineKey('KCI:C')).toBe('C')
    expect(codeOfLineKey('MRTJ:M')).toBe('M')
  })

  it('falls back to the whole key when there is no separator', () => {
    expect(codeOfLineKey('C')).toBe('C')
  })

  /*
   * The schema types `line` as a required, non-nullable string, so a missing
   * key type-checks fine at every call site and only bites at runtime — stale
   * service-worker caches serve pre-direction-group payloads, and deploy skew
   * briefly serves old shapes to new code. This used to throw on `.split` and
   * take the whole card tree down with it.
   */
  it('absorbs a missing key instead of throwing', () => {
    expect(codeOfLineKey(undefined)).toBe('')
    expect(codeOfLineKey('')).toBe('')
  })
})

describe('operatorOfLineKey', () => {
  it('takes the operator off a line key', () => {
    expect(operatorOfLineKey('KCI:C')).toBe('KCI')
    expect(operatorOfLineKey('TJ:1')).toBe('TJ')
  })

  it('absorbs a missing key instead of throwing', () => {
    expect(operatorOfLineKey(undefined)).toBeUndefined()
    expect(operatorOfLineKey('')).toBeUndefined()
  })
})
