import { describe, expect, it } from 'vitest'
import { buildVectorBuffers, hexToBytes, parseMapGeometry } from './map-vector-geometry'
import type { MapGeometryDoc } from './map-vector-geometry'

function doc(overrides: Partial<MapGeometryDoc> = {}): MapGeometryDoc {
  return {
    version: 'test',
    viewBox: [0, 0, 100, 100],
    scale: 4,
    canvas: [0, 0, 100, 100],
    palette: ['#FF0000', '#00FF00', '#0000FF'],
    layers: [],
    ...overrides
  }
}

describe('parseMapGeometry', () => {
  it('accepts a well-formed document', () => {
    const d = doc({
      layers: [
        { name: 'rail', kind: 'stroke', items: [{ c: 0, w: 100, pts: [0, 0, 40, 0] }] },
        { name: 'stations', kind: 'disc', items: [{ c: 1, x: 10, y: 10, r: 8 }] },
        { name: 'region-fill', kind: 'mesh', items: [{ c: 2, tris: [0, 0, 4, 0, 0, 4] }] }
      ]
    })
    expect(parseMapGeometry(d)).toBe(d)
  })

  it('rejects a palette index out of bounds', () => {
    const d = doc({
      layers: [{ name: 'rail', kind: 'stroke', items: [{ c: 7, w: 100, pts: [0, 0, 4, 0] }] }]
    })
    expect(() => parseMapGeometry(d)).toThrow(/palette index 7/)
  })

  it('rejects malformed palette entries', () => {
    expect(() => parseMapGeometry(doc({ palette: ['red'] }))).toThrow(/bad palette/)
  })

  it('rejects strokes with odd or too-short coordinate lists', () => {
    const short = doc({ layers: [{ name: 'rail', kind: 'stroke', items: [{ c: 0, w: 100, pts: [0, 0] }] }] })
    expect(() => parseMapGeometry(short)).toThrow(/malformed stroke/)
    const odd = doc({ layers: [{ name: 'rail', kind: 'stroke', items: [{ c: 0, w: 100, pts: [0, 0, 4] }] }] })
    expect(() => parseMapGeometry(odd)).toThrow(/malformed stroke/)
  })

  it('rejects meshes whose length is not whole triangles', () => {
    const d = doc({ layers: [{ name: 'fills', kind: 'mesh', items: [{ c: 0, tris: [0, 0, 4, 0] }] }] })
    expect(() => parseMapGeometry(d)).toThrow(/malformed mesh/)
  })

  it('rejects a non-positive fixed-point scale', () => {
    expect(() => parseMapGeometry(doc({ scale: 0 }))).toThrow(/bad scale/)
  })
})

describe('hexToBytes', () => {
  it('decodes channels with full alpha', () => {
    expect(hexToBytes('#CA2B51')).toEqual([0xCA, 0x2B, 0x51, 255])
    expect(hexToBytes('#FFFFFF')).toEqual([255, 255, 255, 255])
  })
})

