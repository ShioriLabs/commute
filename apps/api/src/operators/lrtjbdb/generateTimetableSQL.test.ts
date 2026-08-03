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

  it('rejects line/destination pairs that are not service patterns', () => {
    expect(parseTimetableFilename('SET_BK_HAR.csv')).toHaveProperty('error')
    expect(parseTimetableFilename('SET_CB_JTM.csv')).toHaveProperty('error')
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
  it('assigns even trip numbers towards Dukuh Atas and odd away, per line series', () => {
    const towardsDKA = buildTimetableSQL('SET', 'BK', 'DKA', ['05:59:00', '06:07:00'])
    expect(towardsDKA).toContain('\'LRTJBDB-SET-BK-1-DKA\', \'LRTJBDB-SET\', \'LRTJBDB-1000\'')
    expect(towardsDKA).toContain('\'LRTJBDB-SET-BK-2-DKA\', \'LRTJBDB-SET\', \'LRTJBDB-1002\'')

    const awayFromDKA = buildTimetableSQL('SET', 'CB', 'HAR', ['06:12:00', '06:20:00'])
    expect(awayFromDKA).toContain('\'LRTJBDB-SET-CB-1-HAR\', \'LRTJBDB-SET\', \'LRTJBDB-2001\'')
    expect(awayFromDKA).toContain('\'LRTJBDB-SET-CB-2-HAR\', \'LRTJBDB-SET\', \'LRTJBDB-2003\'')
  })

  it('round-trips the committed SET_BK_JTM CSV to the committed SQL byte-for-byte', () => {
    const csv = fs.readFileSync(path.resolve(__dirname, 'timetables/SET_BK_JTM.csv'), 'utf8')
    const times = csv.split(/\r?\n/).filter(line => line.trim()).map(line => normalizeTime(line))
    expect(times.length).toBeGreaterThan(0)
    expect(times).not.toContain(null)

    const generated = buildTimetableSQL('SET', 'BK', 'JTM', times as string[])
    const committed = fs.readFileSync(path.resolve(__dirname, '../../db/scripts/lrtjbdb_SET_BK_JTM_timetable.sql'), 'utf8')
    expect(generated).toBe(committed)
  })
})
