import { describe, expect, it } from 'vitest'
import type { LngLat } from '../../utils/polyline'
import { alignToTopology, despike, passesBy } from './busMapTopology'

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

  it('takes a pair through its waypoints, where the search alone would take another street', () => {
    // A to C two ways: line 2 straight up the street, line 3 round by a street 300 m east.
    // The bus can only go the east way (6 by Jl. Gembira), which a waypoint says.
    const east = run([0, 0], [300, 0], [300, 2000], [0, 2000])
    const lines = [{ code: '1', pieces: [run([0, 0], [0, 100])] }, { code: '2', pieces: [street] }, { code: '3', pieces: [east] }]
    const plain = alignToTopology(lines, haltes, [{ code: '1', runs: [['A', 'C']] }])
    const routed = alignToTopology(lines, haltes, [{ code: '1', runs: [['A', 'C']], via: { 'A->C': [at(300, 1000)] } }])
    expect(passesBy(plain.pieces.get('1')!, ...at(300, 1000))).toBe(false)
    expect(passesBy(routed.pieces.get('1')!, ...at(300, 1000))).toBe(true)
    expect(routed.straight).toEqual([])
  })

  it('keeps a koridor\'s own loop to turn, split across its pieces, through every pass', () => {
    // 6 from Flyover Kuningan (F): on up, round a block (Latuharhari, Cokroaminoto), back down
    // the other carriageway past F, and off along a branch piece to Galunggung (G).
    const loopHaltes = { A: halte('A', 0, 0), F: halte('F', 0, 1000), G: halte('G', -600, 800) }
    const trunk = run([0, 0], [0, 1000], [0, 1200], [300, 1200], [300, 1500], [40, 1500], [40, 0])
    const branch = run([40, 800], [-600, 800])
    const topology = [{ code: '6', runs: [['A', 'F', 'G']] }]
    const once = alignToTopology([{ code: '6', pieces: [trunk, branch] }], loopHaltes, topology)
    const six = once.pieces.get('6')!
    expect(passesBy(six, ...at(300, 1350))).toBe(true)
    // Again, from what it drew: the run passes F twice, and must not skip from the second.
    const twice = alignToTopology([{ code: '6', pieces: six }], loopHaltes, topology)
    expect(passesBy(twice.pieces.get('6')!, ...at(300, 1350))).toBe(true)
  })

  it('still leaves out a long way round that calls at a halte the posters dropped', () => {
    // As above, but the block it goes round has a halte (P) the koridor no longer serves.
    const loopHaltes = { A: halte('A', 0, 0), F: halte('F', 0, 1000), G: halte('G', -600, 800), P: halte('Petojo', 300, 1350) }
    const trunk = run([0, 0], [0, 1000], [0, 1200], [300, 1200], [300, 1500], [40, 1500], [40, 0])
    const branch = run([40, 800], [-600, 800])
    const aligned = alignToTopology(
      [{ code: '6', pieces: [trunk, branch], stops: ['A', 'F', 'P', 'G'] }, { code: '9', pieces: [run([40, 1000], [40, 800], [-600, 800])] }],
      loopHaltes,
      [{ code: '6', runs: [['A', 'F', 'G']] }]
    )
    expect(passesBy(aligned.pieces.get('6')!, ...at(300, 1350))).toBe(false)
  })

  it('runs a koridor\'s own piece backwards for a trip the dedupe folded into it, turning only where its pieces join', () => {
    // 6 from Galunggung (G) to Setiabudi (S): the feed keeps only the other way, Rasuna Said
    // (x 0) up to Gembira at y 1000, west along it to G. Galunggung street also crosses Rasuna
    // Said at y 1200, where no bus may turn: the way is by Gembira.
    const gHaltes = { G: halte('G', -800, 1000), S: halte('S', 0, 0) }
    const rasuna = run([0, 0], [0, 1600])
    const gembira = run([0, 1000], [-800, 1000])
    const galunggung = run([-800, 1000], [-800, 1200], [400, 1200])
    const aligned = alignToTopology(
      [{ code: '6', pieces: [rasuna, gembira, galunggung] }],
      gHaltes,
      [{ code: '6', runs: [['G', 'S']] }]
    )
    const six = aligned.pieces.get('6')!
    expect(passesBy(six, ...at(-400, 1000))).toBe(true)
    expect(passesBy(six, ...at(0, 1200))).toBe(false)
  })

  it('goes round a hairpin at a halte, even when the next leg starts on another piece', () => {
    // Koridor 2 at Gambir 2 (H): up one road, round at the halte, back down the road 40 m
    // beside it, where the feed's piece ends; another piece carries on east to E.
    const hHaltes = { A: halte('A', 0, 0), H: halte('H', 30, 1100), E: halte('E', 600, 1000) }
    const into = run([0, 0], [0, 1200], [40, 1200], [40, 1100])
    const on = run([40, 1100], [40, 1000], [600, 1000])
    const aligned = alignToTopology([{ code: '2', pieces: [into, on] }], hHaltes, [{ code: '2', runs: [['A', 'H', 'E']] }])
    expect(passesBy(aligned.pieces.get('2')!, ...at(20, 1200))).toBe(true)
  })

  it('draws straight only when no street at all runs between two haltes', () => {
    const aligned = alignToTopology([{ code: '1', pieces: [run([0, 0], [0, 300])] }], haltes, [{ code: '1', runs: [['A', 'C']] }])
    expect(aligned.straight).toEqual(['1 A->C'])
  })
})

describe('despike', () => {
  it('drops a short out-and-back, keeps a real corner', () => {
    const spiked: [number, number][] = [[0, 0], [0, 100], [0, 130], [0, 90], [0, 200]]
    expect(despike(spiked)).toEqual([[0, 0], [0, 100], [0, 200]])
    const corner: [number, number][] = [[0, 0], [0, 100], [100, 100]]
    expect(despike(corner)).toEqual(corner)
  })
})
