import { describe, expect, it, vi } from 'vitest'
import type { Manifest, Tier, Transform } from './map-renderer'
import { createWebGLRenderer } from './map-renderer-webgl'
import { buildVectorBuffers } from './map-vector-geometry'
import type { MapGeometryDoc } from './map-vector-geometry'
import { buildLabelBuffers } from './map-label-geometry'
import type { LabelAtlasDoc, MapLabelsDoc } from './map-label-geometry'

// These tests drive the real renderer against a fake WebGL2 context, asserting
// on GPU texture lifetime — the thing that actually decides whether the map
// survives on a phone. The grid and tile size mirror the shipped FDTJ manifest
// (4x4 at 2378x1682), so the byte figures here are the real ones: a tier-2 tile
// is ~42 MB with mipmaps, and all 16 resident is ~683 MB.

const TILE_W = 2378.3925
const TILE_H = 1681.72

const manifest: Manifest = {
  version: 'test',
  source: 'test',
  viewBox: [0, 0, TILE_W * 4, TILE_H * 4],
  grid: { rows: 4, cols: 4 },
  tileSize: { w: TILE_W, h: TILE_H },
  raster: { format: 'webp', tiers: [1, 2] }
}

interface FakeTexture {
  id: number
  deleted: boolean
}

// Tracks every texture the renderer allocates and deletes, plus the dimensions
// of the last upload into each, so tests can compute resident bytes the same way
// the renderer does.
function createFakeGl() {
  let nextId = 1
  const textures: FakeTexture[] = []
  let bound: FakeTexture | null = null

  const gl = {
    RGBA: 0x1908, RGB: 0x1907, RGB565: 0x8d62, UNSIGNED_BYTE: 0x1401,
    UNSIGNED_SHORT_5_6_5: 0x8363, TEXTURE_2D: 0x0de1, TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601, LINEAR_MIPMAP_LINEAR: 0x2703, CLAMP_TO_EDGE: 0x812f,
    COLOR_BUFFER_BIT: 0x4000, BLEND: 0x0be2, ONE: 1, ONE_MINUS_SRC_ALPHA: 0x0303,
    TRIANGLE_STRIP: 5, TRIANGLES: 4, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,

    createTexture() {
      const t: FakeTexture = { id: nextId++, deleted: false }
      textures.push(t)
      return t as unknown as WebGLTexture
    },
    deleteTexture(t: WebGLTexture | null) {
      if (t) (t as unknown as FakeTexture).deleted = true
    },
    bindTexture(_target: number, t: WebGLTexture | null) {
      bound = t as unknown as FakeTexture | null
    },
    isContextLost: () => false,
    getExtension: () => null,
    getParameter: () => 1,
    texImage2D() { void bound },
    texParameteri() {}, texParameterf() {}, pixelStorei() {},
    generateMipmap() {}, viewport() {}, clearColor() {}, clear() {},
    enable() {}, blendFunc() {}, useProgram() {},
    createBuffer: () => ({}), deleteBuffer() {},
    createVertexArray: () => ({}), deleteVertexArray() {}, bindVertexArray() {}
  }

  return {
    gl: gl as unknown as WebGL2RenderingContext,
    liveTextures: () => textures.filter(t => !t.deleted).length,
    totalCreated: () => textures.length
  }
}

// The real tile source fetches WebP over the network and decodes it with
// createImageBitmap, neither of which exists here. This stub resolves instantly
// with a bitmap of the correct per-tier dimensions and `opaque: true` (matching
// the pre-rasterized WebP path), so requestTier runs its real upload and
// bookkeeping — which is what decides the byte figures under test.
vi.mock('./map-renderer-tile-source', () => ({
  createTileSource: () => ({
    loadTile: async (_r: number, _c: number, tier: Tier) => ({
      bitmap: {
        width: Math.round(TILE_W * tier),
        height: Math.round(TILE_H * tier),
        close: () => {}
      } as unknown as ImageBitmap,
      opaque: true
    }),
    loadPreview: async () => ({
      width: 1280,
      height: 905,
      close: () => {}
    } as unknown as ImageBitmap),
    dispose: () => {}
  })
}))

