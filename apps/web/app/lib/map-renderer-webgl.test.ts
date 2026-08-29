import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Manifest, Tier, Transform } from './map-renderer'
import { createWebGLRenderer } from './map-renderer-webgl'

// These tests drive the real renderer against a fake WebGL2 context, asserting
// on GPU texture lifetime — the thing that actually decides whether the map
// survives on a phone. The grid and tile size mirror the shipped FDTJ manifest
// (8x8 at 1189.19625 x 840.86), so the byte figures here are the real ones: a
// tier-2 tile is 2378x1682, ~10.7 MB with mipmaps as RGB565, and all 64
// resident at that tier is ~683 MB.
//
// This fixture described a 4x4 grid long after the shipped one went 8x8, which
// made every byte figure derived from it 4x reality — and those figures were
// then quoted in the renderer's own comments. Keep it matching the manifest.

const GRID = 8
const TILE_W = 1189.19625
const TILE_H = 840.86

const manifest: Manifest = {
  version: 'test',
  source: 'test',
  viewBox: [0, 0, TILE_W * GRID, TILE_H * GRID],
  grid: { rows: GRID, cols: GRID },
  tileSize: { w: TILE_W, h: TILE_H },
  raster: { format: 'webp', tiers: [0.5, 1, 2] }
}

interface FakeTexture {
  id: number
  deleted: boolean
}

interface FakeFramebuffer {
  id: number
  deleted: boolean
}

// Recorded by the twgl mock rather than the fake context, because the draw call
// itself goes through twgl. Hoisted so the mock factory — which vitest may
// invoke before this module's top-level bindings initialise — can close over it.
const { drawCalls } = vi.hoisted(() => ({
  drawCalls: [] as Array<{ blend: boolean, texture: unknown, desaturate?: number, fade?: number }>
}))

interface UploadRecord {
  textureId: number | null
  internalFormat: number
  format: number
  type: number
  width: number
  height: number
}

