import { describe, expect, it } from 'vitest'
import { getLRTJBDBFare, LRTJBDB_FARES } from 'operators/lrtjbdb/fares'

const STATIONS = ['DKA', 'SET', 'RAS', 'KUA', 'PAN', 'CKK', 'CIL', 'CWG', 'HAL', 'JBU', 'CK1', 'CK2', 'BEK', 'JTM', 'HAR', 'KAM', 'CRC', 'TMI']

describe('getLRTJBDBFare', () => {
  it('matches fares quoted from the published table', () => {
    expect(getLRTJBDBFare('DKA', 'PAN')).toBe(8500)
    expect(getLRTJBDBFare('DKA', 'CKK')).toBe(9900)
    expect(getLRTJBDBFare('DKA', 'CWG')).toBe(11300)
    expect(getLRTJBDBFare('HAR', 'CWG')).toBe(14800)
  })

  it('falls back to the reverse direction', () => {
    expect(getLRTJBDBFare('PAN', 'DKA')).toBe(8500)
  })

  it('prices every pair of distinct stations, within the tariff range', () => {
    for (const a of STATIONS) {
      for (const b of STATIONS) {
        if (a === b) continue
        const fare = getLRTJBDBFare(a, b)
        expect(fare, `${a}->${b}`).not.toBeNull()
        expect(fare!).toBeGreaterThanOrEqual(5000)
        expect(fare!).toBeLessThanOrEqual(20000)
        expect((fare! - 5000) % 700 === 0 || fare === 20000, `${a}->${b} ${fare}`).toBe(true)
      }
    }
  })

  it('stores each unordered pair once', () => {
    for (const [a, row] of Object.entries(LRTJBDB_FARES)) {
      for (const b of Object.keys(row)) expect(LRTJBDB_FARES[b]?.[a], `${a}<->${b}`).toBeUndefined()
    }
  })

  it('returns null for the same station or an unknown code', () => {
    expect(getLRTJBDBFare('DKA', 'DKA')).toBeNull()
    expect(getLRTJBDBFare('DKA', 'XXX')).toBeNull()
  })
})