describe('buildVectorBuffers', () => {
  it('expands a two-point stroke into one capsule quad with exact attributes', () => {
    const built = buildVectorBuffers(doc({
      layers: [{ name: 'rail', kind: 'stroke', items: [{ c: 0, w: 100, pts: [40, 80, 120, 80] }] }]
    }))

    expect(built.capsuleCount).toBe(1)
    expect(built.triangleCount).toBe(0)
    // Fixed point /4: endpoints (10,20)→(30,20), half-width 100/4/2 = 12.5.
    for (let v = 0; v < 4; v++) {
      expect(built.sdf.axisA[v * 2 + 0]).toBe(10)
      expect(built.sdf.axisA[v * 2 + 1]).toBe(20)
      expect(built.sdf.axisB[v * 2 + 0]).toBe(30)
      expect(built.sdf.axisB[v * 2 + 1]).toBe(20)
      expect(built.sdf.radius[v]).toBe(12.5)
    }
    expect(Array.from(built.sdf.quad)).toEqual([-1, -1, 1, -1, -1, 1, 1, 1])
    expect(Array.from(built.sdf.indices)).toEqual([0, 1, 2, 2, 1, 3])
    // Per-vertex color: palette[0] = #FF0000.
    expect(Array.from(built.sdf.color.slice(0, 4))).toEqual([255, 0, 0, 255])
  })

  it('chains a polyline into one capsule per segment', () => {
    const built = buildVectorBuffers(doc({
      layers: [{ name: 'brt', kind: 'stroke', items: [{ c: 1, w: 60, pts: [0, 0, 40, 0, 40, 40] }] }]
    }))
    expect(built.capsuleCount).toBe(2)
    // Second capsule spans (10,0)→(10,10).
    expect(built.sdf.axisA[8]).toBe(10)
    expect(built.sdf.axisA[9]).toBe(0)
    expect(built.sdf.axisB[8]).toBe(10)
    expect(built.sdf.axisB[9]).toBe(10)
  })

  it('emits discs as zero-length capsules', () => {
    const built = buildVectorBuffers(doc({
      layers: [{ name: 'stations', kind: 'disc', items: [{ c: 2, x: 100, y: 200, r: 88 }] }]
    }))
    expect(built.capsuleCount).toBe(1)
    expect(built.sdf.axisA[0]).toBe(25)
    expect(built.sdf.axisA[1]).toBe(50)
    expect(built.sdf.axisB[0]).toBe(25)
    expect(built.sdf.axisB[1]).toBe(50)
    expect(built.sdf.radius[0]).toBe(22)
  })

  it('preserves cross-layer painter order in the index buffer', () => {
    const built = buildVectorBuffers(doc({
      layers: [
        { name: 'casing', kind: 'stroke', items: [{ c: 0, w: 8, pts: [0, 0, 4, 0] }] },
        { name: 'rail', kind: 'stroke', items: [{ c: 1, w: 8, pts: [0, 0, 4, 0] }] },
        { name: 'stations', kind: 'disc', items: [{ c: 2, x: 0, y: 0, r: 4 }] }
      ]
    }))
    expect(built.capsuleCount).toBe(3)
    // Indices ascend monotonically: casing quad first, rail above it, disc on top.
    expect(Array.from(built.sdf.indices)).toEqual([
      0, 1, 2, 2, 1, 3,
      4, 5, 6, 6, 5, 7,
      8, 9, 10, 10, 9, 11
    ])
    // Vertex colors confirm which quad is which.
    expect(Array.from(built.sdf.color.slice(0, 3))).toEqual([255, 0, 0])
    expect(Array.from(built.sdf.color.slice(16, 19))).toEqual([0, 255, 0])
    expect(Array.from(built.sdf.color.slice(32, 35))).toEqual([0, 0, 255])
  })

  it('expands rings into a closed capsule chain around the centreline', () => {
    const built = buildVectorBuffers(doc({
      layers: [{ name: 'ring', kind: 'ring', items: [{ c: 0, x: 400, y: 400, r: 45, w: 18 }] }]
    }))
    // World: center (100,100), r 11.25, width 4.5 → half-width 2.25.
    expect(built.capsuleCount).toBeGreaterThanOrEqual(24)
    expect(built.sdf.radius[0]).toBe(2.25)
    // First capsule starts on the circle at angle 0 → (111.25, 100).
    expect(built.sdf.axisA[0]).toBeCloseTo(111.25)
    expect(built.sdf.axisA[1]).toBeCloseTo(100)
    // Chain closes: last capsule's B is the first capsule's A.
    const last = built.capsuleCount - 1
    expect(built.sdf.axisB[last * 8]).toBeCloseTo(111.25)
    expect(built.sdf.axisB[last * 8 + 1]).toBeCloseTo(100)
    // Every point on the chain stays on the centreline circle.
    for (let i = 0; i < built.capsuleCount; i++) {
      const d = Math.hypot(built.sdf.axisA[i * 8] - 100, built.sdf.axisA[i * 8 + 1] - 100)
      expect(d).toBeCloseTo(11.25, 5)
    }
  })

  it('rejects malformed rings', () => {
    const bad = doc({ layers: [{ name: 'ring', kind: 'ring', items: [{ c: 0, x: 0, y: 0, r: 0, w: 4 }] }] })
    expect(() => parseMapGeometry(bad)).toThrow(/malformed ring/)
  })

  it('decodes mesh triangles out of fixed point with per-vertex color', () => {
    const built = buildVectorBuffers(doc({
      layers: [{ name: 'region-fill', kind: 'mesh', items: [{ c: 1, tris: [0, 0, 40, 0, 0, 40] }] }]
    }))
    expect(built.triangleCount).toBe(1)
    expect(Array.from(built.mesh.position)).toEqual([0, 0, 10, 0, 0, 10])
    expect(Array.from(built.mesh.color.slice(0, 4))).toEqual([0, 255, 0, 255])
  })
})
