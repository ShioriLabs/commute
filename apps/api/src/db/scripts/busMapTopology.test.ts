import { describe, expect, it } from 'vitest'
import type { LngLat } from '../../utils/polyline'
import { alignToTopology, passesBy } from './busMapTopology'

/* Synthetic streets near Monas: 0.001 degree is ~110 m either way at -6.2. */
const LAT = -6.18
const LNG = 106.82
const at = (eastM: number, northM: number): LngLat => [LNG + eastM / 110_670, LAT + northM / 110_574]
const run = (...corners: [number, number][]): LngLat[] => {
  const pts: LngLat[] = []
  for (let i = 1; i < corners.length; i++) {
    const [ax, ay] = corners[i - 1]!
    const [bx, by] = corners[i]!
    const steps = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 50))
    for (let k = i === 1 ? 0 : 1; k <= steps; k++) pts.push(at(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps))
  }
  return pts
}
const halte = (name: string, eastM: number, northM: number): [string, number, number] => [name, ...at(eastM, northM)]

/** How far west of the main street (east 0) a drawing strays. */
const westmost = (pieces: LngLat[][]): number => Math.min(...pieces.flat().map(([lng]) => (lng - LNG) * 110_670))

describe('alignToTopology', () => {
  // Haltes A, B, C up one street; the feed sends koridor 1 round a loop 800 m west
  // between A and C (a reroute), while koridor 2 still runs the street.
  const haltes = {
    A: halte('A', 0, 0),
    B: halte('B', 0, 1000),
    C: halte('C', 0, 2000),
    P: halte('Petojo', -800, 1000)
  }
  const rerouted = run([0, 0], [0, 300], [-800, 300], [-800, 1700], [0, 1700], [0, 2000])
  const street = run([0, 0], [0, 2100])
  const two = run([0, 0], [0, 1200])

  it('redraws a rerouted koridor along its topology, borrowing a street another line runs', () => {
    const aligned = alignToTopology(
      [{ code: '1', pieces: [rerouted] }, { code: '2', pieces: [street] }],
      haltes,
      [{ code: '1', runs: [['A', 'B', 'C']] }]
    )
    const one = aligned.pieces.get('1')!
    expect(westmost(one)).toBeGreaterThan(-60)
    expect(passesBy(one, haltes.B[1], haltes.B[2])).toBe(true)
    expect(passesBy(one, haltes.P[1], haltes.P[2])).toBe(false)
    expect(aligned.stops.get('1')).toEqual(['A', 'B', 'C'])
  })

  it('keeps a line with no topology as it is', () => {
    const aligned = alignToTopology([{ code: '1P', pieces: [rerouted] }], haltes, [])
    expect(aligned.pieces.get('1P')).toEqual([rerouted])
    expect(aligned.stops.has('1P')).toBe(false)
  })

  it('finds a way across lines where no one shape runs between two haltes', () => {
    // B to C: no line runs it whole, but 2 runs to 1200 m and 3 from 1150 m on.
    const three = run([0, 1150], [0, 2100])
    const aligned = alignToTopology(
      [{ code: '1', pieces: [run([0, 0], [0, 500])] }, { code: '2', pieces: [two] }, { code: '3', pieces: [three] }],
      haltes,
      [{ code: '1', runs: [['B', 'C']] }]
    )
    expect(aligned.straight).toEqual([])
    expect(passesBy(aligned.pieces.get('1')!, ...at(0, 1500))).toBe(true)
  })

  it('draws straight only when no street at all runs between two haltes', () => {
    const aligned = alignToTopology([{ code: '1', pieces: [run([0, 0], [0, 300])] }], haltes, [{ code: '1', runs: [['A', 'C']] }])
    expect(aligned.straight).toEqual(['1 A->C'])
  })
})