// Tracks every texture the renderer allocates and deletes, plus the dimensions
// of the last upload into each, so tests can compute resident bytes the same way
// the renderer does. It also records the pixel format of each upload and the
// enable/disable state of each capability: format selection and blend state are
// GPU-memory and fill-rate decisions that nothing else here can observe.
function createFakeGl() {
  let nextId = 1
  const textures: FakeTexture[] = []
  const framebuffers: FakeFramebuffer[] = []
  const blendEquations: number[] = []
  let bound: FakeTexture | null = null
  let boundFramebuffer: FakeFramebuffer | null = null
  const enabled = new Set<number>()
  const uploads: UploadRecord[] = []
  let drawElementsCalls = 0

  const gl = {
    RGBA: 0x1908, RGB: 0x1907, RGB565: 0x8d62, UNSIGNED_BYTE: 0x1401,
    UNSIGNED_SHORT_5_6_5: 0x8363, UNSIGNED_SHORT: 0x1403, TEXTURE_2D: 0x0de1,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601, LINEAR_MIPMAP_LINEAR: 0x2703, CLAMP_TO_EDGE: 0x812f,
    COLOR_BUFFER_BIT: 0x4000, BLEND: 0x0be2, ONE: 1, ONE_MINUS_SRC_ALPHA: 0x0303,
    TRIANGLE_STRIP: 5, TRIANGLES: 4, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    // The cutout mask target: an R8 colour attachment the tile shader samples.
    FRAMEBUFFER: 0x8d40, COLOR_ATTACHMENT0: 0x8ce0, FRAMEBUFFER_COMPLETE: 0x8cd5,
    R8: 0x8229, RED: 0x1903, MAX: 0x8008, FUNC_ADD: 0x8006,

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
    // Two shapes reach this: the 1x1 placeholder passes explicit dimensions
    // (target, level, internalFormat, w, h, border, format, type, pixels), and
    // a real tile passes a bitmap source (target, level, internalFormat,
    // format, type, source). Discriminate on argument count.
    texImage2D(...args: unknown[]) {
      const record: UploadRecord = args.length >= 9
        ? {
            textureId: bound?.id ?? null,
            internalFormat: args[2] as number,
            format: args[6] as number,
            type: args[7] as number,
            width: args[3] as number,
            height: args[4] as number
          }
        : {
            textureId: bound?.id ?? null,
            internalFormat: args[2] as number,
            format: args[3] as number,
            type: args[4] as number,
            width: (args[5] as { width: number }).width,
            height: (args[5] as { height: number }).height
          }
      uploads.push(record)
    },
    texParameteri() {}, texParameterf() {}, pixelStorei() {},
    generateMipmap() {}, viewport() {}, clearColor() {}, clear() {},
    enable(cap: number) { enabled.add(cap) },
    disable(cap: number) { enabled.delete(cap) },
    blendFunc() {}, useProgram() {},
    // Mask framebuffer. blendEquation is recorded rather than ignored: it is
    // sticky context state, and leaving it on MAX would silently corrupt every
    // later blended pass.
    createFramebuffer() {
      const f: FakeFramebuffer = { id: nextId++, deleted: false }
      framebuffers.push(f)
      return f as unknown as WebGLFramebuffer
    },
    deleteFramebuffer(f: WebGLFramebuffer | null) {
      if (f) (f as unknown as FakeFramebuffer).deleted = true
    },
    bindFramebuffer(_target: number, f: WebGLFramebuffer | null) {
      boundFramebuffer = f as unknown as FakeFramebuffer | null
    },
    framebufferTexture2D() {},
    checkFramebufferStatus: () => 0x8cd5,
    blendEquation(mode: number) { blendEquations.push(mode) },
    createBuffer: () => ({}), deleteBuffer() {},
    createVertexArray: () => ({}), deleteVertexArray() {}, bindVertexArray() {},
    drawElements() { drawElementsCalls++ },
    // Read by the twgl drawBufferInfo mock, which is handed this object as its
    // first argument, so a recorded draw carries the blend state in force.
    __isEnabled: (cap: number) => enabled.has(cap),
    __framebuffers: () => framebuffers,
    __blendEquations: () => blendEquations,
    __boundFramebuffer: () => boundFramebuffer
  }

  return {
    gl: gl as unknown as WebGL2RenderingContext,
    liveTextures: () => textures.filter(t => !t.deleted).length,
    totalCreated: () => textures.length,
    // Uploads of a real tile — the 1x1 placeholder is excluded, since every
    // assertion here is about tile pixels.
    tileUploads: () => uploads.filter(u => u.width > 1 || u.height > 1),
    isEnabled: (cap: number) => enabled.has(cap),
    drawElementsCalls: () => drawElementsCalls,
    liveFramebuffers: () => framebuffers.filter(f => !f.deleted).length,
    blendEquations: () => blendEquations
  }
}

// Set by the pacing tests to hold loads open, so concurrency and per-frame
// upload limits can be observed rather than raced. Null means resolve instantly.
const { deferredLoads } = vi.hoisted(() => ({
  deferredLoads: {
    current: null as null | {
      pending: Array<() => void>
      started: number
    }
  }
}))

