import { describe, expect, it } from 'vitest'
import busMapJson from '../data/bus-map.json'
import { decodePolyline, linesByHalte, type BusMap } from './bus-map'

// JSON imports type tuples as arrays, so the cast goes through unknown.
const busMap = busMapJson as unknown as BusMap

describe('decodePolyline', () => {
  it('decodes the reference example from the format docs', () => {
    // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252]
    ])
  })

  it('decodes an empty string to no points', () => {
    expect(decodePolyline('')).toEqual([])
  })
})

describe('linesByHalte', () => {
  it('lists every line calling at a halte, in line order', () => {
    const map: BusMap = {
      attribution: '',
      edges: [],
      stopMarks: [],
      haltes: {},
      rail: [],
      lines: [
        { code: '1', name: '', kind: 'BRT', color: '#000000', shapes: [], drawn: [], stops: ['H1', 'H2'] },
        { code: '6M', name: '', kind: 'AUI', color: '#000000', shapes: [], drawn: [], stops: ['H2', 'B9'] }
      ]
    }
    const index = linesByHalte(map)
    expect(index.get('H1')).toEqual(['1'])
    expect(index.get('H2')).toEqual(['1', '6M'])
    expect(index.get('B9')).toEqual(['6M'])
    expect(index.get('nope')).toBeUndefined()
  })
})

/*
 * The committed data, checked for the invariants the map will lean on. A
 * failure here means the generator or the feed changed shape, not that the map
 * is wrong, so fix generateBusMap.ts and regenerate.
 */
describe('bus-map.json', () => {
  it('has the integrasi lines alongside the BRT', () => {
    expect(busMap.lines.some(l => l.kind === 'BRT')).toBe(true)
    expect(busMap.lines.find(l => l.code === '6M')?.kind).toBe('AUI')
  })

  it('gives every halte a line calls at a name and a position', () => {
    for (const line of busMap.lines) {
      for (const stop of line.stops) {
        expect(busMap.haltes[stop], `${line.code} calls at ${stop}`).toBeDefined()
      }
    }
  })

  // West to Merak: the KCI rail dots include the Rangkasbitung-Merak line.
  it('keeps every coordinate inside Jabodetabek and Banten', () => {
    const inside = ([lng, lat]: [number, number]) => lng > 105.9 && lng < 107.3 && lat > -6.8 && lat < -5.85
    for (const line of busMap.lines) {
      for (const shape of line.shapes) {
        expect(decodePolyline(shape).every(inside), `line ${line.code}`).toBe(true)
      }
    }
    for (const edge of busMap.edges) {
      expect(decodePolyline(edge.shape).every(inside), `edge ${edge.lines.join(' ')}`).toBe(true)
    }
    for (const [code, [, lng, lat]] of Object.entries(busMap.haltes)) {
      expect(inside([lng, lat]), code).toBe(true)
    }
    for (const [id, lng, lat] of busMap.rail) {
      expect(inside([lng, lat]), id).toBe(true)
    }
  })

  it('draws every line on the network, each once per edge', () => {
    const codes = new Set(busMap.lines.map(l => l.code))
    for (const edge of busMap.edges) {
      expect(edge.lines.length, edge.shape).toBeGreaterThan(0)
      expect(new Set(edge.lines).size, edge.lines.join(' ')).toBe(edge.lines.length)
      for (const code of edge.lines) expect(codes.has(code), code).toBe(true)
    }
    expect(new Set(busMap.edges.flatMap(e => e.lines))).toEqual(codes)
  })

  // The feed's reroutes aren't drawn: koridor 1 runs its poster route, Harmoni ->
  // Monas -> Kebon Sirih, not the feed's diversion via Petojo (generateBusMap's
  // alongTopology).
  it('draws koridor 1 past Monas, not via Petojo', () => {
    const kx = Math.cos((-6.2 * Math.PI) / 180) * 111_320
    const ky = 110_574
    const distanceTo = (code: string, halte: string | [number, number]): number => {
      const [x, y] = typeof halte === 'string' ? busMap.haltes[halte]!.slice(1) as [number, number] : halte
      let best = Infinity
      for (const shape of busMap.lines.find(l => l.code === code)!.shapes) {
        const pts = decodePolyline(shape).map(([lng, lat]) => [lng * kx, lat * ky] as const)
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay] = pts[i - 1]!
          const [bx, by] = pts[i]!
          const dx = bx - ax
          const dy = by - ay
          const t = Math.max(0, Math.min(1, ((x * kx - ax) * dx + (y * ky - ay) * dy) / (dx * dx + dy * dy || 1)))
          best = Math.min(best, Math.hypot(x * kx - (ax + t * dx), y * ky - (ay + t * dy)))
        }
      }
      return best
    }
    expect(distanceTo('1', 'H00131P')).toBeLessThan(60) // Monumen Nasional
    expect(distanceTo('1', 'H00170P')).toBeGreaterThan(300) // Petojo
    expect(busMap.lines.find(l => l.code === '1')!.stops).not.toContain('H00170P')
    // 6 turns from Flyover Kuningan round by Latuharhari and Cokroaminoto (past the Istituto
    // Italiano di Cultura), back down Rasuna Said, and onto Galunggung by Jl. Gembira.
    expect(distanceTo('6', [106.82831, -6.20208])).toBeLessThan(50) // Istituto Italiano di Cultura
    // Jl. Gembira, a short street whose corners are simplified; Rasuna Said is ~70 m off.
    expect(distanceTo('6', [106.82972, -6.2062])).toBeLessThan(30) // Jl. Gembira
  })

  it('has rail stations for bearings and no TJ among them', () => {
    expect(busMap.rail.length).toBeGreaterThan(100)
    expect(busMap.rail.some(([id]) => id.startsWith('TJ-'))).toBe(false)
  })
})
