import { OPERATORS } from '@commute/constants'
import { describe, expect, it } from 'vitest'
import { getOperatorByCode } from 'utils/operator'

describe('getOperatorByCode', () => {
  it('resolves a known operator code', () => {
    expect(getOperatorByCode('KCI')).toEqual({ code: 'KCI', name: 'Commuter Line' })
  })

  it('resolves every defined operator code', () => {
    for (const code of Object.keys(OPERATORS)) {
      expect(getOperatorByCode(code)).toBe(OPERATORS[code as keyof typeof OPERATORS])
    }
  })

  it('returns null for an unknown code', () => {
    expect(getOperatorByCode('ZZZ')).toBe(null)
  })

  it('returns null for an empty string', () => {
    expect(getOperatorByCode('')).toBe(null)
  })

  it('is case-sensitive', () => {
    expect(getOperatorByCode('kci')).toBe(null)
  })

  it('leaks inherited Object.prototype members via bracket access', () => {
    // BUG: OPERATORS[code] uses bracket access on a plain object, so prototype
    // keys resolve to inherited functions instead of null. Pinning current
    // behavior — 'toString'/'constructor' should arguably return null.
    expect(typeof getOperatorByCode('toString')).toBe('function')
    expect(typeof getOperatorByCode('constructor')).toBe('function')
  })
})
