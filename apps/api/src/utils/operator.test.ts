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

  it('returns null for inherited Object.prototype keys', () => {
    // Bracket access must not resolve prototype members like 'toString' or
    // 'constructor' to inherited functions — these are not operators.
    expect(getOperatorByCode('toString')).toBe(null)
    expect(getOperatorByCode('constructor')).toBe(null)
    expect(getOperatorByCode('__proto__')).toBe(null)
  })
})
