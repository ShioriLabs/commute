import { describe, expect, it } from 'vitest'
import { parseTimetable } from 'operators/lrtj/generateTimetableSQL'
import { tripsToCsv, type ApiTrip } from 'operators/lrtj/fetchTimetable'

const stop = (id: string, start: string | null, arrival: string | null) => ({ id, start_at: start, arrival_at: arrival })

// Kelapa Gading -> Manggarai as the API returns it: Velodrome dwells a minute
// (arrival 05:43, departure 05:44) and the end stations have one time each.
const southbound: ApiTrip = {
  time_at: '05:30',
  stop_detail: [
    stop('O6PpoaxXR8', '05:30', null), stop('63zpjAqWLe', '05:35', '05:34'), stop('Kre96Z9B5D', '05:37', '05:37'),
    stop('oJQxvy93rY', '05:39', '05:39'), stop('KAVp3P97ry', '05:41', '05:41'), stop('RnAx41q5G1', '05:44', '05:43'),
    stop('LPDxKkxBor', '05:47', '05:46'), stop('lZQpDA9kyK', '05:49', '05:49'), stop('zXl98Mx2Mk', '05:51', '05:51'),
    stop('Jj59kaqwnO', '05:54', '05:54'), stop('DBN9nAp5nJ', null, '05:57')
  ]
}

describe('tripsToCsv', () => {
  it('prints departures, the terminus arrival, and Ls for the stations that are not open', () => {
    const csv = tripsToCsv('MGI', [southbound])
    expect(csv.split('\n')[1]).toBe('2000,1,5:30,5:35,5:37,5:39,5:41,5:44,5:47,5:49,Ls,Ls,5:57')
  })

  it('numbers trips even Manggarai-bound and odd Kelapa Gading-bound, clear of the poster\'s 1xxx', () => {
    const rows = tripsToCsv('MGI', [southbound, southbound]).split('\n')
    expect(rows[2]!.split(',')[0]).toBe('2002')
    const north: ApiTrip = { time_at: '05:32', stop_detail: [...southbound.stop_detail].reverse().map(s => ({ ...s, start_at: s.start_at ?? s.arrival_at, arrival_at: null })) }
    expect(tripsToCsv('PGD', [north]).split('\n')[1]!.split(',')[0]).toBe('2001')
  })

  it('round-trips through the generator\'s validation, Pramuka calling', () => {
    const { trips, errors } = parseTimetable('MGI', tripsToCsv('MGI', [southbound]))
    expect(errors).toEqual([])
    expect(trips[0]!.departures.map(d => d.station)).toEqual(['PGD', 'BVU', 'BVS', 'PUM', 'EQS', 'VEL', 'RWM', 'PKA'])
  })

  it('refuses a station id it does not know', () => {
    expect(() => tripsToCsv('MGI', [{ time_at: '05:30', stop_detail: [stop('nope', '05:30', null)] }])).toThrow(/unknown station id/)
  })
})
