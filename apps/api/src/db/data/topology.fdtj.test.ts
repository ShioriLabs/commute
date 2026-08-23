import { describe, expect, it } from 'vitest'
import { TOPOLOGY } from './topology'
import { TJ_STATION_NUMBERS } from './topology.tj.numbers'

/*
 * Data integrity for the FDTJ "Peta Integrasi Jakarta" 2026-08 import: the
 * official TransJakarta halte numbers, and the unbuilt-stop rule that keeps
 * announced-but-unopened stations out of the routing graph.
 */

const tjLines = TOPOLOGY.filter(l => l.operator === 'TJ')
const allStops = (l: (typeof TOPOLOGY)[number]) => [
  ...l.path,
  ...(l.pathReverse ?? []),
  ...(l.branches ?? []).flatMap(b => b.path)
]

describe('TJ station numbers', () => {
  it('stamps the poster numbers onto BRT corridors', () => {
    const numbered = tjLines.flatMap(allStops).filter(s => s.pos !== '')
    expect(numbered.length).toBeGreaterThan(200)
  })

  it('uses corridor-sequence format matching the stop\'s own line', () => {
    for (const line of tjLines) {
      for (const stop of allStops(line)) {
        if (stop.pos === '') continue
        expect(stop.pos, `${line.lineCode}:${stop.station}`).toMatch(/^\d{1,2}-\d{1,3}$/)
        // '13-4' may only appear on corridor 13 — the number encodes the line.
        expect(stop.pos.split('-')[0]).toBe(line.lineCode)
      }
    }
  })

  it('never gives one corridor the same number twice', () => {
    for (const line of tjLines) {
      // path/pathReverse legitimately repeat a stop, so compare per station.
      const byStation = new Map<string, string>()
      for (const s of allStops(line)) {
        if (s.pos) byStation.set(s.station, s.pos)
      }
      const used = [...byStation.values()]
      expect(new Set(used).size, `duplicate number on corridor ${line.lineCode}`)
        .toBe(used.length)
    }
  })

  it('numbers the trunk corridors the poster prints', () => {
    // The map numbers haltes per trunk corridor (1..14); the service variants
    // that share those haltes (3F, 9C, L13E …) carry no numbers of their own.
    const numbered = tjLines
      .filter(l => allStops(l).some(s => s.pos !== ''))
      .map(l => l.lineCode)
      .sort((a, b) => Number(a) - Number(b))
    expect(numbered).toEqual(
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14']
    )
  })

  it('matches the haltes hand-verified in docs/fdtj-map-points.md', () => {
    // These are the worked examples in that doc; getting them wrong means the
    // marker/name matching has regressed.
    expect(TJ_STATION_NUMBERS['1:H00014P']).toBe('1-1') // Blok M
    expect(TJ_STATION_NUMBERS['1:H00266P']).toBe('1-2') // Kejaksaan Agung
    expect(TJ_STATION_NUMBERS['9:H00164P']).toBe('9-25') // Penjaringan
    expect(TJ_STATION_NUMBERS['12:H00007P']).toBe('12-24') // Bandengan
    expect(TJ_STATION_NUMBERS['13:H00041P']).toBe('13-4') // CSW
  })
})

describe('unbuilt stops', () => {
  it('carries LRT Jakarta Phase 1B as open track', () => {
    // Phase 1B (S07-S11) entered revenue service 2026-08-26. The stops stay
    // asserted here because the graph now depends on them: dropping one would
    // silently sever Velodrome from Manggarai rather than fail loudly.
    const s = TOPOLOGY.find(l => l.operator === 'LRTJ' && l.lineCode === 'S')!
    expect(s.path.map(p => p.pos)).toEqual([
      'S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11'
    ])
    expect(s.path.filter(p => p.unbuilt)).toEqual([])
  })

  it('never places an unbuilt stop between two open ones', () => {
    // generateEdgesSQL drops any adjacency touching an unbuilt stop, so an
    // unbuilt stop in the MIDDLE of a line would sever it. They may only ever
    // extend a line's tail.
    for (const line of TOPOLOGY) {
      const flags = line.path.map(s => s.unbuilt === true)
      const firstUnbuilt = flags.indexOf(true)
      if (firstUnbuilt === -1) continue
      expect(flags.slice(firstUnbuilt).every(Boolean),
        `${line.operator} ${line.lineCode} has an open stop after an unbuilt one`).toBe(true)
    }
  })
})
