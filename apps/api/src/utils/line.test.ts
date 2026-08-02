import { OPERATORS } from '@commute/constants'
import { describe, expect, it } from 'vitest'
import { ALL_LINES, getLineByOperator, LINE_LOOKUP_TABLE } from 'utils/line'

/*
 * `mode` is optional on Line so trimmed producers (SearchableLine) need not
 * carry it, which means nothing in the type system guarantees the dictionary
 * fills it. These are that guarantee: /operators is where a client resolves a
 * line's mode, so every line it serves must have one.
 */
describe('line modes', () => {
  it('fills every line with its operator mode', () => {
    for (const [code, lines] of Object.entries(ALL_LINES)) {
      const operator = OPERATORS[code as keyof typeof OPERATORS]
      for (const line of lines) {
        expect(line.mode, `${code}:${line.lineCode}`).toBe(operator.mode)
      }
    }
  })

  it('gives TJ corridors the BUS mode and MRT the SUBWAY mode', () => {
    expect(getLineByOperator('TJ', '1')?.mode).toBe('BUS')
    expect(getLineByOperator('MRTJ', 'M')?.mode).toBe('SUBWAY')
    expect(getLineByOperator('KCI', 'C')?.mode).toBe('RAIL')
  })

  // Filling the default must not mutate the operator's own LINES array.
  it('does not mutate the source line definitions', async () => {
    const { LINES } = await import('operators/kci/lines')
    expect(LINES.every(line => !('mode' in line))).toBe(true)
  })
})

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
