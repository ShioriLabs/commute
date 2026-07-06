import { describe, expect, it } from 'vitest'
import { calculateSegmentFare, LRTJBDB_FARE_CAP } from 'utils/fare'

const seg = (operator: string, distanceM: number, from = 'X', to = 'Y') =>
  ({ operator, distanceM, fromStationCode: from, toStationCode: to }) as Parameters<typeof calculateSegmentFare>[0]

describe('KCI progressive fare', () => {
  it('charges the base fare up to exactly 25 km', () => {
    expect(calculateSegmentFare(seg('KCI', 1000))).toBe(3000)
    expect(calculateSegmentFare(seg('KCI', 25000))).toBe(3000)
  })

  it('adds 1000 per started 10 km block past 25 km', () => {
    expect(calculateSegmentFare(seg('KCI', 25001))).toBe(4000)
    expect(calculateSegmentFare(seg('KCI', 35000))).toBe(4000)
    expect(calculateSegmentFare(seg('KCI', 54800))).toBe(6000) // Bogor-Jakarta Kota
  })
})

describe('LRTJ flat fare', () => {
  it('is 5000 regardless of distance', () => {
    expect(calculateSegmentFare(seg('LRTJ', 12000))).toBe(5000)
  })
})

describe('LRTJBDB distance fare with cap', () => {
  it('charges 5000 for the first km', () => {
    expect(calculateSegmentFare(seg('LRTJBDB', 900))).toBe(5000)
  })

  it('adds 700 per started km after the first', () => {
    expect(calculateSegmentFare(seg('LRTJBDB', 2500))).toBe(6400) // 5000 + 2*700
  })

  it('never exceeds the cap', () => {
    expect(calculateSegmentFare(seg('LRTJBDB', 90000))).toBe(LRTJBDB_FARE_CAP)
  })
})

describe('MRTJ matrix fare', () => {
  it('returns the matrix value for a known pair', () => {
    expect(calculateSegmentFare(seg('MRTJ', 15700, 'LBB', 'BHI'))).toBe(14000)
  })

  it('is direction-agnostic', () => {
    expect(calculateSegmentFare(seg('MRTJ', 15700, 'BHI', 'LBB'))).toBe(14000)
    expect(calculateSegmentFare(seg('MRTJ', 800, 'DKA', 'BHI'))).toBe(3000)
    expect(calculateSegmentFare(seg('MRTJ', 800, 'BHI', 'DKA'))).toBe(3000)
  })

  it('returns null for codes missing from the matrix', () => {
    expect(calculateSegmentFare(seg('MRTJ', 1000, 'ZZ', 'QQ'))).toBeNull()
  })
})

describe('unknown operator', () => {
  it('returns null instead of guessing', () => {
    expect(calculateSegmentFare(seg('NUL', 1000))).toBeNull()
  })
})
