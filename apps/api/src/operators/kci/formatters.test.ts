import { describe, expect, it } from 'vitest'
import { BOGOR_LINE, CIKARANG_LINE } from 'operators/kci/lines'
import { getLineInfoByLineCode, getLineInfoFromAPIName, tryGetFormattedName } from 'operators/kci/formatters'

describe('tryGetFormattedName', () => {
  it('returns a well-known name by code, ignoring the raw station name', () => {
    expect(tryGetFormattedName('KLDB', 'KLENDERBARU')).toBe('Klender Baru')
  })

  it('title-cases an unknown-code multi-word name', () => {
    expect(tryGetFormattedName('XXX', 'TANAH ABANG')).toBe('Tanah Abang')
  })

  it('title-cases a single-word name', () => {
    expect(tryGetFormattedName('XXX', 'BOGOR')).toBe('Bogor')
  })

  it('expands the UNIV. token to Universitas', () => {
    expect(tryGetFormattedName('XXX', 'UNIV. INDONESIA')).toBe('Universitas Indonesia')
  })

  it('handles a single-character word', () => {
    expect(tryGetFormattedName('XXX', 'A')).toBe('A')
  })

  it('does not leak literal "undefined" for empty/whitespace input', () => {
    // Empty tokens (from empty input or double spaces) must be dropped, not
    // rendered as the literal word "undefined".
    expect(tryGetFormattedName('XXX', '')).toBe('')
    expect(tryGetFormattedName('XXX', 'TANAH  ABANG')).toBe('Tanah Abang')
  })

  it('trims surrounding whitespace without leaking fragments', () => {
    expect(tryGetFormattedName('XXX', ' TANAH ABANG ')).toBe('Tanah Abang')
  })
})

describe('getLineInfoFromAPIName', () => {
  it('maps a known API line name to its Line', () => {
    expect(getLineInfoFromAPIName('COMMUTER LINE BOGOR')).toBe(BOGOR_LINE)
  })

  it('returns undefined for an unknown name', () => {
    expect(getLineInfoFromAPIName('COMMUTER LINE NOWHERE')).toBeUndefined()
  })

  it('returns undefined for an empty name', () => {
    expect(getLineInfoFromAPIName('')).toBeUndefined()
  })

  it('is case-sensitive', () => {
    expect(getLineInfoFromAPIName('commuter line bogor')).toBeUndefined()
  })
})

describe('getLineInfoByLineCode', () => {
  it('resolves a valid line code', () => {
    expect(getLineInfoByLineCode('C')).toBe(CIKARANG_LINE)
  })

  it('returns undefined for an unknown code', () => {
    expect(getLineInfoByLineCode('ZZ')).toBeUndefined()
  })

  it('returns undefined for an empty code', () => {
    expect(getLineInfoByLineCode('')).toBeUndefined()
  })
})
