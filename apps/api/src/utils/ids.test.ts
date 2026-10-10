import { describe, expect, it } from 'vitest'
import { lineCodeOf, lineKey, stationCodeOf } from 'utils/ids'

describe('ids', () => {
  it('lineKey qualifies a line code with its operator', () => {
    expect(lineKey('KCI', 'C')).toBe('KCI:C')
  })

  it('lineCodeOf inverts lineKey, including codes that contain a colon-free dash', () => {
    expect(lineCodeOf(lineKey('TJ', 'L13E'))).toBe('L13E')
    expect(lineCodeOf('TJ:1-A')).toBe('1-A')
  })

  it('lineCodeOf leaves a key with no operator prefix untouched', () => {
    expect(lineCodeOf('C')).toBe('C')
  })

  it('stationCodeOf drops the operator and its separator', () => {
    expect(stationCodeOf('KCI', 'KCI-MRI')).toBe('MRI')
    expect(stationCodeOf('TJ', 'TJ-H00265P')).toBe('H00265P')
  })
})
