import { describe, expect, it } from 'vitest'
import { formatPlatformCode, joinLabels } from './labels'

describe('joinLabels', () => {
  it('joins station names with a spaced middot', () => {
    expect(joinLabels(['Manggarai', 'BNI City', 'Kampung Bandan'])).toBe('Manggarai · BNI City · Kampung Bandan')
  })

  it('leaves a single label untouched', () => {
    expect(joinLabels(['Jakarta Kota'])).toBe('Jakarta Kota')
  })

  it('returns an empty string for no labels', () => {
    expect(joinLabels([])).toBe('')
  })
})

describe('formatPlatformCode', () => {
  // Stations sign an island platform as a range ("1/2"), so the separator is
  // tightened rather than spaced like a label join.
  it('replaces the slash in a platform range', () => {
    expect(formatPlatformCode('1/2')).toBe('1·2')
    expect(formatPlatformCode('3/4')).toBe('3·4')
  })

  it('leaves a single platform untouched', () => {
    expect(formatPlatformCode('1')).toBe('1')
  })

  it('tolerates padded slashes', () => {
    expect(formatPlatformCode('5 / 6')).toBe('5·6')
  })

  it('handles non-numeric platform identifiers', () => {
    expect(formatPlatformCode('2A/2B')).toBe('2A·2B')
  })
})