// twgl does real program compilation and attribute introspection, neither of
// which a fake context can satisfy. Every twgl entry point the renderer uses is
// stubbed to an inert value; drawBufferInfo records its calls so mode tests can
// count passes, but nothing here affects tile lifetime.
const drawnVaos: unknown[] = []
vi.mock('twgl.js', () => ({
  createProgramInfo: () => ({ program: {}, uniformSetters: {}, attribSetters: {} }),
  createBufferInfoFromArrays: () => ({ attribs: {}, numElements: 4 }),
  createVertexArrayInfo: () => ({ vertexArrayObject: {}, numElements: 4 }),
  setBuffersAndAttributes: () => {},
  setUniforms: () => {},
  drawBufferInfo: (_gl: unknown, vao: unknown) => { drawnVaos.push(vao) }
}))

function createCanvas(gl: WebGL2RenderingContext): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    isConnected: true,
    getContext: () => gl
  } as unknown as HTMLCanvasElement
}

// A view transform showing the whole 4x4 grid, so every tile counts as visible.
function wholeMapTransform(scale: number): Transform {
  return { tx: 0, ty: 0, scale }
}

// Pan so that only the tile at (row, col) intersects the viewport.
function transformOverTile(row: number, col: number, scale: number, vw: number, vh: number): Transform {
  return {
    tx: -(col * TILE_W + TILE_W / 2) * scale + vw / 2,
    ty: -(row * TILE_H + TILE_H / 2) * scale + vh / 2,
    scale
  }
}

// Resolve every pending tile load. requestTier awaits the tile source, so the
// uploads land a microtask after the draw that requested them.
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

function setup() {
  const fake = createFakeGl()
  const canvas = createCanvas(fake.gl)
  const renderer = createWebGLRenderer(canvas, manifest, '/maps/test/', () => {})
  return { ...fake, renderer }
}

