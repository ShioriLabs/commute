import { describe, expect, it } from 'vitest'
import { findLine, lineCutShapes, linesNear, type LinesManifest } from './map-line-isolate'
import type { Point } from './map-renderer'

const manifest: LinesManifest = {
  version: 'test',
  pointsVersion: 'test',
  lines: [
    {
      key: 'KCI:B', operator: 'KCI', code: 'B', name: 'Lin Bogor', color: '#EE3D43', r: 12.5,
      segments: [
        { kind: 'TRUNK', edges: [[0, 0, 100, 0], [100, 0, 200, 0]], markers: ['KCI-A', 'KCI-B'] },
        { kind: 'RAMP', edges: [[200, 0, 200, 100]], markers: ['KCI-B', 'KCI-C'] }
      ],
      bbox: [0, 0, 200, 100], matchedPairs: 3, totalPairs: 3
    },
    {
      key: 'KCI:C', operator: 'KCI', code: 'C', name: 'Lin Cikarang', color: '#25B8EB', r: 12.5,
      segments: [{ kind: 'TRUNK', edges: [[0, 500, 200, 500]], markers: ['KCI-D'] }],
      bbox: [0, 500, 200, 500], matchedPairs: 1, totalPairs: 1
    }
  ]
}

const dot = (id: string, x: number, y: number): Point => ({ id, ax: x, ay: y, bx: x, by: y, r: 12 })
const label = (station: string, x: number): Point =>
  ({ id: `LBL-${station}`, station, ax: x, ay: 40, bx: x + 60, by: 40, r: 20, noRing: true })

describe('lineCutShapes', () => {
  const points = [dot('KCI-A', 0, 0), dot('KCI-B', 100, 0), dot('KCI-C', 200, 100)]
  const labels = [label('KCI-A', 0), label('KCI-B', 100)]

  it('holds the traced stroke, the markers and the names', () => {
    const shapes = lineCutShapes(manifest.lines[0], points, labels)
    // 3 edges + 3 markers + 2 labels (KCI-C has no name drawn).
    expect(shapes).toHaveLength(8)
    expect(shapes.filter(s => s.r === 12.5)).toHaveLength(3)
  })

  it('punches a junction station once, not once per branch', () => {
    // KCI-B is the last stop of the trunk and the first of the ramp.
    const shapes = lineCutShapes(manifest.lines[0], points, [])
    const markers = shapes.filter(s => s.r === 12)
    expect(markers).toHaveLength(3)
  })

  it('draws edges as capsules', () => {
    const shapes = lineCutShapes(manifest.lines[0], points, [])
    const edge = shapes[0]
    // cr === r degenerates the rounded rect to a capsule, matching how the route
    // overlay draws its own segments.
    expect(edge.cr).toBe(edge.r)
  })

  it('skips a station with no drawn point', () => {
    const shapes = lineCutShapes(manifest.lines[0], [], [])
    expect(shapes).toHaveLength(3)
  })
})

describe('linesNear', () => {
  it('finds the line under a tap on its stroke', () => {
    expect(linesNear(manifest, 50, 0, 8)).toEqual(['KCI:B'])
  })

  it('finds nothing off any stroke', () => {
    expect(linesNear(manifest, 50, 300, 8)).toEqual([])
  })

  it('returns every line sharing a trunk, nearest first', () => {
    // An interlined trunk genuinely carries several lines, and there is no
    // information in the geometry to prefer one. The caller disambiguates.
    const shared: LinesManifest = {
      ...manifest,
      lines: [
        manifest.lines[0],
        { ...manifest.lines[1], segments: [{ kind: 'TRUNK', edges: [[0, 4, 200, 4]], markers: [] }] }
      ]
    }
    expect(linesNear(shared, 50, 0, 8).sort()).toEqual(['KCI:B', 'KCI:C'])
  })

  it('collapses the two direction-strokes of one line to a single candidate', () => {
    // The artwork draws each direction separately, ~22 units apart. Both belong
    // to the same line, so keying by line means no chooser appears.
    const twin: LinesManifest = {
      ...manifest,
      lines: [{
        ...manifest.lines[0],
        segments: [
          { kind: 'TRUNK', edges: [[0, 0, 200, 0]], markers: [] },
          { kind: 'TRUNK', edges: [[0, 22, 200, 22]], markers: [] }
        ]
      }]
    }
    expect(twin.lines[0].segments).toHaveLength(2)
    expect(linesNear(twin, 100, 11, 8)).toEqual(['KCI:B'])
  })

  it('is empty before the manifest lands', () => {
    expect(linesNear(undefined, 0, 0, 8)).toEqual([])
  })
})

describe('findLine', () => {
  it('finds by operator:code key', () => {
    expect(findLine(manifest, 'KCI:C')?.name).toBe('Lin Cikarang')
  })

  it('is undefined for a line with no baked geometry, such as any BRT line', () => {
    expect(findLine(manifest, 'TJ:1')).toBeUndefined()
  })
})
