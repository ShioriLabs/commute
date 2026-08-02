import * as twgl from 'twgl.js'
import type { Manifest, Point, Renderer, SelectionOverlay, Tier, TileStats, Transform } from './map-renderer'
import { RING_WIDTH_WORLD, SPOTLIGHT_FEATHER_WORLD, pointCornerRadius, ringOffsetWorld, tileKey } from './map-renderer'
import { createTileSource } from './map-renderer-tile-source'

const VS = `#version 300 es
in vec2 a_position;
in vec2 a_texcoord;
uniform vec2 u_tileOffset;
uniform vec2 u_tileSize;
uniform mat3 u_transform;
out vec2 v_texcoord;
void main() {
  vec2 world = u_tileOffset + a_position * u_tileSize;
  vec3 clip = u_transform * vec3(world, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_texcoord = a_texcoord;
}
`

const FS = `#version 300 es
precision highp float;
in vec2 v_texcoord;
uniform sampler2D u_texture;
out vec4 outColor;
void main() {
  outColor = texture(u_texture, v_texcoord);
}
`

// Pill shader: each tap target is a 4-vertex quad whose local-space is the
// shape's bounding box. Vertex shader maps local quad coords to world coords;
// fragment shader computes the signed distance to an oriented rounded-rect
// boundary (corner radius = a_cornerRadius; equal to a_radius it degenerates
// to the old capsule).
const PILL_VS = `#version 300 es
in vec2 a_quad; // -1..1 unit quad
in vec2 a_axisA; // world-space endpoint A
in vec2 a_axisB; // world-space endpoint B
in float a_radius;
in float a_cornerRadius;
uniform mat3 u_transform;
out vec2 v_local;
out vec2 v_axisA;
out vec2 v_axisB;
out float v_radius;
out float v_cornerRadius;
void main() {
  vec2 axis = a_axisB - a_axisA;
  float len = length(axis);
  vec2 dir = len > 0.0 ? axis / len : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 center = (a_axisA + a_axisB) * 0.5;
  float halfLen = len * 0.5 + a_radius;
  vec2 world = center + dir * (a_quad.x * halfLen) + perp * (a_quad.y * a_radius);
  vec3 clip = u_transform * vec3(world, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_local = world;
  v_axisA = a_axisA;
  v_axisB = a_axisB;
  v_radius = a_radius;
  v_cornerRadius = a_cornerRadius;
}
`

// Shared rounded-rect SDF (world units, negative inside). Injected into both
// fragment shaders so pill fills, hitbox debug, and the spotlight all agree
// on the exact same boundary.
const SHAPE_SDF_GLSL = `
float shapeDistance(vec2 p, vec2 a, vec2 b, float r, float cr) {
  vec2 ab = b - a;
  float len = length(ab);
  vec2 dir = len > 0.0 ? ab / len : vec2(1.0, 0.0);
  vec2 rel = p - (a + b) * 0.5;
  vec2 lp = abs(vec2(dot(rel, dir), dot(rel, vec2(-dir.y, dir.x))));
  vec2 q = lp - vec2(len * 0.5 + r - cr, r - cr);
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - cr;
}
`

