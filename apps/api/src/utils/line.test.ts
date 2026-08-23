import { OPERATORS } from '@commute/constants'
import { describe, expect, it } from 'vitest'
import { ALL_LINES, getLineByOperator, LINE_LOOKUP_TABLE } from 'utils/line'
import { findTopology } from 'utils/topology'

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

/*
 * `searchable` mirrors the station flag: false means the line exists in the
 * dictionary (so `TJ:2C` on a station still resolves to a name and colour) but
 * has no page worth crawling.
 *
 * The condition is topology, not a hand-kept list. /lines/:operator/:code 404s
 * on a missing topology, so a line flagged searchable without one is a sitemap
 * entry pointing at a soft 404 — which is exactly how 68 TJ feeder lines got
 * indexed as duplicates of each other.
 */
describe('line searchability', () => {
  it('marks a line searchable exactly when it has topology', () => {
    for (const [code, lines] of Object.entries(ALL_LINES)) {
      const operator = code as keyof typeof OPERATORS
      for (const line of lines) {
        expect(
          line.searchable,
          `${code}:${line.lineCode} searchable must match topology presence`
        ).toBe(findTopology(operator, line.lineCode) !== null)
      }
    }
  })

  it('keeps every non-TJ line searchable', () => {
    for (const [code, lines] of Object.entries(ALL_LINES)) {
      if (code === 'TJ') continue
      for (const line of lines) {
        expect(line.searchable, `${code}:${line.lineCode}`).toBe(true)
      }
    }
  })

  it('splits TJ into searchable BRT corridors and hidden feeders', () => {
    const tj = ALL_LINES.TJ
    // The dictionary still carries all of them — only the flag differs.
    expect(tj.length).toBe(100)
    expect(tj.filter(l => l.searchable).length).toBe(31)
    expect(getLineByOperator('TJ', '1')?.searchable).toBe(true)
    expect(getLineByOperator('TJ', '2C')?.searchable).toBe(false)
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
