import { describe, expect, it } from 'vitest'
import { ALL_LINES, getLineByOperator, LINE_LOOKUP_TABLE } from 'utils/line'

describe('getLineByOperator', () => {
  it('resolves a real line for KCI', () => {
    const line = getLineByOperator('KCI', 'C')
    expect(line).not.toBeNull()
    expect(line?.lineCode).toBe('C')
  })

  it('resolves a real line for MRTJ', () => {
    expect(getLineByOperator('MRTJ', 'M')?.lineCode).toBe('M')
  })

  it('returns null for an unknown line code', () => {
    expect(getLineByOperator('KCI', 'ZZ')).toBe(null)
  })

  it('returns null for the NUL operator (no lines)', () => {
    expect(getLineByOperator('NUL', 'anything')).toBe(null)
  })
})

describe('LINE_LOOKUP_TABLE', () => {
  it('has one entry per line across all operators (no key collisions)', () => {
    const totalLines = Object.values(ALL_LINES).reduce((sum, lines) => sum + lines.length, 0)
    expect(LINE_LOOKUP_TABLE.size).toBe(totalLines)
  })
})
