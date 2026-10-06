import { describe, expect, it } from 'vitest'
import { buildTimetableSQL, convertDump, type KCIDump } from 'operators/kci/generateTimetableFromDumpSQL'
import { toTimetableRows } from 'operators/kci/sync'
import { fromFeedStationCode, toFeedStationCode } from 'operators/kci/formatters'

// Shaped like a live /api/krl/schedules body, trimmed to the fields read.
const departure = (trainId: string, dest = 'CIKARANG', time = '05:00:00') => ({
  train_id: trainId,
  ka_name: 'COMMUTER LINE CIKARANG',
  dest,
  time_est: time,
  dest_time: '06:00:00'
})
const ok = (...data: unknown[]) => ({ status: 200, data })

describe('toTimetableRows', () => {
  it('stores against our code, not the feed\'s', () => {
    const [row] = toTimetableRows('TTI', ok(departure('1001')))!
    expect(row!.id).toBe('KCI-TTI-1001')
    expect(row!.stationId).toBe('KCI-TTI')
    expect(row!.lineCode).toBe('C')
  })

  it('strips the literal "undefined " the feed sometimes prefixes', () => {
    const [row] = toTimetableRows('CUK', ok(departure('1001', 'undefined CIKARANG')))!
    expect(row!.boundFor).toBe('Cikarang')
  })

  it('refuses a body that is not a success', () => {
    expect(toTimetableRows('CUK', { status: 403, data: [] })).toBeNull()
    expect(toTimetableRows('CUK', '<!DOCTYPE html>')).toBeNull()
  })
})

describe('fromFeedStationCode', () => {
  it('undoes every rename toFeedStationCode applies', () => {
    expect(fromFeedStationCode(toFeedStationCode('TTI'))).toBe('TTI')
    expect(fromFeedStationCode(toFeedStationCode('GGL'))).toBe('GGL')
  })

  it('passes an unrenamed code through', () => {
    expect(fromFeedStationCode('CUK')).toBe('CUK')
  })
})

describe('convertDump', () => {
  const dump = (schedules: KCIDump['schedules']): KCIDump => ({ fetchedAt: '2026-10-06T01:20:00Z', schedules })

  it('keys a renamed station back to our code', () => {
    const { boards } = convertDump(dump({ THI: ok(departure('1001')) }))
    expect(boards[0]!.stationCode).toBe('TTI')
  })

  // Neither may wipe the board the station already has.
  it('reports failed and empty responses instead of converting them', () => {
    const { boards, failed, empty } = convertDump(dump({
      CUK: ok(departure('1001')),
      MRI: { status: 403, data: [] },
      JNG: ok()
    }))
    expect(boards.map(b => b.stationCode)).toEqual(['CUK'])
    expect(failed).toEqual(['MRI'])
    expect(empty).toEqual(['JNG'])
  })

  it('skips stations outside Jabodetabek, judged by the dump\'s own station list', () => {
    const { boards, outsideRegion } = convertDump({
      ...dump({ CUK: ok(departure('1001')), YK: ok(departure('2001')) }),
      stations: { data: [{ sta_id: 'CUK', group_wil: 0 }, { sta_id: 'YK', group_wil: 6 }] }
    })
    expect(boards.map(b => b.stationCode)).toEqual(['CUK'])
    expect(outsideRegion).toEqual(['YK'])
  })

  // The list can still carry the old code after the schedules API has moved on.
  it('finds a renamed station\'s region under our code', () => {
    const { boards } = convertDump({
      ...dump({ GRG: ok(departure('1001')) }),
      stations: { data: [{ sta_id: 'GGL', group_wil: 0 }] }
    })
    expect(boards.map(b => b.stationCode)).toEqual(['GGL'])
  })

  it('dedupes on row id, last wins, as insertTimetable does', () => {
    const { boards } = convertDump(dump({ CUK: ok(departure('1001', 'CIKARANG', '05:00:00'), departure('1001', 'CIKARANG', '05:05:00')) }))
    expect(boards[0]!.rows).toHaveLength(1)
    expect(boards[0]!.rows[0]!.estimatedDeparture).toBe('05:05:00')
  })
})

describe('buildTimetableSQL', () => {
  const board = (count: number) => ({
    stationCode: 'MRI',
    rows: toTimetableRows('MRI', ok(...Array.from({ length: count }, (_, i) => departure(String(1000 + i)))))!
  })

  // generateBasoettaTimetableSQL owns line A at these stations; this dump never carries it.
  it('spares line A when clearing the board', () => {
    expect(buildTimetableSQL([board(1)], 'now')).toContain(
      'DELETE FROM schedules WHERE stationId = \'KCI-MRI\' AND dayMask = 7 AND lineCode <> \'A\';'
    )
  })

  it('only inserts for a station we carry', () => {
    expect(buildTimetableSQL([board(1)], 'now')).toContain('WHERE EXISTS (SELECT 1 FROM stations WHERE id = \'KCI-MRI\')')
  })

  it('splits a busy board into 100-row statements', () => {
    expect(buildTimetableSQL([board(250)], 'now').match(/INSERT INTO schedules/g)).toHaveLength(3)
  })

  it('escapes quotes in feed text', () => {
    const rows = toTimetableRows('MRI', ok(departure('1001', 'JAKARTA KOTA\'S')))!
    expect(buildTimetableSQL([{ stationCode: 'MRI', rows }], 'now')).toContain('\'Jakarta Kota\'\'s\'')
  })
})
