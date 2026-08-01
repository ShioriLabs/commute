import { OPERATORS, TRANSIT_MODES } from '@commute/constants'
import { describe, expect, it } from 'vitest'
import { getOperatorByCode } from 'utils/operator'

describe('getOperatorByCode', () => {
  it('resolves a known operator code', () => {
    expect(getOperatorByCode('KCI')).toBe(OPERATORS.KCI)
  })

  /*
   * The GTFS agency.txt fields. Asserted by name rather than as a whole-object
   * literal so adding another optional field here is not a test failure, but
   * dropping one of these — which a consumer generating a feed would depend on
   * — still is.
   */
  it('carries the GTFS agency fields on every real operator', () => {
    for (const [code, operator] of Object.entries(OPERATORS)) {
      if (code === 'NUL') continue // placeholder for unknown codes; never served
      expect(operator.timezone, code).toBe('Asia/Jakarta')
      expect(operator.lang, code).toBe('id')
      expect(operator.url, code).toMatch(/^https:\/\/\S+$/)
      expect(TRANSIT_MODES[operator.mode], code).toBeDefined()
    }
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
