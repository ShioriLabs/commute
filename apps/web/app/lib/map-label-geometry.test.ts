import { describe, expect, it } from 'vitest'
import { buildLabelBuffers, parseLabelAtlas, parseMapLabels, HALO_EXPAND_WORLD } from './map-label-geometry'
import type { LabelAtlasDoc, MapLabelsDoc } from './map-label-geometry'

function labelsDoc(overrides: Partial<MapLabelsDoc> = {}): MapLabelsDoc {
  return {
    version: 'test',
    scale: 4,
    fonts: ['PTSans-Regular'],
    palette: ['#19181C', '#FFFFFF'],
    runs: [],
    ...overrides
  }
}

function atlasDoc(overrides: Partial<LabelAtlasDoc> = {}): LabelAtlasDoc {
  return {
    size: [512, 512],
    distanceRange: 8,
    fonts: [{
      name: 'PTSans-Regular',
      fontSize: 48,
      base: 38,
      glyphs: {
        A: { x: 0, y: 0, w: 32, h: 36, xo: 1, yo: 6 },
        B: { x: 40, y: 0, w: 28, h: 36, xo: 2, yo: 6 }
      }
    }],
    ...overrides
  }
}

describe('parseMapLabels', () => {
  it('accepts a well-formed document', () => {
    const d = labelsDoc({
      runs: [{ f: 0, s: 130, c: 0, x: 100, y: 200, t: 'AB', a: [0, 60] }]
    })
    expect(parseMapLabels(d)).toBe(d)
  })

  it('rejects offsets misaligned with code points', () => {
    const d = labelsDoc({ runs: [{ f: 0, s: 130, c: 0, x: 0, y: 0, t: 'AB', a: [0] }] })
    expect(() => parseMapLabels(d)).toThrow(/2 code points/)
  })

  it('rejects out-of-bounds font, fill and halo indices', () => {
    expect(() => parseMapLabels(labelsDoc({
      runs: [{ f: 3, s: 130, c: 0, x: 0, y: 0, t: 'A', a: [0] }]
    }))).toThrow(/font index/)
    expect(() => parseMapLabels(labelsDoc({
      runs: [{ f: 0, s: 130, c: 9, x: 0, y: 0, t: 'A', a: [0] }]
    }))).toThrow(/palette index/)
    expect(() => parseMapLabels(labelsDoc({
      runs: [{ f: 0, s: 130, c: 0, h: 9, x: 0, y: 0, t: 'A', a: [0] }]
    }))).toThrow(/halo palette index/)
  })

  it('rejects a non-unit direction', () => {
    const d = labelsDoc({ runs: [{ f: 0, s: 130, c: 0, x: 0, y: 0, d: [500, 0], t: 'A', a: [0] }] })
    expect(() => parseMapLabels(d)).toThrow(/not unit length/)
  })
})

describe('parseLabelAtlas', () => {
  it('accepts a well-formed atlas and rejects broken ones', () => {
    const d = atlasDoc()
    expect(parseLabelAtlas(d)).toBe(d)
    expect(() => parseLabelAtlas(atlasDoc({ size: [0, 512] }))).toThrow(/bad size/)
    expect(() => parseLabelAtlas(atlasDoc({ distanceRange: 0 }))).toThrow(/bad distanceRange/)
  })
})

describe('buildLabelBuffers', () => {
  it('expands a glyph into a quad with exact positions, uvs and colors', () => {
    const labels = labelsDoc({
      // size 130 fixed -> 32.5 world; scale = 32.5/48 world per atlas px.
      runs: [{ f: 0, s: 130, c: 0, h: 1, x: 400, y: 800, t: 'A', a: [0] }]
    })
    const atlas = atlasDoc()
    const built = buildLabelBuffers(labels, atlas)
    expect(built.glyphCount).toBe(1)

    const pxScale = 32.5 / 48
    const left = 100 + 1 * pxScale
    const top = 200 + (6 - 38) * pxScale
    expect(built.position[0]).toBeCloseTo(left, 4)
    expect(built.position[1]).toBeCloseTo(top, 4)
    expect(built.position[2]).toBeCloseTo(left + 32 * pxScale, 4)
    expect(built.position[7]).toBeCloseTo(top + 36 * pxScale, 4)

    expect(built.uv[0]).toBeCloseTo(0)
    expect(built.uv[2]).toBeCloseTo(32 / 512)
    expect(built.uv[5]).toBeCloseTo(36 / 512)

    // Fill #19181C, halo white with alpha on.
    expect(Array.from(built.color.slice(0, 4))).toEqual([0x19, 0x18, 0x1C, 255])
    expect(Array.from(built.halo.slice(0, 4))).toEqual([255, 255, 255, 255])
    // Halo expansion: HALO_EXPAND_WORLD / pxScale / distanceRange as a byte.
    const expected = Math.round((HALO_EXPAND_WORLD / pxScale / 8) * 255)
    expect(built.haloExpand[0]).toBe(Math.min(255, expected))

    expect(Array.from(built.indices)).toEqual([0, 1, 2, 2, 1, 3])
  })

  it('zeroes the halo attributes for runs without a halo', () => {
    const built = buildLabelBuffers(
      labelsDoc({ runs: [{ f: 0, s: 130, c: 0, x: 0, y: 0, t: 'A', a: [0] }] }),
      atlasDoc()
    )
    expect(Array.from(built.halo.slice(0, 4))).toEqual([0, 0, 0, 0])
    expect(built.haloExpand[0]).toBe(0)
  })

  it('rotates glyph quads along the run direction', () => {
    // Vertical baseline (0, 1): the glyph's "right" is world +y.
    const built = buildLabelBuffers(
      labelsDoc({
        runs: [{ f: 0, s: 192, c: 0, x: 0, y: 0, d: [0, 1000], t: 'A', a: [0] }]
      }),
      atlasDoc()
    )
    const pxScale = 48 / 48 // 192 fixed = 48 world -> 1 world per atlas px
    // Local (left=1, top=-32): rotated by 90deg -> world (x: -top-ish...)
    // corner(lx, ly) = (dx*lx - dy*ly, dy*lx + dx*ly) with (dx,dy)=(0,1):
    // world = (-ly, lx).
    expect(built.position[0]).toBeCloseTo(-(6 - 38) * pxScale, 4)
    expect(built.position[1]).toBeCloseTo(1 * pxScale, 4)
  })

  it('skips whitespace but throws on other missing glyphs', () => {
    const ok = buildLabelBuffers(
      labelsDoc({ runs: [{ f: 0, s: 130, c: 0, x: 0, y: 0, t: 'A B', a: [0, 40, 80] }] }),
      atlasDoc()
    )
    expect(ok.glyphCount).toBe(2)

    expect(() => buildLabelBuffers(
      labelsDoc({ runs: [{ f: 0, s: 130, c: 0, x: 0, y: 0, t: 'AZ', a: [0, 40] }] }),
      atlasDoc()
    )).toThrow(/glyph "Z"/)
  })

  it('positions later chars by their per-char offsets', () => {
    const built = buildLabelBuffers(
      labelsDoc({ runs: [{ f: 0, s: 192, c: 0, x: 0, y: 0, t: 'AB', a: [0, 100] }] }),
      atlasDoc()
    )
    expect(built.glyphCount).toBe(2)
    // Second glyph pen x = 100/4 = 25 world, plus its xo (2 px at 1 world/px).
    expect(built.position[8]).toBeCloseTo(25 + 2, 4)
  })
})