const PILL_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in vec2 v_axisA;
in vec2 v_axisB;
in float v_radius;
in float v_cornerRadius;
uniform vec4 u_color;
uniform float u_edgeSoftnessWorld;
out vec4 outColor;
${SHAPE_SDF_GLSL}
void main() {
  float d = shapeDistance(v_local, v_axisA, v_axisB, v_radius, v_cornerRadius);
  float edge = u_edgeSoftnessWorld;
  float alpha = 1.0 - smoothstep(-edge, edge, d);
  if (alpha <= 0.0) discard;
  outColor = vec4(u_color.rgb * u_color.a * alpha, u_color.a * alpha);
}
`

// Selection spotlight: one fullscreen pass drawn last, combining a dimming
// scrim (feathered punch-out around the selected capsule) and a glowing halo
// ring. The capsule arrives via uniforms — no per-selection buffers.
const SPOT_VS = `#version 300 es
in vec2 a_position; // 0..1 fullscreen quad
uniform vec2 u_viewport; // css px
uniform vec3 u_view; // tx, ty, scale
out vec2 v_world;
void main() {
  vec2 css = a_position * u_viewport;
  gl_Position = vec4(a_position.x * 2.0 - 1.0, 1.0 - a_position.y * 2.0, 0.0, 1.0);
  v_world = (css - u_view.xy) / u_view.z;
}
`

const SPOT_FS = `#version 300 es
precision highp float;
in vec2 v_world;
uniform vec2 u_selA;
uniform vec2 u_selB;
uniform float u_selR;
uniform float u_scrimAlpha;
uniform float u_feather; // world units
uniform vec3 u_ringColor;
uniform float u_ringOffset;
uniform float u_ringWidth;
uniform float u_ringAlpha;
uniform float u_selCr;
out vec4 outColor;
${SHAPE_SDF_GLSL}
void main() {
  float d = shapeDistance(v_world, u_selA, u_selB, u_selR, u_selCr); // signed dist to shape edge
  // Scrim with a feathered punch-out: 0 inside the capsule, full past feather.
  float scrim = u_scrimAlpha * smoothstep(0.0, u_feather, d);
  // Glowing ring centered u_ringOffset outside the capsule edge.
  float ring = (1.0 - smoothstep(0.0, u_ringWidth, abs(d - u_ringOffset))) * u_ringAlpha;
  // Soft outer glow hugging the ring.
  float glow = exp(-max(d - u_ringOffset, 0.0) / (u_ringWidth * 2.5)) * 0.35 * u_ringAlpha;
  vec3 scrimRgb = vec3(0.06, 0.09, 0.16) * scrim;
  float a = scrim + (ring + glow) * (1.0 - scrim);
  outColor = vec4(scrimRgb + u_ringColor * (ring + glow), a); // premultiplied
}
`

interface TileEntry {
  texture: WebGLTexture
  tier: Tier | 0
  pendingTier: Tier | null
  mipmapped: boolean
  // GPU bytes this entry currently holds, for tileStats(). Tracked rather than
  // recomputed because the tier alone doesn't tell you whether the upload has
  // landed yet.
  bytes: number
  // Frame counter at the last draw that touched this tile. Eviction sorts by
  // this, so "least recently on screen" is what gets dropped first.
  lastUsed: number
}

// Ceiling on resident tile pixels. The grid is 4x4 and a tier-2 tile is ~42 MB
// with mipmaps, so a fully-visited map wants ~683 MB — enough to get the context
// killed on a phone, and the measured figure on a Galaxy S23. Nothing evicted
// before this budget existed: draw() only ever upgraded tiles, so panning around
// at zoom accumulated all 16 at full tier and held them for the renderer's life.
//
// 192 MB comfortably covers the working set that is actually on screen (a
// portrait phone sees at most 4 tier-2 tiles, ~171 MB, and typically 2), while
// leaving headroom for the in-flight upgrade that triggered the sweep.
const TILE_BUDGET_BYTES = 192 * 1024 * 1024

// How far past the preview's native resolution the view may zoom before real
// tiles are needed. 1.0 switches exactly where the map is drawn at the preview's
// own pixel size, so the preview is never stretched beyond its detail — it is
// pixel-lossless below the threshold and tiles take over above it.
//
// The preview is built at 1280px (build-map-tiles.ts PREVIEW_WIDTH) precisely so
// this covers fit-to-screen on a 360px 3x-DPR phone, which needs 1080px. Raising
// this would extend the tile-free range at the cost of visible softness; the
// honest way to buy more range is a wider preview.
const PREVIEW_SUFFICIENCY = 1

// A mipmapped texture costs its base level plus the geometric series of halved
// levels, which converges to 4/3. `bytesPerPixel` is 2 for RGB565, 4 for RGBA8.
function textureBytes(w: number, h: number, mipmapped: boolean, bytesPerPixel: number): number {
  return Math.round(w * h * bytesPerPixel * (mipmapped ? 4 / 3 : 1))
}

// Fill for a tile that has no pixels yet. Pale pink in dev so unloaded tiles are
// obvious while authoring; opaque white in prod, where it sits over the map
// route's white background — that makes every refill path (context recovery,
// release-on-hide) invisible instead of flashing pink.
const PLACEHOLDER_PIXEL = new Uint8Array(
  import.meta.env.DEV ? [255, 241, 242, 102] : [255, 255, 255, 255]
)

export function createWebGLRenderer(
  canvas: HTMLCanvasElement,
  manifest: Manifest,
  baseUrl: string,
  onDirty: () => void
): Renderer {
  // No MSAA: the tile quads are axis-aligned and screen-filling, so their edges
  // are never visible, and the pill/spotlight shaders antialias analytically
  // with smoothstep. Enabling it bought nothing and cost a multisampled
  // renderbuffer plus its resolve target — tens of MB on a phone, on a screen
  // that is already short of GPU memory (see tileStats()).
  const rawGl = canvas.getContext('webgl2', {
    antialias: false,
    premultipliedAlpha: true,
    alpha: true,
    powerPreference: 'low-power'
  }) as WebGL2RenderingContext | null
  if (!rawGl) throw new Error('WebGL2 not available')
  // getContext() keeps returning the same context object for a given canvas, so
  // on a canvas whose context was already lost this hands back a dead one. Fail
  // loudly instead of returning a renderer that silently draws nothing — the
  // caller's answer is a fresh canvas.
  if (rawGl.isContextLost()) throw new Error('WebGL2 context is lost')
  const gl: WebGL2RenderingContext = rawGl
  // twgl's TypeScript signatures predate WebGL2; the runtime accepts both.
  const twglGl = gl as unknown as WebGLRenderingContext

  const programInfo = twgl.createProgramInfo(twglGl, [VS, FS])
  const quadBufferInfo = twgl.createBufferInfoFromArrays(twglGl, {
    a_position: { numComponents: 2, data: [0, 0, 1, 0, 0, 1, 1, 1] },
    a_texcoord: { numComponents: 2, data: [0, 0, 1, 0, 0, 1, 1, 1] }
  })
  // Each program gets its own VAO so enabled-attribute state doesn't bleed
  // between draw passes (otherwise pill-only attribs stay enabled when the
  // tile program draws, causing INVALID_OPERATION).
  const quadVao = twgl.createVertexArrayInfo(twglGl, programInfo, quadBufferInfo)

  const pillProgramInfo = twgl.createProgramInfo(twglGl, [PILL_VS, PILL_FS])

  const spotProgramInfo = twgl.createProgramInfo(twglGl, [SPOT_VS, SPOT_FS])
  const spotBufferInfo = twgl.createBufferInfoFromArrays(twglGl, {
    a_position: { numComponents: 2, data: [0, 0, 1, 0, 0, 1, 1, 1] }
  })
  const spotVao = twgl.createVertexArrayInfo(twglGl, spotProgramInfo, spotBufferInfo)

  const loseCtxExt = gl.getExtension('WEBGL_lose_context')

  const anisoExt = gl.getExtension('EXT_texture_filter_anisotropic')
    ?? gl.getExtension('MOZ_EXT_texture_filter_anisotropic')
    ?? gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic')
  const maxAniso = anisoExt ? gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number : 1

  const { grid, tileSize } = manifest
  const tileW = tileSize.w
  const tileH = tileSize.h
  const mapW = grid.cols * tileW
  const mapH = grid.rows * tileH

  const tileSource = createTileSource({ manifest, baseUrl })
  const tiles = new Map<string, TileEntry>()
  let disposed = false
  // Monotonic draw counter, used as the LRU clock for evictTiles().
  let frameCounter = 0

  // Preview texture rendered under the tile grid whenever a visible tile has no
  // pixels yet. Held until dispose() — see the note in draw().
  let previewTexture: WebGLTexture | null = null
  let previewLoading = false

  let points: Point[] = []
  let pillBufferInfo: twgl.BufferInfo | null = null
  let pillVao: twgl.VertexArrayInfo | null = null
  let debugHitboxes = false

  function rebuildPillBuffers() {
    if (pillBufferInfo) {
      // twgl doesn't expose a delete helper for BufferInfo; recreate buffers fresh.
      for (const k in pillBufferInfo.attribs) {
        const buf = pillBufferInfo.attribs[k].buffer
        if (buf) gl.deleteBuffer(buf)
      }
      if (pillBufferInfo.indices) gl.deleteBuffer(pillBufferInfo.indices)
      pillBufferInfo = null
    }
    if (pillVao && pillVao.vertexArrayObject) {
      gl.deleteVertexArray(pillVao.vertexArrayObject)
      pillVao = null
    }
    if (points.length === 0) return
    const n = points.length
    const quadData = new Float32Array(n * 4 * 2)
    const axisAData = new Float32Array(n * 4 * 2)
    const axisBData = new Float32Array(n * 4 * 2)
    const radiusData = new Float32Array(n * 4)
    const cornerRadiusData = new Float32Array(n * 4)
    const indices = new Uint16Array(n * 6)
    const quadCorners = [-1, -1, 1, -1, -1, 1, 1, 1]
    for (let i = 0; i < n; i++) {
      const p = points[i]
      const cr = pointCornerRadius(p)
      for (let v = 0; v < 4; v++) {
        quadData[i * 8 + v * 2 + 0] = quadCorners[v * 2 + 0]
        quadData[i * 8 + v * 2 + 1] = quadCorners[v * 2 + 1]
        axisAData[i * 8 + v * 2 + 0] = p.ax
        axisAData[i * 8 + v * 2 + 1] = p.ay
        axisBData[i * 8 + v * 2 + 0] = p.bx
        axisBData[i * 8 + v * 2 + 1] = p.by
        radiusData[i * 4 + v] = p.r
        cornerRadiusData[i * 4 + v] = cr
      }
      const base = i * 4
      indices[i * 6 + 0] = base + 0
      indices[i * 6 + 1] = base + 1
      indices[i * 6 + 2] = base + 2
      indices[i * 6 + 3] = base + 2
      indices[i * 6 + 4] = base + 1
      indices[i * 6 + 5] = base + 3
    }
    pillBufferInfo = twgl.createBufferInfoFromArrays(twglGl, {
      a_quad: { numComponents: 2, data: quadData },
      a_axisA: { numComponents: 2, data: axisAData },
      a_axisB: { numComponents: 2, data: axisBData },
      a_radius: { numComponents: 1, data: radiusData },
      a_cornerRadius: { numComponents: 1, data: cornerRadiusData },
      indices: { numComponents: 3, data: indices }
    })
    pillVao = twgl.createVertexArrayInfo(twglGl, pillProgramInfo, pillBufferInfo)
  }

  const placeholder = createPlaceholderTexture(gl)

  function ensureTile(r: number, c: number): TileEntry | null {
    const key = tileKey(r, c)
    let entry = tiles.get(key)
    if (!entry) {
      // Null once the context is lost — GL object allocation fails silently
      // then, and storing that null would strand the entry at tier 0 forever
      // while draw() re-requested it on every frame.
      const texture = gl.createTexture()
      if (!texture) return null
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, PLACEHOLDER_PIXEL)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      entry = { texture, tier: 0, pendingTier: null, mipmapped: false, bytes: 0, lastUsed: frameCounter }
      tiles.set(key, entry)
    }
    entry.lastUsed = frameCounter
    return entry
  }

  // Release off-screen tiles that are held at a finer tier than the current view
  // would ever ask for. Zooming deep into one corner and then back out used to
  // leave those tiles pinned at tier 2 (~42 MB each) forever, because nothing
  // downgrades and the only tier transition in draw() is an upgrade.
  //
  // The pixels are dropped rather than re-uploaded at the coarser tier: the
  // tile is off-screen, so the cheapest correct thing is to let draw() re-request
  // it at whatever tier is right if it ever comes back. On-screen tiles are left
  // alone even when over-resolved — they are already drawn, and swapping them to
  // the placeholder would flash a blank tile under the user.
  function downgradeOverResolvedTiles(currentTier: Tier) {
    for (const [key, entry] of tiles) {
      if (entry.lastUsed === frameCounter || entry.pendingTier !== null) continue
      if (entry.tier <= currentTier) continue
      gl.deleteTexture(entry.texture)
      // Re-seeding the entry (rather than deleting it) would need a fresh
      // texture allocation; dropping it entirely lets ensureTile() rebuild
      // lazily and keeps one code path for "tile has no pixels".
      tiles.delete(key)
    }
  }

  // Drop least-recently-drawn tiles until resident pixels fit the budget.
  //
  // Only tiles that missed the current frame are candidates: everything on
  // screen right now shares one `lastUsed`, and evicting any of it would just
  // be re-requested by the next frame — a fetch/decode/upload loop that costs
  // bandwidth and jank without ever freeing anything. If the visible set alone
  // exceeds the budget there is nothing safe to drop, so the sweep stops and
  // the budget is knowingly overshot rather than thrashing.
  function evictTiles() {
    let bytes = 0
    for (const entry of tiles.values()) bytes += entry.bytes
    if (bytes <= TILE_BUDGET_BYTES) return

    const candidates: Array<[string, TileEntry]> = []
    for (const [key, entry] of tiles) {
      // An in-flight upgrade holds a reference to this exact entry object and
      // re-checks identity before uploading; deleting it here is safe (that
      // check fails and the bitmap is closed), but it would waste the fetch.
      if (entry.lastUsed === frameCounter || entry.pendingTier !== null) continue
      candidates.push([key, entry])
    }
    candidates.sort((a, b) => a[1].lastUsed - b[1].lastUsed)

    for (const [key, entry] of candidates) {
      if (bytes <= TILE_BUDGET_BYTES) break
      gl.deleteTexture(entry.texture)
      tiles.delete(key)
      bytes -= entry.bytes
    }
  }

  async function requestTier(r: number, c: number, tier: Tier): Promise<void> {
    if (disposed || gl.isContextLost()) return
    const entry = ensureTile(r, c)
    if (!entry) return
    if (entry.tier >= tier) return
    if (entry.pendingTier !== null && entry.pendingTier >= tier) return
    entry.pendingTier = tier
    try {
      const { bitmap, opaque } = await tileSource.loadTile(r, c, tier)
      if (disposed || gl.isContextLost()) {
        bitmap.close?.()
        return
      }
      // Identity re-check, not just pendingTier: releaseTiles() can delete this
      // entry and its texture while the fetch is in flight, and the replacement
      // entry is a different object with pendingTier === null. Uploading into
      // the deleted texture would be a GL error and the pixels would be lost.
      if (tiles.get(tileKey(r, c)) !== entry) {
        bitmap.close?.()
        return
      }
      if (entry.pendingTier !== tier) {
        bitmap.close?.()
        return
      }
      gl.bindTexture(gl.TEXTURE_2D, entry.texture)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      // Opaque tiles go in at 16bpp instead of 32. The pre-rasterized WebPs have
      // no alpha channel to begin with, so the only thing lost is colour depth —
      // 5-6-5 measures ~43-47 dB PSNR against the source on this artwork, which
      // is flat fills and text rather than gradients, and it halves the GPU
      // memory that was getting the context killed in the first place.
      // Runtime-rasterized SVG tiles keep RGBA: their background is genuinely
      // transparent, and dropping alpha would paint it black.
      if (opaque) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB565, gl.RGB, gl.UNSIGNED_SHORT_5_6_5, bitmap)
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
      }
      // pickTier promotes to tier 2 as soon as scale*dpr exceeds 1, so tier 1 is
      // only ever drawn at <=1:1 — i.e. minified, heavily so at max zoom-out.
      // Generate mipmaps for every tier so minification filters cleanly with
      // LINEAR_MIPMAP_LINEAR (+ anisotropy below) instead of aliasing into jagged
      // lines under plain LINEAR. (WebGL2 allows mipmaps on NPOT textures.)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      entry.mipmapped = true
      if (anisoExt && entry.mipmapped) {
        gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, maxAniso))
      }
      entry.tier = tier
      entry.pendingTier = null
      entry.bytes = textureBytes(bitmap.width, bitmap.height, entry.mipmapped, opaque ? 2 : 4)
      bitmap.close?.()
      onDirty()
    } catch (err) {
      entry.pendingTier = null
      console.warn(`Tile ${r},${c} tier ${tier} load failed`, err)
    }
  }

  function ensurePreview() {
    if (previewTexture || previewLoading || !manifest.preview) return
    if (disposed || gl.isContextLost()) return
    previewLoading = true
    tileSource.loadPreview().then((bitmap) => {
      previewLoading = false
      if (disposed || gl.isContextLost()) {
        bitmap?.close?.()
        return
      }
      if (!bitmap) return
      const tex = gl.createTexture()
      if (!tex) {
        bitmap.close?.()
        return
      }
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      bitmap.close?.()
      previewTexture = tex
      onDirty()
    }).catch(() => {
      previewLoading = false
    })
  }

  function releasePreview() {
    if (previewTexture) {
      gl.deleteTexture(previewTexture)
      previewTexture = null
    }
  }

  function resize(cssW: number, cssH: number, dpr: number) {
    const w = Math.max(1, Math.round(cssW * dpr))
    const h = Math.max(1, Math.round(cssH * dpr))
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
  }

  function draw(transform: Transform, cssW: number, cssH: number, dpr: number, currentTier: Tier, selection?: SelectionOverlay | null) {
    if (disposed || gl.isContextLost()) return
    // Bump before any ensureTile() call so every tile touched this frame — the
    // visibility scan below included — carries the current stamp and is exempt
    // from the eviction sweep at the end.
    frameCounter++
    gl.viewport(0, 0, Math.round(cssW * dpr), Math.round(cssH * dpr))
    gl.clearColor(1, 1, 1, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    const mat = buildTransformMat3(transform, cssW, cssH)

    gl.useProgram(programInfo.program)
    twgl.setBuffersAndAttributes(twglGl, programInfo, quadVao)

    const invScale = 1 / transform.scale
    const worldMinX = -transform.tx * invScale
    const worldMinY = -transform.ty * invScale
    const worldMaxX = (cssW - transform.tx) * invScale
    const worldMaxY = (cssH - transform.ty) * invScale

    // Visible row/column span, derived arithmetically rather than by testing
    // every tile in the grid. At 4x4 the scan was 16 iterations and not worth
    // avoiding; on the finer grid the tile count grows with the square of the
    // divisions, and this runs twice per frame.
    const firstCol = Math.max(0, Math.floor(worldMinX / tileW))
    const lastCol = Math.min(grid.cols - 1, Math.floor(worldMaxX / tileW))
    const firstRow = Math.max(0, Math.floor(worldMinY / tileH))
    const lastRow = Math.min(grid.rows - 1, Math.floor(worldMaxY / tileH))

    // Zoomed far enough out that the preview carries as much detail as the tiles
    // would: draw it alone and load no tiles at all.
    //
    // NOTE: unreachable on the FDTJ map as currently configured. map.tsx derives
    // minScale with max(viewport/map) — cover-fit — so the map never shrinks to
    // fit the screen; at minimum zoom it still spans ~3400 device px on a phone,
    // against a 1280px preview. Satisfying this branch would need a ~3400px
    // preview costing ~32 MB of texture, which is worse than the ~20 MiB of
    // tier-0.5 tiles it would replace. Kept because it costs one comparison per
    // frame and becomes correct the moment the map uses contain-fit; do not
    // widen the preview to try to activate it without redoing that arithmetic.
    const previewOnly = manifest.preview !== undefined
      && transform.scale * dpr * mapW <= manifest.preview.w * PREVIEW_SUFFICIENCY
    if (previewOnly) {
      if (!previewTexture) ensurePreview()
      if (previewTexture) {
        twgl.setUniforms(programInfo, {
          u_tileOffset: [0, 0],
          u_tileSize: [mapW, mapH],
          u_transform: mat,
          u_texture: previewTexture
        })
        twgl.drawBufferInfo(twglGl, quadVao, gl.TRIANGLE_STRIP)
        drawOverlays(mat, transform, cssW, cssH, selection)
        // Nothing here draws a tile, so every resident tile is dead weight —
        // release them outright rather than waiting for the budget sweep, which
        // would keep a full grid (~171 MB) resident indefinitely because it sits
        // just under the cap. This is also the path that cleans up after the
        // first frame: the preview loads asynchronously, so frame 1 falls
        // through below and requests tiles before the texture exists.
        //
        // Deliberately not releaseTiles(): that signals onDirty(), which would
        // schedule another frame, which would release again — a redraw loop for
        // as long as the map sits zoomed out. Nothing needs repainting here;
        // the tiles being freed are ones this frame didn't draw.
        if (tiles.size > 0) {
          for (const entry of tiles.values()) gl.deleteTexture(entry.texture)
          tiles.clear()
        }
        return
      }
      // No preview yet — fall through and draw tiles as usual rather than
      // showing a blank map while it loads.
    }

    // Check whether any visible tile is still missing — if so, the preview
    // underlay (if loaded) gets drawn first to cover blank gaps.
    let anyVisibleMissing = false
    for (let r = firstRow; r <= lastRow && !anyVisibleMissing; r++) {
      for (let c = firstCol; c <= lastCol; c++) {
        const entry = ensureTile(r, c)
        if (!entry || entry.tier === 0) {
          anyVisibleMissing = true
          break
        }
      }
    }

    // The preview stays resident for the renderer's whole life rather than being
    // freed once the tiles land. At 768x543 it costs 1.6 MB — nothing against
    // ~81 MB per tile — and keeping it means every path that resets tiles to
    // tier 0 (context recovery, release-on-hide) redraws through a correct
    // low-res map instead of blank placeholders. ensurePreview() is idempotent,
    // so calling it here also covers a renderer whose first load failed.
    if (anyVisibleMissing) {
      if (!previewTexture) ensurePreview()
      if (previewTexture) {
        twgl.setUniforms(programInfo, {
          u_tileOffset: [0, 0],
          u_tileSize: [mapW, mapH],
          u_transform: mat,
          u_texture: previewTexture
        })
        twgl.drawBufferInfo(twglGl, quadVao, gl.TRIANGLE_STRIP)
      }
    }

    for (let r = firstRow; r <= lastRow; r++) {
      const tileY = r * tileH
      for (let c = firstCol; c <= lastCol; c++) {
        const tileX = c * tileW

        const entry = ensureTile(r, c)
        if (!entry) continue
        const texture = entry.tier > 0 ? entry.texture : placeholder

        twgl.setUniforms(programInfo, {
          u_tileOffset: [tileX, tileY],
          u_tileSize: [tileW, tileH],
          u_transform: mat,
          u_texture: texture
        })
        twgl.drawBufferInfo(twglGl, quadVao, gl.TRIANGLE_STRIP)

        // Don't start tile fetches the preview is about to make redundant. This
        // is the zoomed-out first frame, before ensurePreview() has resolved:
        // without this the renderer requests the whole grid and then frees it
        // a frame later, spending real bandwidth on textures never drawn.
        if (previewOnly) continue

        if (entry.tier < currentTier && entry.pendingTier !== currentTier) {
          void requestTier(r, c, currentTier)
        }
      }
    }

    // Every visible tile now carries this frame's stamp, so anything older is
    // off-screen and safe to reclaim.
    downgradeOverResolvedTiles(currentTier)
    evictTiles()

    drawOverlays(mat, transform, cssW, cssH, selection)
  }

  // Hitbox debug fill and the selection spotlight. Split out of draw() so the
  // preview-only path can draw them too — a station stays selectable and
  // spotlit when zoomed out, where no tiles are resident at all.
  function drawOverlays(
    mat: Float32Array,
    transform: Transform,
    cssW: number,
    cssH: number,
    selection?: SelectionOverlay | null
  ) {
    if (debugHitboxes && pillVao && points.length > 0) {
      gl.useProgram(pillProgramInfo.program)
      twgl.setBuffersAndAttributes(twglGl, pillProgramInfo, pillVao)
      twgl.setUniforms(pillProgramInfo, {
        u_transform: mat,
        u_color: [1.0, 0.0, 0.6, 0.3],
        u_edgeSoftnessWorld: 1.0 / transform.scale
      })
      twgl.drawBufferInfo(twglGl, pillVao, gl.TRIANGLES)
    }

    if (selection && (selection.scrimAlpha > 0 || selection.ringProgress > 0)) {
      gl.useProgram(spotProgramInfo.program)
      twgl.setBuffersAndAttributes(twglGl, spotProgramInfo, spotVao)
      twgl.setUniforms(spotProgramInfo, {
        u_viewport: [cssW, cssH],
        u_view: [transform.tx, transform.ty, transform.scale],
        u_selA: [selection.ax, selection.ay],
        u_selB: [selection.bx, selection.by],
        u_selR: selection.r,
        u_selCr: selection.cr,
        u_scrimAlpha: selection.scrimAlpha,
        u_feather: SPOTLIGHT_FEATHER_WORLD,
        u_ringColor: selection.color,
        u_ringOffset: ringOffsetWorld(selection.ringProgress),
        u_ringWidth: RING_WIDTH_WORLD,
        u_ringAlpha: selection.ringProgress
      })
      twgl.drawBufferInfo(twglGl, spotVao, gl.TRIANGLE_STRIP)
    }
  }

  function setPoints(next: Point[]) {
    points = next
    rebuildPillBuffers()
    onDirty()
  }

  function setDebugHitboxes(enabled: boolean) {
    debugHitboxes = enabled
    onDirty()
  }

  // Drop every tile's pixels but keep the context, its programs and its buffers
  // — those are kilobytes, the tiles are hundreds of megabytes. draw() re-requests
  // whatever is on screen and the preview underlay covers the gap meanwhile.
  function releaseTiles() {
    if (disposed) return
    for (const entry of tiles.values()) gl.deleteTexture(entry.texture)
    tiles.clear()
    onDirty()
  }

  function tileStats(): TileStats {
    let bytes = 0
    for (const entry of tiles.values()) bytes += entry.bytes
    return { count: tiles.size, bytes }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    for (const entry of tiles.values()) gl.deleteTexture(entry.texture)
    gl.deleteTexture(placeholder)
    releasePreview()
    tiles.clear()
    if (pillBufferInfo) {
      for (const k in pillBufferInfo.attribs) {
        const buf = pillBufferInfo.attribs[k].buffer
        if (buf) gl.deleteBuffer(buf)
      }
      if (pillBufferInfo.indices) gl.deleteBuffer(pillBufferInfo.indices)
      pillBufferInfo = null
    }
    if (pillVao && pillVao.vertexArrayObject) {
      gl.deleteVertexArray(pillVao.vertexArrayObject)
      pillVao = null
    }
    if (quadVao.vertexArrayObject) {
      gl.deleteVertexArray(quadVao.vertexArrayObject)
    }
    if (spotVao.vertexArrayObject) {
      gl.deleteVertexArray(spotVao.vertexArrayObject)
    }
    for (const k in spotBufferInfo.attribs) {
      const buf = spotBufferInfo.attribs[k].buffer
      if (buf) gl.deleteBuffer(buf)
    }
    tileSource.dispose()
    // Hand the drawing buffer and the context slot back now rather than waiting
    // for GC to collect the canvas. Browsers cap live WebGL contexts per page,
    // and routing in and out of /map repeatedly would otherwise creep up on it.
    //
    // Only for a canvas that has already left the document, though: a canvas
    // keeps handing the *same* context object back from getContext() forever, so
    // losing it would poison any renderer built on that element afterwards.
    // Detached means nothing can build on it again. Note this fires
    // webglcontextlost, so callers must detach their listener first.
    if (!canvas.isConnected && !gl.isContextLost()) loseCtxExt?.loseContext()
  }

  ensurePreview()

  return {
    kind: 'webgl2',
    draw,
    resize,
    requestTier: (r, c, tier) => { void requestTier(r, c, tier) },
    setPoints,
    setDebugHitboxes,
    isContextLost: () => gl.isContextLost(),
    releaseTiles,
    isPreviewReady: () => previewTexture !== null,
    tileStats,
    debug: loseCtxExt
      ? {
          loseContext: () => loseCtxExt.loseContext(),
          restoreContext: () => loseCtxExt.restoreContext()
        }
      : undefined,
    dispose
  }
}

function createPlaceholderTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, PLACEHOLDER_PIXEL)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

function buildTransformMat3(transform: Transform, cssW: number, cssH: number): Float32Array {
  const { tx, ty, scale } = transform
  const sx = 2 / cssW
  const sy = -2 / cssH
  const a = scale * sx
  const d = scale * sy
  const e = tx * sx - 1
  const f = ty * sy + 1
  return new Float32Array([
    a, 0, 0,
    0, d, 0,
    e, f, 1
  ])
}
