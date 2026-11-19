import { describe, expect, it } from 'vitest'
import { buildSQL, convertGapeka, formatTime, stopsOf, type GapekaRow, type GapekaTrip } from './generateGapekaTimetableSQL'

// Verbatim from KA 809 (Commuter Line BST) Bogor - Duri, GAPEKA 2026 p.854.
const KA_809: GapekaRow[] = [
  [1, 'BOO', '-', '04:52:00'], [2, 'CLT', 'Ls', '05:00:00'], [3, 'BJD', 'Ls', '05:05:00'],
  [4, 'CTA', 'Ls', '05:11:00'], [5, 'DP', 'Ls', '05:17:00'], [6, 'DPB', '05:20:00', '05:22:00'],
  [7, 'POC', 'Ls', '-'], [8, 'UI', 'Ls', '05:28:00'], [9, 'UP', 'Ls', '-'], [10, 'LNA', 'Ls', '-'],
  [11, 'TNT', 'Ls', '-'], [12, 'PSM', 'Ls', '05:41:00'], [13, 'PSMB', 'Ls', '-'], [14, 'DRN', 'Ls', '-'],
  [15, 'CW', 'Ls', '-'], [16, 'TEB', 'Ls', '-'], [17, 'MRI', '05:54:00', '06:00:00'], [18, 'SUD', 'Ls', '-'],
  [19, 'SUDB', 'Berh', 'Sb'], [20, 'KAT', 'Ls', '-'], [21, 'THB', 'Ls', '06:10:00'], [22, 'DU', '06:15:00', '-']
]
const KA_810: GapekaRow[] = [
  [1, 'DU', '-', '06:18:00'], [2, 'GRG', 'Ls', '-'], [3, 'PSG', 'Ls', '-'], [4, 'TKO', 'Ls', '-'],
  [5, 'BOI', 'Ls', '-'], [6, 'RW', '06:28:00', '06:29:00'], [7, 'KDS', 'Ls', '-'], [8, 'PI', 'Ls', '-'],
  [9, 'BPR', '06:35:00', '06:36:00'], [10, 'BST', '06:46:00', '-']
]
const trip = (ka: string, from: string, to: string, rows: GapekaRow[], label = 'Commuter Line BST'): GapekaTrip => ({ ka, label, from, to, rows })

describe('stopsOf', () => {
  it('keeps only the stops: origin, terminus, times and Berh, never Ls', () => {
    expect(stopsOf(trip('809', 'BOO', 'DU', KA_809)).map(s => s.station)).toEqual(['BOO', 'DPB', 'MRI', 'SUDB', 'DU'])
  })

  it('places a Berh stop with no printed time between its neighbours', () => {
    const sudb = stopsOf(trip('809', 'BOO', 'DU', KA_809)).find(s => s.station === 'SUDB')!
    // MRI leaves 06:00, Tanah Abang passes 06:10, SUDB is 2 of 4 rows along.
    expect(formatTime(sudb.departure)).toBe('06:05:00')
  })

  it('pins BNI City to the measured offsets on airport runs', () => {
    const north = convertGapeka({ trips: [trip('809', 'BOO', 'DU', KA_809)] }).boards.get('SUDB')![0]!
    expect(north.estimatedDeparture).toBe('06:07:00')
    const south: GapekaRow[] = [[1, 'DU', '-', '06:28:00'], [2, 'THB', 'Ls', '06:33:00'], [3, 'KAT', 'Ls', '-'], [4, 'SUDB', 'Berh', 'Sb'], [5, 'SUD', 'Ls', '-'], [6, 'MRI', '06:43:00', '-']]
    expect(convertGapeka({ trips: [trip('804', 'DU', 'MRI', south)] }).boards.get('SUDB')![0]!.estimatedDeparture).toBe('06:37:00')
  })

  it('unrolls midnight', () => {
    const rows: GapekaRow[] = [[1, 'MRI', '-', '23:55:00'], [2, 'JNG', '00:05:00', '-']]
    const stops = stopsOf(trip('1', 'MRI', 'JNG', rows))
    expect(stops[1]!.arrival - stops[0]!.departure).toBe(600)
    expect(formatTime(stops[1]!.arrival)).toBe('00:05:00')
  })
})

describe('convertGapeka', () => {
  const { boards } = convertGapeka({ trips: [trip('809', 'BOO', 'DU', KA_809), trip('810', 'DU', 'BST', KA_810)] })

  it('joins the two airport legs into one Basoetta-style trip number', () => {
    expect(boards.get('MRI')![0]).toMatchObject({
      id: 'KCI-MRI-809A810A', tripNumber: '809A810A', estimatedDeparture: '06:00:00',
      estimatedArrival: '06:46:00', boundFor: 'Bandara Soekarno-Hatta', lineCode: 'A'
    })
  })

  it('boards Bogor and Depok Baru on line A, and the junction leaves on the second leg', () => {
    expect(boards.get('BOO')![0]).toMatchObject({ estimatedDeparture: '04:52:00', lineCode: 'A' })
    expect(boards.get('DPB')![0]!.estimatedDeparture).toBe('05:22:00')
    expect(boards.get('DU')![0]!.estimatedDeparture).toBe('06:18:00')
  })

  it('has no departure from the terminus and none from stations it runs through', () => {
    expect(boards.has('BST')).toBe(false)
    expect(boards.has('CLT')).toBe(false)
  })

  it('refuses a terminus it has no name for', () => {
    expect(() => convertGapeka({ trips: [trip('1', 'MRI', 'ZZZ', [[1, 'MRI', '-', '05:00:00'], [2, 'ZZZ', '05:10:00', '-']], 'Commuter Line Bogor')] })).toThrow(/ZZZ/)
  })

  it('maps the feed code of Grogol back to ours', () => {
    const rows: GapekaRow[] = [[1, 'GRG', '-', '05:00:00'], [2, 'DU', '05:03:00', '-']]
    expect(convertGapeka({ trips: [trip('2', 'GRG', 'DU', rows, 'Commuter Line Tangerang')] }).boards.has('GGL')).toBe(true)
  })

  it('writes whole-board replacements guarded on the station existing', () => {
    const sql = buildSQL(boards, 'test')
    expect(sql).toContain('DELETE FROM schedules WHERE stationId = \'KCI-BOO\' AND dayMask = 7;')
    expect(sql).toContain('WHERE EXISTS (SELECT 1 FROM stations WHERE id = \'KCI-BOO\')')
  })
})
