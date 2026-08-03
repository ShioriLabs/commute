import { describe, expect, it } from 'vitest'
import { codeOfLineKey, operatorOfLineKey } from './line-keys'

describe('codeOfLineKey', () => {
  it('returns the bare code a roundel displays', () => {
    expect(codeOfLineKey('KCI:C')).toBe('C')
    expect(codeOfLineKey('LRTJBDB:BK')).toBe('BK')
  })

  it('returns the input when it carries no operator prefix', () => {
    expect(codeOfLineKey('C')).toBe('C')
  })

  /*
   * A leg can reach the renderer with no line key. SWR persists fare responses
   * to IndexedDB, so a body cached under an older response shape outlives the
   * deploy that changed it. Throwing here took down the entire result view over
   * one unlabelled roundel — "Cannot read properties of undefined (reading
   * 'split')", observed 2026-08-03.
   */
  it('degrades to an empty label instead of throwing on a missing key', () => {
    expect(codeOfLineKey(undefined)).toBe('')
    expect(codeOfLineKey(null)).toBe('')
    expect(codeOfLineKey('')).toBe('')
  })
})

describe('operatorOfLineKey', () => {
  it('returns the operator', () => {
    expect(operatorOfLineKey('KCI:C')).toBe('KCI')
  })

  it('returns undefined for a missing or unprefixed key', () => {
    expect(operatorOfLineKey(undefined)).toBeUndefined()
    expect(operatorOfLineKey(null)).toBeUndefined()
    expect(operatorOfLineKey('')).toBeUndefined()
  })
})
