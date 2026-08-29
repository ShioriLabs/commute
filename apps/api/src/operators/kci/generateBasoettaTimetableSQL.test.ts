import { describe, expect, it } from 'vitest'
import {
  buildRequestBody,
  buildTimetableSQL,
  normalizeTime,
  parseFlightStream,
  resolveTripDate,
  type ScheduleRow
} from 'operators/kci/generateBasoettaTimetableSQL'

// A verbatim trip object from the live flight stream, nested fareLists and all
// — the nesting is the point, since parsing is brace-matched rather than JSON.
const TRIP_801 = '{"key":"801A802A","noka":"801A802A","tripdate":"2026-08-31","tripid":10139009,'
  + '"orderorg":1,"orderdes":6,"arriveadd":0,"departadd":0,"stasiuncodeorg":"MRI",'
  + '"stasiunnameorg":"MANGGARAI","stasiuncodedes":"BST","stasiunnamedes":"BANDARA SOEKARNO HATTA",'
  + '"arrival":"0546","departure":"0500","wagonclassid":1,"wagonclasscode":"EKS","avail":268,'
  + '"availnoseat":268,"tripstartdate":"2026-08-31","tripenddate":"2026-08-31",'
  + '"sellstartdate":"2026-07-30","scheduleid":11395201,"traintypecode":"K",'
  + '"trainname":"COMMUTER LINE BASOETTA","newdeparture":"2026-08-31 00:00:00",'
  + '"fareLists":[{"id":983619327,"subclassid":103,"subclasscode":"A","maxsell":272,'
  + '"maxclass":272,"jmlbooked":4,"jmlbookedrute":4,"avail":268,"availnoseat":268,'
  + '"fareid":1018790867,"basicfare":85000,"totamount":85000}]}'

const TRIP_805 = '{"key":"805A806A","noka":"805A806A","arrival":"0616","departure":"0530",'
  + '"fareLists":[{"totamount":85000}]}'

// The real response wraps trips in RSC chunk noise on both sides.
const STREAM = `2:I[339756,["/_next/static/chunks/0yt64124o3m2u.js"],"LoadingBoundaryProvider"]\n`
  + `a:{"schedule":[${TRIP_801},${TRIP_805}]}\n`

describe('parseFlightStream', () => {
  it('extracts trips from a flight stream, including the nested fare', () => {
    const trips = parseFlightStream(STREAM)
    expect(trips).toEqual([
      { noka: '801A802A', departure: '0500', arrival: '0546', fare: 85000 },
      { noka: '805A806A', departure: '0530', arrival: '0616', fare: 85000 }
    ])
  })

  it('dedupes objects that repeat across the stream', () => {
    const trips = parseFlightStream(`${STREAM}${TRIP_801}`)
    expect(trips.map(trip => trip.noka)).toEqual(['801A802A', '805A806A'])
  })

  it('skips a truncated trailing object without losing the earlier trips', () => {
    const trips = parseFlightStream(`${STREAM}{"noka":"809A810A","departure":"06`)
    expect(trips.map(trip => trip.noka)).toEqual(['801A802A', '805A806A'])
  })

  it('skips objects missing the times rather than emitting partial trips', () => {
    expect(parseFlightStream('{"noka":"999A","avail":10}')).toEqual([])
  })

  it('returns nothing for a page shell with no trips (the stale-hash signature)', () => {
    expect(parseFlightStream('1:I[123,["chunk.js"],"ConfigProvider"]')).toEqual([])
  })

  it('records a missing fare as null rather than dropping the trip', () => {
    expect(parseFlightStream('{"noka":"1A","departure":"0500","arrival":"0546"}')).toEqual([
      { noka: '1A', departure: '0500', arrival: '0546', fare: null }
    ])
  })
})

describe('normalizeTime', () => {
  it('expands HHMM to HH:MM:SS', () => {
    expect(normalizeTime('0500')).toBe('05:00:00')
    expect(normalizeTime('2246')).toBe('22:46:00')
  })

  it('rejects malformed times', () => {
    expect(normalizeTime('2400')).toBeNull()
    expect(normalizeTime('0560')).toBeNull()
    expect(normalizeTime('5:00')).toBeNull()
    expect(normalizeTime('500')).toBeNull()
    expect(normalizeTime('')).toBeNull()
  })
})

