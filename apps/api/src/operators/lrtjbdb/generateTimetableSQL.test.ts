import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTimetableSQL, normalizeTime, parseTimetableFilename } from 'operators/lrtjbdb/generateTimetableSQL'

describe('parseTimetableFilename', () => {
  it('parses a valid filename', () => {
    expect(parseTimetableFilename('SET_BK_JTM.csv')).toEqual({ station: 'SET', line: 'BK', dest: 'JTM' })
  })

  it('accepts alphanumeric station codes', () => {
    expect(parseTimetableFilename('CK1_BK_DKA.csv')).toEqual({ station: 'CK1', line: 'BK', dest: 'DKA' })
  })

  it('rejects an unknown destination code', () => {
    expect(parseTimetableFilename('SET_BK_XXX.csv')).toHaveProperty('error')
  })

  it('rejects an unknown line code', () => {
    expect(parseTimetableFilename('SET_ZZ_JTM.csv')).toHaveProperty('error')
  })

  it('rejects a station departing to itself', () => {
    expect(parseTimetableFilename('JTM_BK_JTM.csv')).toHaveProperty('error')
  })

  it('rejects lowercase and non-csv names', () => {
    expect(parseTimetableFilename('set_bk_jtm.csv')).toHaveProperty('error')
    expect(parseTimetableFilename('SET_BK_JTM.txt')).toHaveProperty('error')
  })
})

describe('normalizeTime', () => {
  it('zero-pads single-digit hours', () => {
    expect(normalizeTime('6:18')).toBe('06:18:00')
  })

  it('keeps two-digit hours', () => {
    expect(normalizeTime('23:59')).toBe('23:59:00')
  })

  it('rejects invalid times', () => {
    expect(normalizeTime('24:00')).toBeNull()
    expect(normalizeTime('6:5')).toBeNull()
    expect(normalizeTime('06:18:00')).toBeNull()
    expect(normalizeTime('')).toBeNull()
    expect(normalizeTime('berangkat')).toBeNull()
  })
})

describe('buildTimetableSQL', () => {
  it('regenerates the committed SET_BK_JTM file modulo the deliberate changes', () => {
    // Golden round-trip against the committed SQL. Compared to the original
    // hand-generated format, the generator output differs in three deliberate
    // ways: departure hours are zero-padded (lexical-sort fix), a scoped
    // DELETE precedes the INSERT (safe re-apply), and the trailing UPDATE
    // gains its missing semicolon. The committed file is normalized for all
    // three before comparing — each normalization is a no-op once the file
    // has been regenerated, so the test holds for both formats.
    const committedPath = path.resolve(__dirname, '../../db/scripts/lrtjbdb_SET_BK_JTM_timetable.sql')
    const committed = fs.readFileSync(committedPath, 'utf8')

    const times = [...committed.matchAll(/'LRTJBDB-SET', '\d+', '(\d{1,2}):(\d{2}):00'/g)]
      .map(match => `${match[1]}:${match[2]}`)
    expect(times.length).toBeGreaterThan(0)

    const normalized = times.map(time => normalizeTime(time))
    expect(normalized).not.toContain(null)

    const generated = buildTimetableSQL('SET', 'BK', 'JTM', normalized as string[])

    const expected = 'DELETE FROM schedules WHERE stationId = \'LRTJBDB-SET\' AND lineCode = \'BK\' AND boundFor = \'Jatimulya\';\n'
      + committed
        .replace(/^DELETE FROM schedules[^\n]*\n/, '')
        .replace(/'(\d):(\d{2}):00'/g, '\'0$1:$2:00\'')
        .replace(/WHERE id = 'LRTJBDB-SET'\n$/, 'WHERE id = \'LRTJBDB-SET\';\n')
    expect(generated).toBe(expected)
  })
})