describe('webgl tile memory', () => {
  it('holds only the visible tiles after panning across the map', async () => {
    const { renderer, liveTextures } = setup()
    const vw = 360
    const vh = 780
    const scale = 0.2

    // Visit every tile in the grid one at a time, the pan pattern that used to
    // leave all 16 resident at once.
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        renderer.draw(transformOverTile(r, c, scale, vw, vh), vw, vh, 3, 2)
        await flush()
      }
    }
    // One more frame so the final pan position's eviction sweep runs.
    renderer.draw(transformOverTile(3, 3, scale, vw, vh), vw, vh, 3, 2)

    // A tile texture per visible tile, plus the 1x1 placeholder. Far below the
    // 16 tiles + placeholder this held before eviction existed.
    expect(liveTextures()).toBeLessThanOrEqual(5)
  })

  it('keeps resident bytes under the budget', async () => {
    const { renderer } = setup()
    const vw = 360
    const vh = 780

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        renderer.draw(transformOverTile(r, c, 0.2, vw, vh), vw, vh, 3, 2)
        await flush()
      }
    }
    renderer.draw(transformOverTile(3, 3, 0.2, vw, vh), vw, vh, 3, 2)

    // 192 MB budget; the pre-eviction behaviour parked ~683 MB here.
    expect(renderer.tileStats().bytes).toBeLessThanOrEqual(192 * 1024 * 1024)
  })

  it('does not evict tiles that are currently on screen', async () => {
    const { renderer } = setup()
    const t = wholeMapTransform(0.05)

    // Whole map visible at tier 1: all 16 tiles are in the working set and must
    // survive the sweep, or the next frame re-requests what was just dropped.
    renderer.draw(t, 360, 780, 3, 1)
    await flush()
    renderer.draw(t, 360, 780, 3, 1)

    expect(renderer.tileStats().count).toBe(16)
  })

  // The two preview-only tests below use a contain-fit transform, which the
  // shipped map never produces: map.tsx uses cover-fit, so at minimum zoom the
  // map still spans ~3400 device px against a 1280px preview and this branch
  // stays dormant. They pin the behaviour for the day that changes — they are
  // not evidence that the path runs in production today.
  it('loads no tiles at all when zoomed out far enough for the preview', async () => {
    const fake = createFakeGl()
    const renderer = createWebGLRenderer(
      createCanvas(fake.gl),
      { ...manifest, preview: { url: 'preview.webp', w: 1280, h: 905 } },
      '/maps/test/',
      () => {}
    )
    const vw = 360
    const vh = 780
    const mapW = TILE_W * 4
    const minScale = Math.min(vw / mapW, vh / (TILE_H * 4))

    // Fit-to-screen, where the whole grid is on screen and every tile would
    // otherwise be resident — ~171 MB of texture to draw a 360px-wide map.
    renderer.draw({ tx: 0, ty: 0, scale: minScale }, vw, vh, 3, 1)
    await flush()
    renderer.draw({ tx: 0, ty: 0, scale: minScale }, vw, vh, 3, 1)

    expect(renderer.tileStats().bytes).toBe(0)
    expect(renderer.tileStats().count).toBe(0)
  })

  it('still loads tiles once zoomed past the preview threshold', async () => {
    const fake = createFakeGl()
    const renderer = createWebGLRenderer(
      createCanvas(fake.gl),
      { ...manifest, preview: { url: 'preview.webp', w: 1280, h: 905 } },
      '/maps/test/',
      () => {}
    )
    const vw = 360
    const vh = 780

    // Well past the threshold: the preview would be visibly soft here, so real
    // tiles must load. Guards against the preview path swallowing every zoom.
    renderer.draw(transformOverTile(1, 1, 0.34, vw, vh), vw, vh, 3, 2)
    await flush()
    renderer.draw(transformOverTile(1, 1, 0.34, vw, vh), vw, vh, 3, 2)

    expect(renderer.tileStats().bytes).toBeGreaterThan(0)
  })

  it('drops off-screen tiles held at a finer tier than the view needs', async () => {
    const { renderer } = setup()
    const vw = 360
    const vh = 780

    // Zoom deep into one corner at tier 2.
    renderer.draw(transformOverTile(0, 0, 0.2, vw, vh), vw, vh, 3, 2)
    await flush()
    renderer.draw(transformOverTile(0, 0, 0.2, vw, vh), vw, vh, 3, 2)
    const zoomedBytes = renderer.tileStats().bytes
    expect(zoomedBytes).toBeGreaterThan(0)

    // Zoom back out to tier 1 across the whole map. The corner tile is still
    // visible, but the tier-2 pixels of anything off-screen must go.
    renderer.draw(wholeMapTransform(0.05), 360, 780, 3, 1)
    await flush()
    renderer.draw(wholeMapTransform(0.05), 360, 780, 3, 1)

    // Tiles still on screen keep their tier-2 pixels by design — dropping a
    // visible tile would flash the placeholder under the user. At this zoom the
    // viewport straddles a tile boundary, so two tiles are exempt and the rest
    // are back to tier 1. Still far under the ~683 MB all-tier-2 figure this
    // test exists to rule out.
    const tier1TileBytes = Math.round(Math.round(TILE_W) * Math.round(TILE_H) * 2 * (4 / 3))
    const tier2TileBytes = Math.round(Math.round(TILE_W * 2) * Math.round(TILE_H * 2) * 2 * (4 / 3))
    expect(renderer.tileStats().bytes).toBeLessThanOrEqual(tier1TileBytes * 14 + tier2TileBytes * 2)

    // Pan the tier-2 corner tile off screen; now nothing is exempt and the
    // downgrade must reclaim it. Without downgradeOverResolvedTiles this stays
    // pinned at tier 2 forever, which is the leak that produced the 600 MB.
    const away = transformOverTile(3, 3, 0.05, vw, vh)
    renderer.draw(away, vw, vh, 3, 1)
    await flush()
    renderer.draw(away, vw, vh, 3, 1)

    expect(renderer.tileStats().bytes).toBeLessThanOrEqual(tier1TileBytes * 16)
  })
})

// Minimal but complete vector dataset: one stroke and one region fill, enough to
// give the layer both an SDF pass and a mesh pass.
function vectorDoc(): MapGeometryDoc {
  return {
    version: 'test',
    viewBox: [0, 0, TILE_W * 4, TILE_H * 4],
    scale: 4,
    canvas: [0, 0, TILE_W * 4, TILE_H * 4],
    palette: ['#FF0000', '#00FF00'],
    layers: [
      { name: 'rail', kind: 'stroke', items: [{ c: 0, w: 100, pts: [0, 0, 4000, 0] }] },
      { name: 'region-fill', kind: 'mesh', items: [{ c: 1, tris: [0, 0, 400, 0, 0, 400] }] }
    ]
  }
}

