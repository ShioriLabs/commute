import { describe, expect, it } from 'vitest'
import {
  buildTimetableSQL,
  DEST_BOUND_FOR,
  normalizeTime,
  parseTimetableFilename,
  TRIP_NUMBER_BASE
} from 'operators/apcgk/generateTimetableSQL'

describe('parseTimetableFilename', () => {
  it('parses a valid filename', () => {
    expect(parseTimetableFilename('T1_KLB_T3.csv')).toEqual({ station: 'T1', line: 'KLB', dest: 'T3' })
  })

  it('accepts the four-letter interchange code', () => {
    expect(parseTimetableFilename('SHIA_KLB_T1.csv')).toEqual({ station: 'SHIA', line: 'KLB', dest: 'T1' })
  })

  it('rejects an unknown destination code', () => {
    // T2 is an intermediate stop, never a terminus.
    expect(parseTimetableFilename('T1_KLB_T2.csv')).toHaveProperty('error')
  })

  it('rejects an unknown line code', () => {
    expect(parseTimetableFilename('T1_ZZZ_T3.csv')).toHaveProperty('error')
  })

  it('rejects a station departing to itself', () => {
    expect(parseTimetableFilename('T3_KLB_T3.csv')).toHaveProperty('error')
  })

  it('rejects lowercase and non-csv names', () => {
    expect(parseTimetableFilename('t1_klb_t3.csv')).toHaveProperty('error')
    expect(parseTimetableFilename('T1_KLB_T3.txt')).toHaveProperty('error')
  })
})

describe('normalizeTime', () => {
  it('zero-pads single-digit hours', () => {
    expect(normalizeTime('5:58')).toBe('05:58:00')
  })

  it('keeps two-digit hours', () => {
    expect(normalizeTime('23:54')).toBe('23:54:00')
  })

  it('rejects invalid times', () => {
    expect(normalizeTime('24:00')).toBeNull()
    expect(normalizeTime('6:5')).toBeNull()
    expect(normalizeTime('05:58:00')).toBeNull()
    expect(normalizeTime('')).toBeNull()
  })
})

describe('buildTimetableSQL', () => {
  it('numbers trips from the direction series, two apart', () => {
    const sql = buildTimetableSQL('T1', 'KLB', 'T3', ['05:58:00', '06:11:00'])
    expect(sql).toContain('\'APCGK-T1-KLB-1-T3\', \'APCGK-T1\', \'APCGK-100\'')
    expect(sql).toContain('\'APCGK-T1-KLB-2-T3\', \'APCGK-T1\', \'APCGK-102\'')
  })

  it('gives each direction its own series so they never collide', () => {
    expect(TRIP_NUMBER_BASE.KLB_T3).toBe(100)
    expect(TRIP_NUMBER_BASE.KLB_T1).toBe(101)
    const towardsT1 = buildTimetableSQL('T2', 'KLB', 'T1', ['06:04:00'])
    expect(towardsT1).toContain('\'APCGK-101\'')
  })

  it('labels the board with the terminus display name', () => {
    expect(buildTimetableSQL('SHIA', 'KLB', 'T1', ['06:07:00'])).toContain('\'Terminal 1\'')
    expect(buildTimetableSQL('SHIA', 'KLB', 'T3', ['06:02:00'])).toContain('\'Terminal 3\'')
    expect(DEST_BOUND_FOR.T3).toBe('Terminal 3')
  })

  /*
   * Intermediate stations carry both directions, so a station-wide delete would
   * wipe the opposite board on every regeneration.
   */
  it('scopes the delete to one station+line+direction', () => {
    const sql = buildTimetableSQL('SHIA', 'KLB', 'T1', ['06:07:00'])
    expect(sql).toContain('DELETE FROM schedules WHERE id LIKE \'APCGK-SHIA-KLB-%-T1\';')
    expect(sql).not.toMatch(/DELETE FROM schedules WHERE stationId = 'APCGK-SHIA';/)
  })

  it('flags the station synced', () => {
    expect(buildTimetableSQL('T3', 'KLB', 'T1', ['05:58:00']))
      .toContain('UPDATE stations SET timetableSynced = 1 WHERE id = \'APCGK-T3\';')
  })

  it('carries the line code onto every row', () => {
    expect(buildTimetableSQL('T2', 'KLB', 'T3', ['06:05:00'])).toContain('\'KLB\', CURRENT_TIMESTAMP')
  })
})
