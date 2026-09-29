import { describe, expect, it } from 'vitest'
import { buildTimetableSQL, checkRunTimes, expectedHeader, parseTimetable } from 'operators/lrtj/generateTimetableSQL'

const HEADER = expectedHeader('MGI').join(',')

describe('parseTimetable', () => {
  it('drops the printed terminal arrival from a full working', () => {
    const { trips, errors } = parseTimetable('MGI', `${HEADER}\n1002,1,5:30,5:35,5:37,5:39,5:41,5:43,5:46,Ls,Ls,Ls,5:57`)
    expect(errors).toEqual([])
    expect(trips[0]!.terminus).toBe('MGI')
    expect(trips[0]!.departures.map(d => d.station)).toEqual(['PGD', 'BVU', 'BVS', 'PUM', 'EQS', 'VEL', 'RWM'])
    expect(trips[0]!.departures[0]!.time).toBe('05:30:00')
  })

  it('reads the first blank after the last time as a short working\'s terminus', () => {
    // The evening shuttle stops at Equestrian on the sheet and turns at Velodrome.
    const { trips } = parseTimetable('MGI', `${HEADER}\n1112,1,19:15,19:20,19:22,19:24,19:26,-,-,-,-,-,-`)
    expect(trips[0]!.terminus).toBe('VEL')
    expect(trips[0]!.departures.map(d => d.station)).toEqual(['PGD', 'BVU', 'BVS', 'PUM', 'EQS'])
  })

  it('starts a working at its first time', () => {
    const header = expectedHeader('PGD').join(',')
    const { trips } = parseTimetable('PGD', `${header}\n1113,1,-,-,-,-,-,19:35,19:37,19:39,19:41,19:43,19:48`)
    expect(trips[0]!.terminus).toBe('PGD')
    expect(trips[0]!.departures[0]).toEqual({ station: 'VEL', time: '19:35:00' })
  })

  it('refuses Ls at a station trains call at, and a time at a pass-through one', () => {
    expect(parseTimetable('MGI', `${HEADER}\n1002,1,5:30,5:35,5:37,5:39,5:41,5:43,Ls,Ls,Ls,Ls,5:57`).errors).toHaveLength(1)
    expect(parseTimetable('MGI', `${HEADER}\n1002,1,5:30,5:35,5:37,5:39,5:41,5:43,5:46,5:50,Ls,Ls,5:57`).errors).toHaveLength(1)
  })

  it('refuses the wrong KA parity, a gap inside a working and a clock running backwards', () => {
    expect(parseTimetable('MGI', `${HEADER}\n1003,1,5:30,5:35,5:37,5:39,5:41,5:43,5:46,Ls,Ls,Ls,5:57`).errors).toHaveLength(1)
    expect(parseTimetable('MGI', `${HEADER}\n1002,1,5:30,5:35,-,5:39,5:41,5:43,5:46,Ls,Ls,Ls,5:57`).errors).toHaveLength(1)
    expect(parseTimetable('MGI', `${HEADER}\n1002,1,5:30,5:35,5:37,5:36,5:41,5:43,5:46,Ls,Ls,Ls,5:57`).errors).toHaveLength(1)
  })

  it('refuses a header out of travel order', () => {
    expect(parseTimetable('PGD', `${HEADER}\n`).errors[0]).toMatch(/header/)
  })
})

describe('checkRunTimes', () => {
  it('flags a cell that breaks its working\'s modal run time', () => {
    const csv = [
      HEADER,
      '1002,1,5:30,5:35,5:37,5:39,5:41,5:43,5:46,Ls,Ls,Ls,5:57',
      '1004,2,5:45,5:50,5:52,5:54,5:56,5:58,6:01,Ls,Ls,Ls,6:12',
      '1006,3,6:00,6:05,6:08,6:09,6:11,6:13,6:16,Ls,Ls,Ls,6:27'
    ].join('\n')
    expect(checkRunTimes(parseTimetable('MGI', csv).trips)).toEqual([
      'KA 1006 BVU->BVS 3 min (mode 2 on PGD..MGI)',
      'KA 1006 BVS->PUM 1 min (mode 2 on PGD..MGI)'
    ])
  })
})

describe('buildTimetableSQL', () => {
  it('chains every stop of a train under one trip number', () => {
    const { trips } = parseTimetable('MGI', `${HEADER}\n1002,1,5:30,5:35,5:37,5:39,5:41,5:43,5:46,Ls,Ls,Ls,5:57`)
    const sql = buildTimetableSQL(trips)
    expect(sql).toContain('DELETE FROM schedules WHERE stationId LIKE \'LRTJ-%\';')
    expect(sql).toContain('(\'LRTJ-PGD-1002\', \'LRTJ-PGD\', \'LRTJ-1002\', \'05:30:00\', \'05:30:00\', \'Manggarai\', \'S\', 7,')
    expect(sql.match(/'LRTJ-1002'/g)).toHaveLength(7)
    expect(sql).not.toContain('LRTJ-MGI-1002')
  })
})