// The real tile source fetches WebP over the network and decodes it with
// createImageBitmap, neither of which exists here. This stub resolves instantly
// with a bitmap of the correct per-tier dimensions and `opaque: true` (matching
// the pre-rasterized WebP path), so the upload path runs its real GL calls and
// bookkeeping — which is what decides the byte figures under test.
vi.mock('./map-renderer-tile-source', () => ({
  createTileSource: () => ({
    loadTile: async (_r: number, _c: number, tier: Tier) => {
      const gate = deferredLoads.current
      if (gate) {
        gate.started++
        await new Promise<void>(resolve => gate.pending.push(resolve))
      }
      return {
        bitmap: {
          width: Math.round(TILE_W * tier),
          height: Math.round(TILE_H * tier),
          close: () => {}
        } as unknown as ImageBitmap,
        opaque: true
      }
    },
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
// stubbed to an inert value, except the three that carry observable intent:
// setUniforms remembers the texture a draw is about to use, drawBufferInfo
// records the draw along with the blend state in force at that moment, and
// createBufferInfoFromArrays records the a_alpha it was handed — the mask's
// buffers are rebuilt only when the shape list actually differs, so that array
// is how a cutout's fade becomes visible to a test.
// Every a_alpha array handed to a mask buffer rebuild, in order. Module scope
// because the mock is hoisted above the tests that read it.
const maskAlphaBuilds: number[][] = []

vi.mock('twgl.js', () => {
  let lastTexture: unknown = null
  // Mirrors how GL actually behaves: a uniform stays bound until something sets
  // it again. That is what makes a missed call site observable here — the draw
  // records whatever value was last bound, not a fresh zero.
  let lastDesaturate: number | undefined
  let lastFade: number | undefined
  return {
    createProgramInfo: () => ({ program: {}, uniformSetters: {}, attribSetters: {} }),
    createBufferInfoFromArrays: (_gl: unknown, arrays: Record<string, { data?: ArrayLike<number> }>) => {
      if (arrays.a_alpha?.data) maskAlphaBuilds.push(Array.from(arrays.a_alpha.data))
      return { attribs: {}, numElements: 4 }
    },
    createVertexArrayInfo: () => ({ vertexArrayObject: {}, numElements: 4 }),
    setBuffersAndAttributes: () => {},
    setUniforms: (_programInfo: unknown, uniforms: Record<string, unknown>) => {
      if ('u_texture' in uniforms) lastTexture = uniforms.u_texture
      if ('u_desaturate' in uniforms) lastDesaturate = uniforms.u_desaturate as number
      if ('u_fade' in uniforms) lastFade = uniforms.u_fade as number
    },
    drawBufferInfo: (gl: { __isEnabled?: (cap: number) => boolean }) => {
      drawCalls.push({
        blend: gl.__isEnabled?.(0x0be2) ?? false,
        texture: lastTexture,
        desaturate: lastDesaturate,
        fade: lastFade
      })
    }
  }
})

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

beforeEach(() => {
  drawCalls.length = 0
  deferredLoads.current = null
})

describe('webgl tile memory', () => {
  it('holds only the visible tiles after panning across the map', async () => {
    const { renderer, liveTextures } = setup()
    const vw = 360
    const vh = 780
    const scale = 0.2

    // Visit every tile in the grid one at a time, the pan pattern that used to
    // leave all 64 resident at once.
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        renderer.draw(transformOverTile(r, c, scale, vw, vh), vw, vh, 3, 2)
        await flush()
      }
    }
    // One more frame so the final pan position's eviction sweep runs.
    renderer.draw(transformOverTile(3, 3, scale, vw, vh), vw, vh, 3, 2)

    // A tile texture per resident tile, plus the 1x1 placeholder — and nothing
    // else. Stated against tileStats() rather than a hardcoded count so it
    // tracks the visible span instead of pinning one viewport's geometry.
    expect(liveTextures()).toBe(renderer.tileStats().count + 1)
    // Far below the 64 tiles this held before eviction existed: the point of
    // the pan is that visiting every tile must not accumulate every tile. At
    // this zoom the visible span is ~12-18 tiles and the budget keeps about one
    // extra screen of pan-back history on top, so half the grid is a generous
    // bound that still fails loudly if eviction stops working.
    expect(renderer.tileStats().count).toBeLessThan((GRID * GRID) / 2)
  })

  it('keeps resident bytes under the budget', async () => {
    const { renderer } = setup()
    const vw = 360
    const vh = 780

    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
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
    // Small enough that all 8 columns fit in 360 CSS px: 360 / (1189.196 * 8).
    // At 0.05 the map is 476 px wide against a 360 px viewport, so a column
    // falls outside and the premise of this test quietly stops holding.
    const t = wholeMapTransform(0.03)

    // Whole map visible at tier 1: all 64 tiles are in the working set and must
    // survive the sweep, or the next frame re-requests what was just dropped.
    renderer.draw(t, 360, 780, 3, 1)
    await flush()
    renderer.draw(t, 360, 780, 3, 1)

    expect(renderer.tileStats().count).toBe(GRID * GRID)
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
    const mapW = TILE_W * GRID
    const minScale = Math.min(vw / mapW, vh / (TILE_H * GRID))

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
    const allTiles = GRID * GRID
    expect(renderer.tileStats().bytes)
      .toBeLessThanOrEqual(tier1TileBytes * (allTiles - 2) + tier2TileBytes * 2)

    // Pan the tier-2 corner tile off screen; now nothing is exempt and the
    // downgrade must reclaim it. Without downgradeOverResolvedTiles this stays
    // pinned at tier 2 forever, which is the leak that produced the 600 MB.
    const away = transformOverTile(GRID - 1, GRID - 1, 0.05, vw, vh)
    renderer.draw(away, vw, vh, 3, 1)
    await flush()
    renderer.draw(away, vw, vh, 3, 1)

    expect(renderer.tileStats().bytes).toBeLessThanOrEqual(tier1TileBytes * allTiles)
  })
})

describe('webgl draw pass', () => {
  const PREVIEW = { url: 'preview.webp', w: 1280, h: 905 }

  function setupWithPreview() {
    const fake = createFakeGl()
    const renderer = createWebGLRenderer(
      createCanvas(fake.gl),
      { ...manifest, preview: PREVIEW },
      '/maps/test/',
      () => {}
    )
    return { ...fake, renderer }
  }

  it('draws the preview alone while tiles are still blank', async () => {
    const { renderer } = setupWithPreview()
    const vw = 360
    const vh = 780
    const t = transformOverTile(1, 1, 0.34, vw, vh)

    // Let the preview texture land, but not the tiles: draw once to kick off
    // both loads, flush, then clear the record and draw again with tiles still
    // at tier 0 only if they haven't uploaded. Simpler and stricter: assert on
    // the very first frame, where nothing has loaded at all.
    renderer.draw(t, vw, vh, 2, 2)
    // Frame 1 has no preview texture yet either, so nothing is drawn at all —
    // in particular, no opaque placeholder that would paint over the preview
    // the moment it arrives.
    expect(drawCalls).toHaveLength(0)

    await flush()
    drawCalls.length = 0
    renderer.draw(t, vw, vh, 2, 2)

    // The preview has arrived and the tiles have too (the stubbed source
    // resolves instantly), so every draw is a real tile — never the placeholder.
    expect(drawCalls.length).toBeGreaterThan(0)
    for (const call of drawCalls) expect(call.texture).not.toBeNull()
  })

  it('never paints an opaque placeholder over the preview', async () => {
    const { renderer } = setupWithPreview()
    const vw = 360
    const vh = 780
    const t = transformOverTile(1, 1, 0.34, vw, vh)

    // Load the preview but keep the tiles blank by releasing them right after
    // the preview lands — this is the release-on-hide / context-recovery state
    // the preview underlay exists to cover.
    renderer.draw(t, vw, vh, 2, 2)
    await flush()
    renderer.releaseTiles()

    drawCalls.length = 0
    renderer.draw(t, vw, vh, 2, 2)

    // Exactly one draw: the preview underlay. Before this fix every blank tile
    // drew an opaque white quad on top of it, so the user saw white rectangles
    // instead of a low-res map.
    expect(drawCalls).toHaveLength(1)
  })

  it('draws blank tiles only when the hitbox debug flag is on', async () => {
    const { renderer } = setupWithPreview()
    const vw = 360
    const vh = 780
    const t = transformOverTile(1, 1, 0.34, vw, vh)

    renderer.draw(t, vw, vh, 2, 2)
    await flush()
    renderer.releaseTiles()
    renderer.setDebugHitboxes(true)

    drawCalls.length = 0
    renderer.draw(t, vw, vh, 2, 2)

    // Preview + one placeholder per visible tile. Author mode wants unloaded
    // tiles visible; production does not.
    expect(drawCalls.length).toBeGreaterThan(1)
    // The placeholder is a translucent tint, so it needs blending to read as one.
    expect(drawCalls[drawCalls.length - 1].blend).toBe(true)
  })

  it('draws opaque tiles with blending off', async () => {
    const { renderer } = setup()
    const vw = 360
    const vh = 780
    const t = transformOverTile(1, 1, 0.34, vw, vh)

    renderer.draw(t, vw, vh, 2, 2)
    await flush()
    drawCalls.length = 0
    renderer.draw(t, vw, vh, 2, 2)

    // The pre-rasterized WebPs have no alpha channel, so blending them is a
    // framebuffer read for a result that is always the source.
    expect(drawCalls.length).toBeGreaterThan(0)
    for (const call of drawCalls) expect(call.blend).toBe(false)
  })

  it('keeps blending on for the spotlight overlay', async () => {
    const { renderer } = setup()
    const vw = 360
    const vh = 780
    const t = transformOverTile(1, 1, 0.34, vw, vh)

    renderer.draw(t, vw, vh, 2, 2)
    await flush()
    drawCalls.length = 0
    renderer.draw(t, vw, vh, 2, 2, {
      ax: 0,
      ay: 0,
      bx: 10,
      by: 10,
      r: 5,
      cr: 5,
      color: [1, 0, 0],
      fadeAlpha: 0.5,
      ringProgress: 1
    })

    // The halo composites over the map; drawn without blending its glow would
    // be an opaque slab. draw() turns blending off for the tile pass, so
    // drawOverlays has to own this itself.
    const last = drawCalls[drawCalls.length - 1]
    expect(last.blend).toBe(true)
  })

  it('never runs more than two tile loads at once', async () => {
    const gate = { pending: [] as Array<() => void>, started: 0 }
    deferredLoads.current = gate
    const { renderer } = setup()
    const vw = 360
    const vh = 780

    // Whole map visible at tier 2: 16 tiles all want an upgrade at once, which
    // is the pinch-across-a-tier-boundary case that used to fire every fetch
    // and then land every texImage2D in whichever frame they happened to
    // resolve in.
    renderer.draw(wholeMapTransform(0.05), vw, vh, 2, 2)
    await flush()

    expect(gate.started).toBe(2)

    // Releasing one frees exactly one slot.
    gate.pending.shift()!()
    await flush()
    expect(gate.started).toBe(3)
  })

  it('uploads at most one tile per frame', async () => {
    const gate = { pending: [] as Array<() => void>, started: 0 }
    deferredLoads.current = gate
    const { renderer, tileUploads } = setup()
    const vw = 360
    const vh = 780
    const t = wholeMapTransform(0.05)

    renderer.draw(t, vw, vh, 2, 2)
    await flush()
    // Let several loads finish, so more than one bitmap is decoded and waiting.
    for (let i = 0; i < 4; i++) {
      gate.pending.shift()?.()
      await flush()
    }
    expect(tileUploads().length).toBe(0)

    // Each subsequent frame lands exactly one, however many are ready.
    renderer.draw(t, vw, vh, 2, 2)
    expect(tileUploads().length).toBe(1)
    renderer.draw(t, vw, vh, 2, 2)
    expect(tileUploads().length).toBe(2)
  })

  it('asks for another frame while uploads are still pending', async () => {
    const gate = { pending: [] as Array<() => void>, started: 0 }
    deferredLoads.current = gate
    const fake = createFakeGl()
    let dirtyCalls = 0
    const renderer = createWebGLRenderer(
      createCanvas(fake.gl),
      manifest,
      '/maps/test/',
      () => { dirtyCalls++ }
    )
    const vw = 360
    const vh = 780
    const t = wholeMapTransform(0.03)

    renderer.draw(t, vw, vh, 2, 2)
    await flush()
    // Two decoded and waiting, one upload slot per frame.
    gate.pending.shift()?.()
    await flush()
    gate.pending.shift()?.()
    await flush()

    dirtyCalls = 0
    renderer.draw(t, vw, vh, 2, 2)

    // The render loop parks unless something marks it dirty, and the drain only
    // runs inside draw(). A frame that leaves work in readyUploads must
    // therefore request the next one, or the tiles are stranded and the map
    // sits on the blurry preview indefinitely.
    expect(dirtyCalls).toBeGreaterThan(0)
  })

  it('cancels queued loads for tiles the view has left', async () => {
    const gate = { pending: [] as Array<() => void>, started: 0 }
    deferredLoads.current = gate
    const { renderer } = setup()
    const vw = 360
    const vh = 780

    // Queue the whole grid, then pan somewhere else before the loads finish.
    renderer.draw(wholeMapTransform(0.05), vw, vh, 2, 2)
    await flush()
    const startedWhileWide = gate.started

    renderer.draw(transformOverTile(0, 0, 0.2, vw, vh), vw, vh, 2, 2)
    await flush()

    // Release everything still held open. The cancelled requests must not have
    // started, and nothing off-screen may still be pinned as pending — that is
    // the state that would make those entries permanently eviction-exempt.
    while (gate.pending.length > 0) gate.pending.shift()!()
    await flush()
    renderer.draw(transformOverTile(0, 0, 0.2, vw, vh), vw, vh, 2, 2)
    await flush()
    renderer.draw(transformOverTile(0, 0, 0.2, vw, vh), vw, vh, 2, 2)

    // Only the corner's own tiles remain resident; the 16 the wide view queued
    // did not all get fetched and uploaded on the way through.
    expect(gate.started).toBeLessThan(16)
    expect(startedWhileWide).toBe(2)
    expect(renderer.tileStats().count).toBeLessThan(8)
  })

  it('drops a decoded tile rather than uploading it into a released entry', async () => {
    const gate = { pending: [] as Array<() => void>, started: 0 }
    deferredLoads.current = gate
    const { renderer, tileUploads } = setup()
    const vw = 360
    const vh = 780
    const t = transformOverTile(1, 1, 0.34, vw, vh)

    renderer.draw(t, vw, vh, 2, 2)
    await flush()
    // releaseTiles() replaces every entry while the fetch is in flight. The
    // old entry's texture is gone, so uploading into it would be a GL error
    // against a deleted object.
    renderer.releaseTiles()
    while (gate.pending.length > 0) gate.pending.shift()!()
    await flush()
    renderer.draw(t, vw, vh, 2, 2)

    expect(tileUploads()).toHaveLength(0)
  })

  it('uploads opaque tiles as RGB565', async () => {
    const { renderer, tileUploads } = setup()
    const vw = 360
    const vh = 780
    const t = transformOverTile(1, 1, 0.34, vw, vh)

    // Two draws: the first queues the load, the second is the frame that
    // actually uploads it. Uploads are paced, so they never land inside the
    // draw that asked for them.
    renderer.draw(t, vw, vh, 2, 2)
    await flush()
    renderer.draw(t, vw, vh, 2, 2)

    // 16bpp instead of 32 is what halves resident tile memory; nothing else in
    // the suite observes the format, so a regression here would be silent.
    const uploads = tileUploads()
    expect(uploads.length).toBeGreaterThan(0)
    for (const upload of uploads) {
      expect(upload.internalFormat).toBe(0x8d62) // RGB565
      expect(upload.format).toBe(0x1907) // RGB
      expect(upload.type).toBe(0x8363) // UNSIGNED_SHORT_5_6_5
    }
  })
})

describe('webgl route overlay', () => {
  const overlay = {
    segments: [
      { ax: 0, ay: 0, bx: 100, by: 0, r: 7, color: [1, 0, 0] as [number, number, number], kind: 'ride' as const },
      { ax: 100, ay: 0, bx: 200, by: 0, r: 7, color: [0, 0, 1] as [number, number, number], kind: 'ride' as const }
    ],
    pins: [
      { x: 0, y: 0, kind: 'origin' as const },
      { x: 200, y: 0, kind: 'destination' as const }
    ]
  }

  it('draws one ranged call per color run when a route frame is passed', () => {
    const { renderer, drawElementsCalls } = setup()
    renderer.setRouteOverlay(overlay)
    renderer.draw(wholeMapTransform(0.2), 360, 780, 3, 1, null, { alpha: 1, scrimAlpha: 0.2, desaturate: 0, fade: 0.6 })
    // Paint list: casing (1 white run), red, blue, then per pin white/ink/white
    // with the two runs at the origin/destination boundary NOT merging (white
    // inner of pin 1 and white casing of pin 2 are adjacent) — so ≥ 5 runs.
    expect(drawElementsCalls()).toBeGreaterThanOrEqual(5)
  })

  it('draws nothing extra when the overlay is cleared or the frame is absent', () => {
    const { renderer, drawElementsCalls } = setup()
    renderer.setRouteOverlay(overlay)
    renderer.setRouteOverlay(null)
    renderer.draw(wholeMapTransform(0.2), 360, 780, 3, 1, null, { alpha: 1, scrimAlpha: 0.2, desaturate: 0, fade: 0.6 })
    renderer.setRouteOverlay(overlay)
    renderer.draw(wholeMapTransform(0.2), 360, 780, 3, 1)
    expect(drawElementsCalls()).toBe(0)
  })

  it('survives dispose with a route overlay set', () => {
    const { renderer } = setup()
    renderer.setRouteOverlay(overlay)
    expect(() => renderer.dispose()).not.toThrow()
  })

  /*
   * Desaturation reaches the tile shader through THREE separate setUniforms
   * calls — the preview-only return, the preview underlay, and the per-frame
   * tile uniforms — because each passes its own object and twgl sets only the
   * keys it is handed.
   *
   * A missed site does not read zero; a GL uniform keeps whatever was last
   * bound, so the bug is a stale value from an earlier frame, which is exactly
   * the kind of thing eyeballing a screenshot fails to catch. The mock models
   * that stickiness deliberately.
   */
  describe('tile desaturation', () => {
    const drawnTiles = () => drawCalls.filter(c => c.texture !== null && c.texture !== undefined)

    it('sets it on every textured draw while a route is up', async () => {
      const { renderer } = setup()
      renderer.draw(wholeMapTransform(0.2), 360, 780, 3, 1)
      await flush()
      drawCalls.length = 0
      renderer.setRouteOverlay(overlay)
      renderer.draw(wholeMapTransform(0.2), 360, 780, 3, 1, null, { alpha: 1, scrimAlpha: 0, desaturate: 0.85, fade: 0.6 })
      expect(drawnTiles().length).toBeGreaterThan(0)
      for (const call of drawnTiles()) {
        expect(call.desaturate).toBe(0.85)
        expect(call.fade).toBe(0.6)
      }
    })

    it('returns the map to full colour once the route is gone', async () => {
      const { renderer } = setup()
      renderer.draw(wholeMapTransform(0.2), 360, 780, 3, 1)
      await flush()
      renderer.setRouteOverlay(overlay)
      renderer.draw(wholeMapTransform(0.2), 360, 780, 3, 1, null, { alpha: 1, scrimAlpha: 0, desaturate: 0.85, fade: 0.6 })
      drawCalls.length = 0
      renderer.draw(wholeMapTransform(0.2), 360, 780, 3, 1)
      expect(drawnTiles().length).toBeGreaterThan(0)
      for (const call of drawnTiles()) {
        expect(call.desaturate).toBe(0)
        expect(call.fade).toBe(0)
      }
    })

    it('leaves the map alone mid-fade-out once the overlay has faded to nothing', async () => {
      const { renderer } = setup()
      renderer.draw(wholeMapTransform(0.2), 360, 780, 3, 1)
      await flush()
      drawCalls.length = 0
      renderer.setRouteOverlay(overlay)
      // alpha 0 is the settled end of a fade-out: nothing is drawn, so nothing
      // should be greyed either.
      renderer.draw(wholeMapTransform(0.2), 360, 780, 3, 1, null, { alpha: 0, scrimAlpha: 0, desaturate: 0.85, fade: 0.6 })
      for (const call of drawnTiles()) {
        expect(call.desaturate).toBe(0)
        expect(call.fade).toBe(0)
      }
    })
  })
})

/*
 * The cutout mask is this renderer's first framebuffer, which makes it the first
 * thing that can leak on context loss or outlive a release. These cover the
 * lifecycle rather than the pixels, which the fake context cannot produce.
 */
describe('webgl cutout mask', () => {
  const vw = 360
  const vh = 780
  const station = {
    ax: 0, ay: 0, bx: 10, by: 10, r: 5, cr: 5,
    color: [1, 0, 0] as [number, number, number],
    fadeAlpha: 0.6,
    ringProgress: 1
  }

  it('allocates nothing while there is no cutout', async () => {
    const { renderer, liveFramebuffers } = setup()
    const t = transformOverTile(1, 1, 0.34, vw, vh)
    renderer.draw(t, vw, vh, 2, 2)
    await flush()
    // A map with nothing selected must not pay for the target at all.
    expect(liveFramebuffers()).toBe(0)
  })

  it('allocates once a cutout appears, and reuses it', async () => {
    const { renderer, liveFramebuffers } = setup()
    const t = transformOverTile(1, 1, 0.34, vw, vh)
    renderer.draw(t, vw, vh, 2, 2, station)
    await flush()
    expect(liveFramebuffers()).toBe(1)
    // A held selection re-renders the same geometry; it must not reallocate.
    renderer.draw(t, vw, vh, 2, 2, station)
    await flush()
    expect(liveFramebuffers()).toBe(1)
  })

  /*
   * A fading cutout changes nothing but its alpha, and the mask's buffers are
   * rebuilt only when the shape list differs. If that comparison ignores alpha,
   * every frame of a fade reports "unchanged", the buffers keep the first
   * frame's values, and the fade silently never happens — with no unit test
   * anywhere near mapTreatment able to see it.
   */
  it('rebuilds the mask when only a cutout alpha has changed', async () => {
    maskAlphaBuilds.length = 0
    const { renderer } = setup()
    const t = transformOverTile(1, 1, 0.34, vw, vh)
    // openProgress is the knob; mapTreatment turns it into each cut's alpha.
    const isolate = (openProgress: number) => ({
      shapes: [{ ax: 0, ay: 0, bx: 400, by: 0, r: 20, cr: 6 }],
      fadeAlpha: 0.6,
      openProgress
    })
    renderer.draw(t, vw, vh, 2, 2, undefined, undefined, isolate(0.2))
    await flush()
    renderer.draw(t, vw, vh, 2, 2, undefined, undefined, isolate(0.8))
    await flush()
    // Two rebuilds, carrying the two different alphas. Compared loosely: the
    // buffer is a Float32Array, so 0.2 comes back as 0.20000000298023224.
    const alphas = maskAlphaBuilds.map(a => a[0])
    expect(alphas.some(a => Math.abs(a - 0.2) < 1e-6)).toBe(true)
    expect(alphas.some(a => Math.abs(a - 0.8) < 1e-6)).toBe(true)
  })

  it('reuses the mask when nothing about the cutout changed', async () => {
    maskAlphaBuilds.length = 0
    const { renderer } = setup()
    const t = transformOverTile(1, 1, 0.34, vw, vh)
    const isolate = {
      shapes: [{ ax: 0, ay: 0, bx: 400, by: 0, r: 20, cr: 6 }],
      fadeAlpha: 0.6,
      openProgress: 0.5
    }
    renderer.draw(t, vw, vh, 2, 2, undefined, undefined, isolate)
    await flush()
    const after = maskAlphaBuilds.length
    renderer.draw(t, vw, vh, 2, 2, undefined, undefined, isolate)
    await flush()
    expect(maskAlphaBuilds.length).toBe(after)
  })

  it('defaults a cutout with no alpha to fully punched', async () => {
    maskAlphaBuilds.length = 0
    const { renderer } = setup()
    const t = transformOverTile(1, 1, 0.34, vw, vh)
    renderer.draw(t, vw, vh, 2, 2, station)
    await flush()
    expect(maskAlphaBuilds.at(-1)?.every(a => a === 1)).toBe(true)
  })

  it('restores the blend equation after the mask pass', async () => {
    const { renderer, blendEquations } = setup()
    const t = transformOverTile(1, 1, 0.34, vw, vh)
    renderer.draw(t, vw, vh, 2, 2, station)
    await flush()
    // MAX unions the shapes, but it is sticky context state: leaving it set
    // would silently corrupt every later blended pass.
    const seen = blendEquations()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[seen.length - 1]).toBe(0x8006) // FUNC_ADD
  })

  it('hands the target back with the tiles', async () => {
    const { renderer, liveFramebuffers } = setup()
    const t = transformOverTile(1, 1, 0.34, vw, vh)
    renderer.draw(t, vw, vh, 2, 2, station)
    await flush()
    expect(liveFramebuffers()).toBe(1)
    // releaseTiles exists to hand GPU memory back, and this is the largest
    // single allocation after the tiles themselves.
    renderer.releaseTiles()
    expect(liveFramebuffers()).toBe(0)
  })

  it('frees the target on dispose', async () => {
    const { renderer, liveFramebuffers } = setup()
    const t = transformOverTile(1, 1, 0.34, vw, vh)
    renderer.draw(t, vw, vh, 2, 2, station)
    await flush()
    renderer.dispose()
    expect(liveFramebuffers()).toBe(0)
  })

  it('isolating a line draws its shapes without allocating per shape', async () => {
    const { renderer, liveFramebuffers } = setup()
    const t = transformOverTile(1, 1, 0.34, vw, vh)
    const shapes = Array.from({ length: 120 }, (_, i) => ({
      ax: i * 10, ay: 0, bx: i * 10 + 8, by: 0, r: 12.5, cr: 12.5
    }))
    renderer.draw(t, vw, vh, 2, 2, null, null, { shapes, fadeAlpha: 0.6 })
    await flush()
    // One target regardless of shape count: the whole point of the mask.
    expect(liveFramebuffers()).toBe(1)
  })
})