describe('vector modes', () => {
  it('\'only\' mode draws and requests no tiles at all', async () => {
    const { renderer } = setup()
    renderer.setVectorGeometry?.(buildVectorBuffers(vectorDoc()))
    renderer.setVectorMode?.('only')

    const t = wholeMapTransform(0.05)
    renderer.draw(t, 360, 780, 3, 1)
    await flush()
    renderer.draw(t, 360, 780, 3, 1)

    expect(renderer.tileStats().count).toBe(0)
    expect(renderer.tileStats().bytes).toBe(0)
  })

  it('\'overlay\' mode leaves tile residency identical to the tile path', async () => {
    const { renderer } = setup()
    renderer.setVectorGeometry?.(buildVectorBuffers(vectorDoc()))
    renderer.setVectorMode?.('overlay')

    // Same whole-map draw as the "does not evict visible tiles" test: all 16
    // tiles must still load and stay resident with the overlay active.
    const t = wholeMapTransform(0.05)
    renderer.draw(t, 360, 780, 3, 1)
    await flush()
    renderer.draw(t, 360, 780, 3, 1)

    expect(renderer.tileStats().count).toBe(16)
  })

  const labelsDoc: MapLabelsDoc = {
    version: 'test',
    scale: 4,
    fonts: ['F'],
    palette: ['#19181C'],
    runs: [{ f: 0, s: 130, c: 0, x: 0, y: 0, t: 'A', a: [0] }]
  }
  const atlasDoc: LabelAtlasDoc = {
    size: [64, 64],
    distanceRange: 8,
    fonts: [{ name: 'F', fontSize: 48, base: 38, glyphs: { A: { x: 0, y: 0, w: 8, h: 8, xo: 0, yo: 0 } } }]
  }

  it('\'only\' mode draws the label pass after the vector passes', async () => {
    const { renderer } = setup()
    renderer.setVectorGeometry?.(buildVectorBuffers(vectorDoc()))
    renderer.setVectorMode?.('only')
    renderer.setLabelGeometry?.(buildLabelBuffers(labelsDoc, atlasDoc))
    renderer.setLabelAtlas?.({} as TexImageSource, 8)

    drawnVaos.length = 0
    renderer.draw(wholeMapTransform(0.05), 360, 780, 3, 1)
    // Fill mesh pass + capsule SDF pass + label pass, nothing else (no tiles).
    expect(drawnVaos.length).toBe(3)
  })

  it('\'overlay\' mode never draws the label pass', async () => {
    const { renderer } = setup()
    renderer.setVectorGeometry?.(buildVectorBuffers(vectorDoc()))
    renderer.setVectorMode?.('overlay')
    renderer.setLabelGeometry?.(buildLabelBuffers(labelsDoc, atlasDoc))
    renderer.setLabelAtlas?.({} as TexImageSource, 8)

    const t = wholeMapTransform(0.05)
    renderer.draw(t, 360, 780, 3, 1)
    await flush()
    drawnVaos.length = 0
    renderer.draw(t, 360, 780, 3, 1)
    // 16 tile quads + 1 capsule SDF pass (overlay skips region fills and labels).
    expect(drawnVaos.length).toBe(17)
  })

  it('switching back to \'off\' restores the pure tile path', async () => {
    const { renderer } = setup()
    renderer.setVectorGeometry?.(buildVectorBuffers(vectorDoc()))
    renderer.setVectorMode?.('only')
    const t = wholeMapTransform(0.05)
    renderer.draw(t, 360, 780, 3, 1)
    await flush()
    expect(renderer.tileStats().count).toBe(0)

    renderer.setVectorMode?.('off')
    renderer.draw(t, 360, 780, 3, 1)
    await flush()
    renderer.draw(t, 360, 780, 3, 1)
    expect(renderer.tileStats().count).toBe(16)
  })
})
