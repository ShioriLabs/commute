import { describe, expect, it } from 'vitest'
import { splitStationNumber } from './station-number'

describe('splitStationNumber', () => {
  it('splits rail codes on the letter prefix', () => {
    expect(splitStationNumber('C13')).toEqual({ prefix: 'C', num: '13' })
    expect(splitStationNumber('M01')).toEqual({ prefix: 'M', num: '01' })
    expect(splitStationNumber('BK14')).toEqual({ prefix: 'BK', num: '14' })
  })

  it('keeps the KCI irregulars intact', () => {
    // Nambo branch is lowercase; Karet carries a suffix letter.
    expect(splitStationNumber('b23')).toEqual({ prefix: 'b', num: '23' })
    expect(splitStationNumber('C11a')).toEqual({ prefix: 'C', num: '11a' })
  })

  it('splits TransJakarta corridor-sequence numbers on the hyphen', () => {
    // FDTJ prints these as corridor over sequence, the same stacked shape as
    // the rail codes above — there is just no letter to split on.
    expect(splitStationNumber('13-4')).toEqual({ prefix: '13', num: '4' })
    expect(splitStationNumber('1-1')).toEqual({ prefix: '1', num: '1' })
    expect(splitStationNumber('9-26')).toEqual({ prefix: '9', num: '26' })
  })

  it('falls back to the whole string when there is nothing to split', () => {
    expect(splitStationNumber('7')).toEqual({ prefix: '', num: '7' })
    expect(splitStationNumber('')).toEqual({ prefix: '', num: '' })
  })
})