describe('buildRequestBody', () => {
  /*
   * The silent-empty trap: the API matches on the name fields as well as the
   * code, and a mismatch returns zero trips rather than an error — which reads
   * exactly like the airport not being served.
   */
  it('fills the name fields alongside the codes', () => {
    const body = JSON.parse(buildRequestBody('MRI', 'BST', '2026-08-31')) as [Record<string, unknown>, unknown]
    expect(body[0]).toMatchObject({
      staorigincode: 'MRI',
      stadestinationcode: 'BST',
      staoriginname: 'manggarai, jabodetabek',
      staoriginstation: 'manggarai',
      stadestinationname: 'bandara soekarno hatta, jabodetabek',
      stadestinationstation: 'bandara soekarno hatta',
      tripdate: '2026-08-31',
      staregioncode: 'JABO'
    })
  })

  it('uses the booking app spellings, not our formattedName', () => {
    const body = JSON.parse(buildRequestBody('SUDB', 'BPR', '2026-08-31')) as [Record<string, unknown>, unknown]
    expect(body[0]!.staoriginstation).toBe('bni city')
    expect(body[0]!.stadestinationstation).toBe('batuceper')
  })

  it('sends the empty arrival/depart filter the form posts', () => {
    const body = JSON.parse(buildRequestBody('MRI', 'BST', '2026-08-31')) as [unknown, unknown]
    expect(body[1]).toEqual({ arrival: [], depart: [] })
  })

  it('throws on a station it has no query name for', () => {
    expect(() => buildRequestBody('MRI', 'XXX', '2026-08-31')).toThrow(/XXX/)
  })
})

describe('buildTimetableSQL', () => {
  const rows: ScheduleRow[] = [
    { station: 'DU', terminus: 'BST', trip: { noka: '801A802A', departure: '0518', arrival: '0546', fare: 70000 } },
    { station: 'DU', terminus: 'BST', trip: { noka: '805A806A', departure: '0548', arrival: '0616', fare: 70000 } }
  ]

  it('emits the KCI row conventions', () => {
    const sql = buildTimetableSQL(rows, '2026-08-31')
    expect(sql).toContain(
      '(\'KCI-DU-801A802A\', \'KCI-DU\', \'801A802A\', \'05:18:00\', \'05:46:00\','
      + ' \'Bandara Soekarno-Hatta\', \'A\', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
    )
  })

  /*
   * These stations also carry Cikarang/Tangerang/Rangkasbitung rows from the
   * ordinary KCI sync; a station-wide delete would take those with it.
   */
  it('scopes the delete to line A so other lines survive', () => {
    const sql = buildTimetableSQL(rows, '2026-08-31')
    expect(sql).toContain('DELETE FROM schedules WHERE stationId = \'KCI-DU\' AND lineCode = \'A\';')
    expect(sql).not.toMatch(/DELETE FROM schedules WHERE stationId = 'KCI-DU';/)
  })

  it('flags the station synced', () => {
    expect(buildTimetableSQL(rows, '2026-08-31'))
      .toContain('UPDATE stations SET timetableSynced = 1 WHERE id = \'KCI-DU\';')
  })

  it('labels southbound trips with the Manggarai terminus', () => {
    const sql = buildTimetableSQL(
      [{ station: 'BPR', terminus: 'MRI', trip: { noka: '803A804A', departure: '0609', arrival: '0643', fare: 35000 } }],
      '2026-08-31'
    )
    expect(sql).toContain('\'Manggarai\', \'A\'')
  })

  it('orders departures chronologically within a station', () => {
    const shuffled = [rows[1]!, rows[0]!]
    const sql = buildTimetableSQL(shuffled, '2026-08-31')
    expect(sql.indexOf('05:18:00')).toBeLessThan(sql.indexOf('05:48:00'))
  })

  it('groups each station into its own delete/insert block', () => {
    const sql = buildTimetableSQL(
      [...rows, { station: 'RW', terminus: 'BST', trip: { noka: '801A802A', departure: '0528', arrival: '0546', fare: 40000 } }],
      '2026-08-31'
    )
    expect(sql.match(/DELETE FROM schedules/g)).toHaveLength(2)
    expect(sql).toContain('\'KCI-RW-801A802A\', \'KCI-RW\'')
  })

  it('records the capture date in the header', () => {
    expect(buildTimetableSQL(rows, '2026-08-31')).toContain('trip date 2026-08-31')
  })
})

describe('resolveTripDate', () => {
  it('defaults to two days out', () => {
    expect(resolveTripDate([], new Date('2026-08-29T00:00:00Z'))).toBe('2026-08-31')
  })

  it('accepts an explicit date', () => {
    expect(resolveTripDate(['--date=2026-09-05'], new Date('2026-08-29T00:00:00Z'))).toBe('2026-09-05')
  })

  it('rejects a malformed date', () => {
    expect(resolveTripDate(['--date=31-08-2026'], new Date('2026-08-29T00:00:00Z'))).toHaveProperty('error')
  })

  it('rejects a past date, which the booking app cannot sell', () => {
    expect(resolveTripDate(['--date=2026-08-01'], new Date('2026-08-29T00:00:00Z'))).toHaveProperty('error')
  })

  it('allows today', () => {
    expect(resolveTripDate(['--date=2026-08-29'], new Date('2026-08-29T00:00:00Z'))).toBe('2026-08-29')
  })
})
