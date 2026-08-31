import * as twgl from 'twgl.js'
import type { CutShape, LineIsolateOverlay, Manifest, Point, Renderer, RouteDrawItem, RouteOverlay, RouteOverlayFrame, SelectionOverlay, Tier, TileStats, Transform } from './map-renderer'
import {
  PHONE_TILE_BUDGET_CEILING_BYTES,
  RING_WIDTH_WORLD,
  mapTreatment,
  pointCornerRadius,
  ringOffsetWorld,
  routeDrawItems,
  tileBudgetBytes,
  tileKey
} from './map-renderer'
import { createTileSource } from './map-renderer-tile-source'

const VS = `#version 300 es
in vec2 a_position;
in vec2 a_texcoord;
uniform vec2 u_tileOffset;
uniform vec2 u_tileSize;
uniform mat3 u_transform;
out vec2 v_texcoord;
// World position of this fragment, so the tile shader can evaluate the
// selection cutout's SDF. The vertex shader already computed it; it just never
// had a reason to hand it downstream before.
out vec2 v_world;
void main() {
  vec2 world = u_tileOffset + a_position * u_tileSize;
  vec3 clip = u_transform * vec3(world, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_texcoord = a_texcoord;
  v_world = world;
}
`

// Shared rounded-rect SDF (world units, negative inside). Injected into every
// fragment shader that needs a boundary — tile cutout, pill fills, hitbox
// debug and the spotlight ring — so all four agree on the exact same edge.
//
// Declared above the tile shader rather than beside the pill shaders because
// the tile shader interpolates it too, and a `const` referenced before its
// declaration inside a template literal throws at module init.
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

const FS = `#version 300 es
precision highp float;
in vec2 v_texcoord;
uniform sampler2D u_texture;
// 0 = the artwork's own colour, 1 = fully grey. Rec.709 luma, which is the
// matrix CSS saturate() uses — the Canvas2D fallback desaturates with that
// filter, so sharing the coefficients is what stops the two renderers drifting
// apart in hue at intermediate values.
uniform float u_desaturate;
// 0 = the artwork at full strength, 1 = flat page white. Draining colour alone
// leaves every stroke as dark as it started, so a desaturated schematic is just
// as busy as a coloured one — this is what actually makes the map recede.
uniform float u_fade;
/*
 * The cutout mask: where the fade is cancelled, in screen space.
 *
 * This lives in the TILE shader, which looks like the wrong place until you try
 * the obvious alternative. The fade is applied to the tile's own pixels here, so
 * by the time any overlay draws, the contrast is already gone — punching a hole
 * in an overlay can only reveal the map at whatever strength the tiles were
 * drawn, never restore what this shader destroyed. So the mask has to be applied
 * at the same moment as the fade it cancels. Resist folding it back into the
 * spotlight pass.
 *
 * A sampled mask rather than the two inline SDFs this started as. Isolating a
 * line is a few hundred shapes, and evaluating that many distance functions per
 * fragment across the whole viewport is not affordable. Drawing them once into
 * an R8 target and reading one texel here is, and it stays exact at every zoom
 * because the mask is rendered through the same transform as the tiles.
 *
 * u_cutMaskOn == 0.0 disables it, which is the nothing-selected case.
 */
uniform sampler2D u_cutMask;
uniform float u_cutMaskOn;
uniform vec2 u_viewportPx;
in vec2 v_world;
out vec4 outColor;
${SHAPE_SDF_GLSL}
void main() {
  vec4 c = texture(u_texture, v_texcoord);
  // 1 where the artwork keeps its full strength, 0 where the fade applies. The
  // mask is drawn at exactly the drawing-buffer size, so this is a 1:1 lookup.
  float keep = 1.0;
  if (u_cutMaskOn > 0.0) {
    keep = 1.0 - texture(u_cutMask, gl_FragCoord.xy / u_viewportPx).r;
  }
  float desaturate = u_desaturate * keep;
  float fade = u_fade * keep;
  float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  // Textures are uploaded premultiplied, so the grey has to be weighted by alpha
  // to stay in that space. A no-op for the opaque WebP tiers; it matters for the
  // runtime-rasterized SVG tier, which would otherwise halo at tile edges.
  vec3 rgb = mix(c.rgb, vec3(luma) * c.a, desaturate);
  // Same premultiplied reasoning as above: white is (1,1,1) * a in that space.
  outColor = vec4(mix(rgb, vec3(c.a), fade), c.a);
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

/*
 * The cutout mask pass: coverage for every hole punched in the fade.
 *
 * Reuses PILL_VS's per-instance capsule attributes, but expands the quad by the
 * feather — PILL_VS sizes its quad to the shape's own bounds, which would clip
 * the feathered falloff off at the edge — while still measuring distance to the
 * unexpanded shape.
 *
 * Writes coverage rather than distance because the shapes are unioned by
 * BLENDING with gl.MAX, and a max of coverage is a union. Distance would want
 * gl.MIN against a clear of +infinity, which R8 cannot represent.
 */
const MASK_VS = `#version 300 es
in vec2 a_quad; // -1..1 unit quad
in vec2 a_axisA;
in vec2 a_axisB;
in float a_radius;
in float a_cornerRadius;
in float a_alpha;
uniform mat3 u_transform;
uniform float u_feather; // world units
out vec2 v_local;
out vec2 v_axisA;
out vec2 v_axisB;
out float v_radius;
out float v_cornerRadius;
out float v_alpha;
void main() {
  vec2 axis = a_axisB - a_axisA;
  float len = length(axis);
  vec2 dir = len > 0.0 ? axis / len : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 center = (a_axisA + a_axisB) * 0.5;
  // Minkowski-expanded by the feather so the falloff has somewhere to be drawn.
  float halfLen = len * 0.5 + a_radius + u_feather;
  vec2 world = center + dir * (a_quad.x * halfLen) + perp * (a_quad.y * (a_radius + u_feather));
  vec3 clip = u_transform * vec3(world, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_local = world;
  v_axisA = a_axisA;
  v_axisB = a_axisB;
  v_radius = a_radius;
  v_cornerRadius = a_cornerRadius;
  v_alpha = a_alpha;
}
`

const MASK_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in vec2 v_axisA;
in vec2 v_axisB;
in float v_radius;
in float v_cornerRadius;
in float v_alpha;
uniform float u_feather;
out vec4 outColor;
${SHAPE_SDF_GLSL}
void main() {
  float d = shapeDistance(v_local, v_axisA, v_axisB, v_radius, v_cornerRadius);
  // 1 inside the shape, falling to 0 across the feather — the exact complement
  // of the smoothstep the tile shader used to compute inline, so the boundary is
  // unchanged from the two-shape version.
  // Scaled by the shape's own alpha so a cutout can fade in and out. The
  // geometry never changes: a corridor capsule's radius IS the stroke's
  // half-width, so animating that would thin the line rather than fade it.
  float cover = (1.0 - smoothstep(0.0, u_feather, d)) * v_alpha;
  if (cover <= 0.0) discard;
  outColor = vec4(cover, 0.0, 0.0, 1.0);
}
`

// Selection spotlight: one fullscreen pass drawn last, drawing the glowing halo
// ring around the selected capsule. The capsule arrives via uniforms — no
// per-selection buffers.
//
// The dim this pass used to carry is gone: isolating the selection is now the
// tile shader's job (see u_cutFeather in FS), because a fade has to be cancelled
// where it is applied. What is left here is purely additive light, which is why
// the pass runs on ringProgress alone.
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
uniform vec3 u_ringColor;
uniform float u_ringOffset;
uniform float u_ringWidth;
uniform float u_ringAlpha;
uniform float u_selCr;
out vec4 outColor;
${SHAPE_SDF_GLSL}
void main() {
  float d = shapeDistance(v_world, u_selA, u_selB, u_selR, u_selCr); // signed dist to shape edge
  // Glowing ring centered u_ringOffset outside the capsule edge.
  float ring = (1.0 - smoothstep(0.0, u_ringWidth, abs(d - u_ringOffset))) * u_ringAlpha;
  // Soft outer glow hugging the ring.
  float glow = exp(-max(d - u_ringOffset, 0.0) / (u_ringWidth * 2.5)) * 0.35 * u_ringAlpha;
  float a = ring + glow;
  outColor = vec4(u_ringColor * a, a); // premultiplied
}
`

// Flat dim drawn UNDER the route overlay. Unlike the selection spotlight there
// is no punch-out: the route's full-opacity capsules sit on top of the dim, so
// the route pops without an N-segment SDF loop in a fullscreen pass.
const SCRIM_VS = `#version 300 es
in vec2 a_position; // 0..1 fullscreen quad
void main() {
  gl_Position = vec4(a_position.x * 2.0 - 1.0, 1.0 - a_position.y * 2.0, 0.0, 1.0);
}
`

const SCRIM_FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 outColor;
void main() {
  outColor = vec4(u_color.rgb * u_color.a, u_color.a); // premultiplied
}
`

// The route scrim's navy. Retained at zero strength (ROUTE_SCRIM_MAX_ALPHA), so
// this never actually draws — see the note on that constant for why the whole
// mechanism survives behind one number. Shared with the route's pin ink.
const SCRIM_RGB = [0.06, 0.09, 0.16]

interface TileEntry {
  texture: WebGLTexture
  tier: Tier | 0
  pendingTier: Tier | null
  mipmapped: boolean
  // Whether the uploaded texture is alpha-free (the pre-rasterized WebPs) or
  // genuinely transparent (a runtime-rasterized SVG). The draw pass turns
  // blending on only when a visible tile needs it; see the tile loop.
  opaque: boolean
  // GPU bytes this entry currently holds, for tileStats(). Tracked rather than
  // recomputed because the tier alone doesn't tell you whether the upload has
  // landed yet.
  bytes: number
  // Frame counter at the last draw that touched this tile. Eviction sorts by
  // this, so "least recently on screen" is what gets dropped first.
  lastUsed: number
}

// The resident-tile budget is derived per frame from the visible working set —
// see tileBudgetBytes() in map-renderer.ts. Nothing evicted at all before a
// budget existed: draw() only ever upgraded tiles, so panning around at zoom
// accumulated the whole grid at full tier (~683 MB on the 8x8 map) and held it
// for the renderer's life, which is what got a context killed on a Galaxy S23.

// Bound on tile loading in flight.
//
// Without a bound, draw() fires a request for every visible tile needing an
// upgrade. Crossing a tier boundary on a pinch is 6-8 tiles, and each lands a
// texImage2D of a multi-megapixel bitmap plus a generateMipmap on the main
// thread, in whatever turn its promise resolves — so they pile into one frame.
// The tiles are ~158 KB on the wire: the network is not the constraint, the GL
// work is.
//
// Two concurrent loads keeps one fetch in flight while the other uploads, which
// hides mobile round-trip latency without stacking GL work, and bounds the
// transient decoded bitmaps at two rather than the whole visible set.
const MAX_CONCURRENT_TILE_LOADS = 2

// One upload per frame is the cap that actually bounds the per-frame stall.
// Eight tiles then arrive staggered across eight frames instead of freezing one,
// and the preview underlay is what makes that staggering acceptable to look at.
const MAX_UPLOADS_PER_FRAME = 1

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
  onDirty: () => void,
  // Device policy lives with the caller, which is what knows the viewport and
  // the tier cap; the renderer only does the accounting. Defaults to the phone
  // ceiling so an omitted option is the conservative one.
  budgetCeilingBytes: number = PHONE_TILE_BUDGET_CEILING_BYTES
): Renderer {
  const deviceMemoryGb = (navigator as { deviceMemory?: number }).deviceMemory
  // No MSAA: the tile quads are axis-aligned and screen-filling, so their edges
  // are never visible, and the pill/spotlight shaders antialias analytically
  // with smoothstep. Enabling it bought nothing and cost a multisampled
  // renderbuffer plus its resolve target — tens of MB on a phone, on a screen
  // that is already short of GPU memory (see tileStats()).
  // alpha: false — nothing is meant to show through the map. The canvas is
  // absolutely positioned over a white <main>, the splash/morph overlay
  // composites above it rather than below, and every frame starts with an
  // opaque white clear. Declaring the drawing buffer opaque lets the compositor
  // skip blending a full-screen layer over the page on every frame and lets
  // that layer occlude what is behind it.
  const rawGl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
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
  const maskProgramInfo = twgl.createProgramInfo(twglGl, [MASK_VS, MASK_FS])

  /*
   * The cutout mask target. Allocated lazily on the first frame that actually
   * has a cutout, so a map with nothing selected never pays for it, and released
   * alongside the tiles because it is exactly the kind of GPU memory that path
   * exists to hand back.
   */
  let maskTexture: WebGLTexture | null = null
  let maskFramebuffer: WebGLFramebuffer | null = null
  let maskWidth = 0
  let maskHeight = 0
  let maskBufferInfo: twgl.BufferInfo | null = null
  let maskVao: twgl.VertexArrayInfo | null = null
  let maskShapes: CutShape[] = []
  let maskShapesDirty = false
  const spotBufferInfo = twgl.createBufferInfoFromArrays(twglGl, {
    a_position: { numComponents: 2, data: [0, 0, 1, 0, 0, 1, 1, 1] }
  })
  const spotVao = twgl.createVertexArrayInfo(twglGl, spotProgramInfo, spotBufferInfo)

  // Route scrim shares the spotlight's fullscreen-quad buffers; only the
  // program (and its VAO binding) differs.
  const scrimProgramInfo = twgl.createProgramInfo(twglGl, [SCRIM_VS, SCRIM_FS])
  const scrimVao = twgl.createVertexArrayInfo(twglGl, scrimProgramInfo, spotBufferInfo)

  const loseCtxExt = gl.getExtension('WEBGL_lose_context')

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
  let surfaceVisible = true

  // Route overlay geometry: capsule quads through the PILL program, one draw
  // range per run of same-colored items (color is a uniform, not an attribute;
  // a route has a handful of color runs, so this stays a few draw calls).
  let routeItems: RouteDrawItem[] = []
  let routeBufferInfo: twgl.BufferInfo | null = null
  let routeVao: twgl.VertexArrayInfo | null = null
  let routeRanges: Array<{ byteOffset: number, count: number, color: [number, number, number] }> = []

  function deleteBufferInfo(info: twgl.BufferInfo) {
    // twgl doesn't expose a delete helper for BufferInfo; free the raw buffers.
    for (const k in info.attribs) {
      const buf = info.attribs[k].buffer
      if (buf) gl.deleteBuffer(buf)
    }
    if (info.indices) gl.deleteBuffer(info.indices)
  }

  function rebuildPillBuffers() {
    if (pillBufferInfo) {
      deleteBufferInfo(pillBufferInfo)
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

  // Same quad scheme as the pills, but for the route's paint list. Every item
  // is a capsule (cornerRadius = radius), including the pin discs, whose
  // endpoints coincide.
  /*
   * Quads for the cutout shapes. Rebuilt only when the shape list changes, not
   * per frame: a held selection or a standing isolate re-renders the same
   * geometry every frame and there is nothing to re-upload.
   */
  // Whether the cutout geometry actually changed. A held selection or a standing
  // isolate hands over an equal list every frame, and rebuilding buffers for that
  // would re-upload identical geometry at 60 Hz.
  function sameShapes(a: readonly CutShape[], b: readonly CutShape[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      const p = a[i]
      const q = b[i]
      if (p === q) continue
      if (p.ax !== q.ax || p.ay !== q.ay || p.bx !== q.bx || p.by !== q.by || p.r !== q.r || p.cr !== q.cr) return false
      // Alpha too: it is the only thing that changes while a cutout fades, so
      // omitting it here would report every frame of the fade as unchanged and
      // the buffers would never be rebuilt — the fade would simply not happen.
      if ((p.alpha ?? 1) !== (q.alpha ?? 1)) return false
    }
    return true
  }

  function rebuildMaskBuffers() {
    if (maskBufferInfo) {
      deleteBufferInfo(maskBufferInfo)
      maskBufferInfo = null
    }
    if (maskVao && maskVao.vertexArrayObject) {
      gl.deleteVertexArray(maskVao.vertexArrayObject)
      maskVao = null
    }
    maskShapesDirty = false
    const n = maskShapes.length
    if (n === 0) return
    const quadData = new Float32Array(n * 4 * 2)
    const axisAData = new Float32Array(n * 4 * 2)
    const axisBData = new Float32Array(n * 4 * 2)
    const radiusData = new Float32Array(n * 4)
    const cornerRadiusData = new Float32Array(n * 4)
    const alphaData = new Float32Array(n * 4)
    const indices = new Uint16Array(n * 6)
    const quadCorners = [-1, -1, 1, -1, -1, 1, 1, 1]
    for (let i = 0; i < n; i++) {
      const shape = maskShapes[i]
      for (let v = 0; v < 4; v++) {
        quadData[i * 8 + v * 2 + 0] = quadCorners[v * 2 + 0]
        quadData[i * 8 + v * 2 + 1] = quadCorners[v * 2 + 1]
        axisAData[i * 8 + v * 2 + 0] = shape.ax
        axisAData[i * 8 + v * 2 + 1] = shape.ay
        axisBData[i * 8 + v * 2 + 0] = shape.bx
        axisBData[i * 8 + v * 2 + 1] = shape.by
        radiusData[i * 4 + v] = shape.r
        cornerRadiusData[i * 4 + v] = shape.cr
        // Undefined means a plain, fully-punched hole.
        alphaData[i * 4 + v] = shape.alpha ?? 1
      }
      const base = i * 4
      indices[i * 6 + 0] = base + 0
      indices[i * 6 + 1] = base + 1
      indices[i * 6 + 2] = base + 2
      indices[i * 6 + 3] = base + 2
      indices[i * 6 + 4] = base + 1
      indices[i * 6 + 5] = base + 3
    }
    maskBufferInfo = twgl.createBufferInfoFromArrays(twglGl, {
      a_quad: { numComponents: 2, data: quadData },
      a_axisA: { numComponents: 2, data: axisAData },
      a_axisB: { numComponents: 2, data: axisBData },
      a_radius: { numComponents: 1, data: radiusData },
      a_cornerRadius: { numComponents: 1, data: cornerRadiusData },
      a_alpha: { numComponents: 1, data: alphaData },
      indices: { numComponents: 3, data: indices }
    })
    maskVao = twgl.createVertexArrayInfo(twglGl, maskProgramInfo, maskBufferInfo)
  }

  function releaseMaskTarget() {
    if (maskFramebuffer) {
      gl.deleteFramebuffer(maskFramebuffer)
      maskFramebuffer = null
    }
    if (maskTexture) {
      gl.deleteTexture(maskTexture)
      maskTexture = null
    }
    maskWidth = 0
    maskHeight = 0
  }

  // Sized to the drawing buffer so the tile shader's lookup is 1:1 with
  // gl_FragCoord. Reallocated when the canvas resizes; R8 because coverage is
  // one channel and this is the largest thing the feature allocates.
  function ensureMaskTarget(w: number, h: number): boolean {
    if (gl.isContextLost()) return false
    if (maskFramebuffer && maskWidth === w && maskHeight === h) return true
    releaseMaskTarget()
    const texture = gl.createTexture()
    if (!texture) return false
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const framebuffer = gl.createFramebuffer()
    if (!framebuffer) {
      gl.deleteTexture(texture)
      return false
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    if (!ok) {
      gl.deleteFramebuffer(framebuffer)
      gl.deleteTexture(texture)
      return false
    }
    maskTexture = texture
    maskFramebuffer = framebuffer
    maskWidth = w
    maskHeight = h
    return true
  }

  /*
   * Draw every cutout shape into the mask, unioned.
   *
   * Union comes from gl.MAX blending rather than from a min() of distances:
   * overlapping shapes must not accumulate, and a max of coverage is exactly the
   * union regardless of draw order. blendEquation is sticky context state, so it
   * is restored before returning — the same hazard the blendFunc note above
   * warns about.
   *
   * Returns false when the mask could not be produced, which makes the tile pass
   * fall back to fading everything rather than to a half-drawn cutout.
   */
  function renderMask(mat: twgl.m4.Mat4 | number[], drawW: number, drawH: number, feather: number): boolean {
    if (maskShapesDirty) rebuildMaskBuffers()
    if (!maskVao || maskShapes.length === 0) return false
    if (!ensureMaskTarget(drawW, drawH)) return false

    gl.bindFramebuffer(gl.FRAMEBUFFER, maskFramebuffer)
    gl.viewport(0, 0, drawW, drawH)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.MAX)
    gl.useProgram(maskProgramInfo.program)
    twgl.setBuffersAndAttributes(twglGl, maskProgramInfo, maskVao)
    twgl.setUniforms(maskProgramInfo, {
      u_transform: mat,
      u_feather: feather
    })
    twgl.drawBufferInfo(twglGl, maskVao, gl.TRIANGLES)
    gl.blendEquation(gl.FUNC_ADD)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, drawW, drawH)
    return true
  }

  function rebuildRouteBuffers() {
    if (routeBufferInfo) {
      deleteBufferInfo(routeBufferInfo)
      routeBufferInfo = null
    }
    if (routeVao && routeVao.vertexArrayObject) {
      gl.deleteVertexArray(routeVao.vertexArrayObject)
      routeVao = null
    }
    routeRanges = []
    if (routeItems.length === 0) return
    const n = routeItems.length
    const quadData = new Float32Array(n * 4 * 2)
    const axisAData = new Float32Array(n * 4 * 2)
    const axisBData = new Float32Array(n * 4 * 2)
    const radiusData = new Float32Array(n * 4)
    const cornerRadiusData = new Float32Array(n * 4)
    const indices = new Uint16Array(n * 6)
    const quadCorners = [-1, -1, 1, -1, -1, 1, 1, 1]
    for (let i = 0; i < n; i++) {
      const item = routeItems[i]
      for (let v = 0; v < 4; v++) {
        quadData[i * 8 + v * 2 + 0] = quadCorners[v * 2 + 0]
        quadData[i * 8 + v * 2 + 1] = quadCorners[v * 2 + 1]
        axisAData[i * 8 + v * 2 + 0] = item.ax
        axisAData[i * 8 + v * 2 + 1] = item.ay
        axisBData[i * 8 + v * 2 + 0] = item.bx
        axisBData[i * 8 + v * 2 + 1] = item.by
        radiusData[i * 4 + v] = item.r
        cornerRadiusData[i * 4 + v] = item.r
      }
      const base = i * 4
      indices[i * 6 + 0] = base + 0
      indices[i * 6 + 1] = base + 1
      indices[i * 6 + 2] = base + 2
      indices[i * 6 + 3] = base + 2
      indices[i * 6 + 4] = base + 1
      indices[i * 6 + 5] = base + 3

      const last = routeRanges[routeRanges.length - 1]
      const [cr, cg, cb] = item.color
      if (last && last.color[0] === cr && last.color[1] === cg && last.color[2] === cb) {
        last.count += 6
      } else {
        // drawElements takes a BYTE offset; Uint16 indices are 2 bytes each.
        routeRanges.push({ byteOffset: i * 6 * 2, count: 6, color: item.color })
      }
    }
    routeBufferInfo = twgl.createBufferInfoFromArrays(twglGl, {
      a_quad: { numComponents: 2, data: quadData },
      a_axisA: { numComponents: 2, data: axisAData },
      a_axisB: { numComponents: 2, data: axisBData },
      a_radius: { numComponents: 1, data: radiusData },
      a_cornerRadius: { numComponents: 1, data: cornerRadiusData },
      indices: { numComponents: 3, data: indices }
    })
    routeVao = twgl.createVertexArrayInfo(twglGl, pillProgramInfo, routeBufferInfo)
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
      // opaque starts true so a tier-0 tile — which is never drawn — can't force
      // blending on for the whole frame before it has any pixels to blend.
      entry = {
        texture,
        tier: 0,
        pendingTier: null,
        mipmapped: false,
        opaque: true,
        bytes: 0,
        lastUsed: frameCounter
      }
      tiles.set(key, entry)
    }
    entry.lastUsed = frameCounter
    return entry
  }

  // Release off-screen tiles held at a finer tier than the current view would
  // ask for. Without this, zooming deep into one corner and back out pins those
  // tiles at tier 2 (~10.7 MB each) forever: nothing downgrades, and the only
  // tier transition in draw() is an upgrade.
  //
  // The pixels are dropped rather than re-uploaded at the coarser tier: the
  // tile is off-screen, so the cheapest correct thing is to let draw() re-request
  // it at whatever tier is right if it ever comes back. On-screen tiles are left
  // alone even when over-resolved — they are already drawn, and swapping them to
  // the placeholder would flash a blank tile under the user.
  function downgradeOverResolvedTiles(currentTier: Tier) {
    for (const [key, entry] of tiles) {
      if (entry.lastUsed === frameCounter || entry.pendingTier !== null) continue
      // An off-screen entry that never received pixels is pure bookkeeping — a
      // 1x1 texture and a Map slot. It costs nothing to rebuild lazily, and
      // leaving it resident makes tileStats().count report tiles that hold no
      // map. These accumulate now that uploads are paced: a tile can be
      // scanned, entered and then panned away from before its turn came up.
      if (entry.tier === 0) {
        gl.deleteTexture(entry.texture)
        tiles.delete(key)
        continue
      }
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
  function evictTiles(budget: number) {
    let bytes = 0
    for (const entry of tiles.values()) bytes += entry.bytes
    if (bytes <= budget) return

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
      if (bytes <= budget) break
      gl.deleteTexture(entry.texture)
      tiles.delete(key)
      bytes -= entry.bytes
    }
  }

  // A tile whose pixels are on the way, or already decoded and waiting for the
  // frame that will upload them.
  interface QueuedTile {
    r: number
    c: number
    tier: Tier
    entry: TileEntry
    // Squared distance from the viewport centre, in tile widths. Lower goes
    // first, so what the user is looking at sharpens before the edges do.
    priority: number
  }

  interface ReadyTile extends QueuedTile {
    bitmap: ImageBitmap
    opaque: boolean
  }

  const requestQueue: QueuedTile[] = []
  const readyUploads: ReadyTile[] = []
  let inFlight = 0
  let totalUploadMs = 0

  // Claim the upgrade. pendingTier is set here rather than when the fetch
  // actually starts, because it is what dedupes repeat requests across frames
  // and what exempts the entry from both reclaim sweeps while its pixels are in
  // transit — an entry queued but not yet started must not be evicted.
  function enqueueTier(r: number, c: number, tier: Tier, entry: TileEntry, priority: number) {
    entry.pendingTier = tier
    requestQueue.push({ r, c, tier, entry, priority })
  }

  function cancelQueued(q: QueuedTile) {
    // Guarded: a newer enqueue for the same entry may already own pendingTier,
    // and clearing it blindly would strand that request's eviction exemption.
    if (q.entry.pendingTier === q.tier) q.entry.pendingTier = null
  }

  // Drop pending work the view has moved past. All three rules are required:
  // the tier check alone leaves an off-screen tile queued forever at a matching
  // tier, and because pendingTier stays set it would be exempt from both
  // reclaim sweeps — turning the eviction exemption into a leak.
  //
  // Both lists are swept, not just the queue. A decoded bitmap waiting for its
  // upload slot pins its entry the same way, and uploading a tile that has
  // already been panned off screen is precisely the wasted GL work the pacing
  // exists to avoid.
  function isStale(q: QueuedTile, currentTier: Tier): boolean {
    // ensureTile() stamps lastUsed on every tile in this frame's visible span,
    // so an older stamp means the tile has been panned off screen.
    return q.tier !== currentTier
      || q.entry.lastUsed !== frameCounter
      || tiles.get(tileKey(q.r, q.c)) !== q.entry
  }

  function prunePendingLoads(currentTier: Tier) {
    for (let i = requestQueue.length - 1; i >= 0; i--) {
      const q = requestQueue[i]
      if (!isStale(q, currentTier)) continue
      requestQueue.splice(i, 1)
      cancelQueued(q)
    }
    for (let i = readyUploads.length - 1; i >= 0; i--) {
      const ready = readyUploads[i]
      if (!isStale(ready, currentTier)) continue
      readyUploads.splice(i, 1)
      ready.bitmap.close?.()
      cancelQueued(ready)
    }
  }

  function pumpQueue() {
    while (inFlight < MAX_CONCURRENT_TILE_LOADS && requestQueue.length > 0) {
      let best = 0
      for (let i = 1; i < requestQueue.length; i++) {
        if (requestQueue[i].priority < requestQueue[best].priority) best = i
      }
      const q = requestQueue.splice(best, 1)[0]
      // Cancelled between enqueue and start.
      if (q.entry.pendingTier !== q.tier) continue
      inFlight++
      void startLoad(q)
    }
  }

  async function startLoad(q: QueuedTile): Promise<void> {
    try {
      const { bitmap, opaque } = await tileSource.loadTile(q.r, q.c, q.tier)
      // Identity re-check, not just pendingTier: releaseTiles() can delete this
      // entry and its texture while the fetch is in flight, and the replacement
      // entry is a different object with pendingTier === null. Uploading into
      // the deleted texture would be a GL error and the pixels would be lost.
      const usable = !disposed
        && !gl.isContextLost()
        && tiles.get(tileKey(q.r, q.c)) === q.entry
        && q.entry.pendingTier === q.tier
      if (!usable) {
        bitmap.close?.()
        cancelQueued(q)
        return
      }
      readyUploads.push({ ...q, bitmap, opaque })
      // Wake the loop: the upload itself happens in the next draw, which is
      // what keeps a burst of arrivals from landing in one frame.
      onDirty()
    } catch (err) {
      cancelQueued(q)
      console.warn(`Tile ${q.r},${q.c} tier ${q.tier} load failed`, err)
    } finally {
      inFlight--
      pumpQueue()
    }
  }

  // Upload at most MAX_UPLOADS_PER_FRAME decoded tiles. This is the cap that
  // actually bounds the per-frame main-thread stall: one texImage2D of a
  // multi-megapixel bitmap plus one generateMipmap.
  function drainUploads() {
    let uploaded = 0
    while (uploaded < MAX_UPLOADS_PER_FRAME && readyUploads.length > 0) {
      uploadTile(readyUploads.shift()!)
      uploaded++
    }
  }

  function uploadTile(ready: ReadyTile) {
    const { entry, tier, bitmap, opaque } = ready
    // Re-check on the way in as well as on the way out of the fetch: an
    // arbitrary number of frames can pass between the two, and releaseTiles()
    // or a tier change in that window invalidates this upload.
    if (
      disposed
      || gl.isContextLost()
      || tiles.get(tileKey(ready.r, ready.c)) !== entry
      || entry.pendingTier !== tier
    ) {
      bitmap.close?.()
      cancelQueued(ready)
      return
    }
    const uploadStart = performance.now()
    try {
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
      // LINEAR_MIPMAP_LINEAR instead of aliasing into jagged lines under plain
      // LINEAR. (WebGL2 allows mipmaps on NPOT textures.)
      //
      // Deliberately no anisotropic filtering. It only does anything when the
      // sample footprint is elongated, and this projection cannot elongate one:
      // buildTransformMat3 writes no rotation or skew, and u_tileSize against
      // the texture's own size makes texels-per-world-unit exactly `tier` on
      // both axes. The footprint is an axis-aligned square at every fragment,
      // so the anisotropy ratio is identically 1 and the parameter was inert.
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      entry.mipmapped = true
      entry.tier = tier
      entry.pendingTier = null
      entry.opaque = opaque
      entry.bytes = textureBytes(bitmap.width, bitmap.height, entry.mipmapped, opaque ? 2 : 4)
      onDirty()
    } catch (err) {
      entry.pendingTier = null
      console.warn(`Tile ${ready.r},${ready.c} tier ${tier} upload failed`, err)
    } finally {
      // Measured around the whole GL block, so it captures generateMipmap as
      // well as the texImage2D — on a 4 megapixel tile the mipmap generation is
      // the larger half, and both land on the thread that owns the context.
      totalUploadMs += performance.now() - uploadStart
      // Closed on every path, including the throw: the old code leaked a
      // decoded bitmap whenever the upload itself failed.
      bitmap.close?.()
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
      // Same reasoning as the opaque tile path: preview.webp is built from the
      // master SVG onto a white fill and carries no alpha channel, so 16bpp
      // costs only colour depth and halves a texture that stays resident for
      // the renderer's whole life (4.6 MB -> 2.3 MB at 1280x905).
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB565, gl.RGB, gl.UNSIGNED_SHORT_5_6_5, bitmap)
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

  // Scratch state reused across frames: twgl.setUniforms reads values at call
  // time, so mutating these in place avoids allocating a uniform object plus
  // two arrays for every tile on every drawn frame — and setting the
  // frame-constant u_transform/u_tileSize once per frame stops the mat3 being
  // re-uploaded per tile.
  const transformMat = new Float32Array(9)
  const frameUniforms: Record<string, unknown> = {
    u_transform: transformMat,
    u_tileSize: [0, 0],
    u_desaturate: 0,
    u_fade: 0,
    u_cutMask: null,
    u_cutMaskOn: 0,
    u_viewportPx: [0, 0]
  }
  const tileUniforms: { u_tileOffset: number[], u_texture: WebGLTexture | null } = {
    u_tileOffset: [0, 0],
    u_texture: null
  }

  // The visible tiles for the current frame, in the same spirit as the uniform
  // scratch above: allocated once at grid size and refilled per frame, so the
  // single visibility pass doesn't hand the GC a fresh array every 16 ms.
  // `visibleCount` is the cursor; entries past it are stale and never read.
  const gridCells = grid.rows * grid.cols
  const visibleEntries: (TileEntry | null)[] = new Array(gridCells).fill(null)
  const visibleRows = new Int32Array(gridCells)
  const visibleCols = new Int32Array(gridCells)
  let visibleCount = 0

  function draw(transform: Transform, cssW: number, cssH: number, dpr: number, currentTier: Tier, selection?: SelectionOverlay | null, route?: RouteOverlayFrame | null, isolate?: LineIsolateOverlay | null) {
    if (disposed || gl.isContextLost()) return
    // Bump before any ensureTile() call so every tile touched this frame — the
    // visibility scan below included — carries the current stamp and is exempt
    // from the eviction sweep at the end.
    frameCounter++
    // Land at most one decoded tile before drawing, so a burst of arrivals is
    // spread across frames instead of stalling one.
    drainUploads()
    const drawW = Math.round(cssW * dpr)
    const drawH = Math.round(cssH * dpr)
    gl.viewport(0, 0, drawW, drawH)
    gl.clearColor(1, 1, 1, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // blendFunc is sticky context state and never varies; the enable/disable is
    // decided per pass below (tiles and the preview are opaque, overlays are
    // not). Start each frame with it off so every path — including the
    // preview-only early return — has a known state rather than inheriting the
    // last frame's.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.disable(gl.BLEND)

    const mat = buildTransformMat3(transform, cssW, cssH, transformMat)

    /*
     * How the artwork is treated this frame, and where the selection punches a
     * hole in that treatment. Computed once here because it has to reach THREE
     * separate setUniforms calls below — the preview-only return, the preview
     * underlay, and the per-frame tile uniforms — each of which passes its own
     * object, and twgl only sets the keys it is handed. A site left out doesn't
     * read zero, it inherits whatever the last frame bound.
     *
     * That hazard is why the cut uniforms are spread from one `tileTreatment`
     * object rather than listed per site: a new field reaches all three by
     * construction instead of by remembering.
     */
    const treatment = mapTreatment(selection, route, isolate)
    const desat = treatment.desaturate
    const fade = treatment.fade

    /*
     * The cutout mask, rendered before anything samples it — the preview-only
     * early return below draws tiles too, so this cannot wait for the tile loop.
     *
     * Shapes are pushed here rather than through a setter because they change
     * with the selection, not with the geometry the renderer holds statefully;
     * the buffer rebuild is gated on the list actually differing.
     */
    if (!sameShapes(maskShapes, treatment.cuts)) {
      maskShapes = treatment.cuts
      maskShapesDirty = true
    }
    const maskOn = treatment.cuts.length > 0 && (desat > 0 || fade > 0)
      ? renderMask(mat, drawW, drawH, treatment.feather)
      : false

    const tileTreatment = {
      u_desaturate: desat,
      u_fade: fade,
      u_cutMask: maskOn ? maskTexture : null,
      u_cutMaskOn: maskOn ? 1 : 0,
      u_viewportPx: [drawW, drawH]
    }

    // Skipped entirely when the base surface is hidden (`?debug=trace`'s
    // "surface off" state) — overlays below still draw over the blank clear.
    if (surfaceVisible) {
      gl.useProgram(programInfo.program)
      twgl.setBuffersAndAttributes(twglGl, programInfo, quadVao)

      const invScale = 1 / transform.scale
      const worldMinX = -transform.tx * invScale
      const worldMinY = -transform.ty * invScale
      const worldMaxX = (cssW - transform.tx) * invScale
      const worldMaxY = (cssH - transform.ty) * invScale
      const viewCx = (worldMinX + worldMaxX) / 2
      const viewCy = (worldMinY + worldMaxY) / 2

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
      // fit the screen; at minimum zoom it still spans ~2270 device px on a phone
      // (MAX_RENDER_DPR caps this), against a 1280px preview.
      // Satisfying this branch would need a ~2270px preview costing ~10 MB of
      // texture, which is worse than the ~20 MiB of tier-0.5 tiles it would
      // replace. Kept because it costs one comparison per
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
            u_texture: previewTexture,
            ...tileTreatment
          })
          twgl.drawBufferInfo(twglGl, quadVao, gl.TRIANGLE_STRIP)
          drawOverlays(mat, transform, cssW, cssH, selection, route)
          // Nothing here draws a tile, so every resident tile is dead weight —
          // release them outright rather than waiting for the budget sweep, which
          // would keep a full grid (~43 MB of tier-0.5 tiles) resident indefinitely because it sits
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
          // Same reasoning as the textures: anything queued or already decoded is
          // for a tile this path will never draw.
          discardPendingLoads()
          return
        }
        // No preview yet — fall through and draw tiles as usual rather than
        // showing a blank map while it loads.
      }

      // One pass over the visible span, collecting everything the rest of the
      // frame needs: the entries themselves, whether any tile is still blank (the
      // preview underlay), and whether any carries real transparency (the blend
      // state). Keep it to one pass — ensureTile() runs per cell.
      visibleCount = 0
      let anyVisibleMissing = false
      let anyVisibleNonOpaque = false
      for (let r = firstRow; r <= lastRow; r++) {
        for (let c = firstCol; c <= lastCol; c++) {
          const entry = ensureTile(r, c)
          if (!entry) {
            // Texture allocation failed — context lost mid-frame. Nothing to draw
            // for this cell, so the preview is the only honest thing to put here.
            anyVisibleMissing = true
            continue
          }
          if (entry.tier === 0) anyVisibleMissing = true
          else if (!entry.opaque) anyVisibleNonOpaque = true
          visibleRows[visibleCount] = r
          visibleCols[visibleCount] = c
          visibleEntries[visibleCount] = entry
          visibleCount++
        }
      }

      // Every visible tile now carries this frame's stamp, so the queue can tell
      // which of its pending requests the view has moved away from.
      prunePendingLoads(currentTier)

      // The preview stays resident for the renderer's whole life rather than being
      // freed once the tiles land. At 1280x905 it costs 2.3 MB as RGB565 — nothing
      // against ~10.7 MB per tier-2 tile — and keeping it means every path that
      // resets tiles to tier 0 (context recovery, release-on-hide) redraws through
      // a correct low-res map instead of blank placeholders. ensurePreview() is
      // idempotent, so calling it here also covers a renderer whose first load
      // failed.
      if (anyVisibleMissing) {
        if (!previewTexture) ensurePreview()
        if (previewTexture) {
          twgl.setUniforms(programInfo, {
            u_tileOffset: [0, 0],
            u_tileSize: [mapW, mapH],
            u_transform: mat,
            u_texture: previewTexture,
            ...tileTreatment
          })
          twgl.drawBufferInfo(twglGl, quadVao, gl.TRIANGLE_STRIP)
        }
      }

      // Blending costs a framebuffer read per fragment for a result that, on an
      // alpha-free source, is always just the source. The pre-rasterized WebPs
      // have no alpha channel at all, so the tile pass only needs blending when a
      // visible tile is a runtime-rasterized SVG — those have a genuinely
      // transparent background and must composite over the preview underlay.
      // The debug placeholder is a translucent tint, so it needs it too.
      const tilePassNeedsBlend = anyVisibleNonOpaque || (debugHitboxes && anyVisibleMissing)
      if (tilePassNeedsBlend) gl.enable(gl.BLEND)
      else gl.disable(gl.BLEND)

      // Frame-constant uniforms once; only offset + texture change per tile.
      const frameTileSize = frameUniforms.u_tileSize as number[]
      frameTileSize[0] = tileW
      frameTileSize[1] = tileH
      Object.assign(frameUniforms, tileTreatment)
      twgl.setUniforms(programInfo, frameUniforms)

      for (let i = 0; i < visibleCount; i++) {
        const entry = visibleEntries[i]!
        const r = visibleRows[i]
        const c = visibleCols[i]

        // A tile with no pixels yet draws nothing at all. The frame is cleared to
        // opaque white and the preview underlay above has already covered this
        // rect with real map — drawing the placeholder over it would replace a
        // correct low-res map with a white hole, which is exactly what it did:
        // PLACEHOLDER_PIXEL is opaque white in prod, so every unloaded tile
        // painted straight over the preview that had just been drawn for it.
        const texture = entry.tier > 0 ? entry.texture : (debugHitboxes ? placeholder : null)
        if (texture) {
          tileUniforms.u_tileOffset[0] = c * tileW
          tileUniforms.u_tileOffset[1] = r * tileH
          tileUniforms.u_texture = texture
          twgl.setUniforms(programInfo, tileUniforms)
          twgl.drawBufferInfo(twglGl, quadVao, gl.TRIANGLE_STRIP)
        }

        // Don't start tile fetches the preview is about to make redundant. This
        // is the zoomed-out first frame, before ensurePreview() has resolved:
        // without this the renderer requests the whole grid and then frees it
        // a frame later, spending real bandwidth on textures never drawn.
        if (previewOnly) continue

        if (entry.tier < currentTier && entry.pendingTier !== currentTier) {
          // Nearest the centre of what the user is looking at goes first. Both
          // axes are normalised by tile size, so a tall-thin phone viewport
          // doesn't systematically favour rows over columns.
          const dx = ((c + 0.5) * tileW - viewCx) / tileW
          const dy = ((r + 0.5) * tileH - viewCy) / tileH
          enqueueTier(r, c, currentTier, entry, dx * dx + dy * dy)
        }
      }

      pumpQueue()

      // Every visible tile now carries this frame's stamp, so anything older is
      // off-screen and safe to reclaim. The budget is derived from what this
      // frame actually shows: a tier-0.5 view and a tier-4 one differ by 128x per
      // tile, so one flat number could only ever be right for one of them.
      downgradeOverResolvedTiles(currentTier)
      evictTiles(tileBudgetBytes({
        visibleTiles: visibleCount,
        tileBytes: textureBytes(
          Math.round(tileW * currentTier),
          Math.round(tileH * currentTier),
          true,
          anyVisibleNonOpaque ? 4 : 2
        ),
        ceilingBytes: budgetCeilingBytes,
        deviceMemoryGb
      }))
    }

    drawOverlays(mat, transform, cssW, cssH, selection, route)

    // Decoded tiles still waiting on a frame to upload them: ask for one. This
    // terminates because each frame drains at least one, unlike the redraw loop
    // the preview-only path warns about.
    if (readyUploads.length > 0) onDirty()
  }

  // Hitbox debug fill and the selection spotlight. Split out of draw() so the
  // preview-only path can draw them too — a station stays selectable and
  // spotlit when zoomed out, where no tiles are resident at all.
  function drawOverlays(
    mat: Float32Array,
    transform: Transform,
    cssW: number,
    cssH: number,
    selection?: SelectionOverlay | null,
    route?: RouteOverlayFrame | null
  ) {
    // Everything here is genuinely translucent — the route overlay, the debug
    // pill fill, the spotlight scrim and its ring all composite over the map.
    // draw() leaves blending off for the opaque tile pass, and this is called
    // from two places (the tiled path and the preview-only early return), so
    // own the state here rather than depending on what the caller happened to
    // leave set.
    gl.enable(gl.BLEND)

    if (route && route.alpha > 0 && routeVao && routeRanges.length > 0) {
      if (route.scrimAlpha > 0) {
        gl.useProgram(scrimProgramInfo.program)
        twgl.setBuffersAndAttributes(twglGl, scrimProgramInfo, scrimVao)
        twgl.setUniforms(scrimProgramInfo, {
          u_color: [...SCRIM_RGB, route.scrimAlpha]
        })
        twgl.drawBufferInfo(twglGl, scrimVao, gl.TRIANGLE_STRIP)
      }

      gl.useProgram(pillProgramInfo.program)
      twgl.setBuffersAndAttributes(twglGl, pillProgramInfo, routeVao)
      twgl.setUniforms(pillProgramInfo, {
        u_transform: mat,
        u_edgeSoftnessWorld: 1.0 / transform.scale
      })
      for (const range of routeRanges) {
        twgl.setUniforms(pillProgramInfo, {
          u_color: [range.color[0], range.color[1], range.color[2], route.alpha]
        })
        gl.drawElements(gl.TRIANGLES, range.count, gl.UNSIGNED_SHORT, range.byteOffset)
      }
    }

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

    // Ring only: the isolating fade this pass used to carry now happens in the
    // tile shader, so a selection with no ring (a label fallback, noRing) has
    // nothing left to draw here.
    if (selection && selection.ringProgress > 0) {
      gl.useProgram(spotProgramInfo.program)
      twgl.setBuffersAndAttributes(twglGl, spotProgramInfo, spotVao)
      twgl.setUniforms(spotProgramInfo, {
        u_viewport: [cssW, cssH],
        u_view: [transform.tx, transform.ty, transform.scale],
        u_selA: [selection.ax, selection.ay],
        u_selB: [selection.bx, selection.by],
        u_selR: selection.r,
        u_selCr: selection.cr,
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

  function setRouteOverlay(route: RouteOverlay | null) {
    routeItems = route ? routeDrawItems(route) : []
    rebuildRouteBuffers()
    onDirty()
  }

  function setDebugHitboxes(enabled: boolean) {
    debugHitboxes = enabled
    onDirty()
  }

  function setSurfaceVisible(visible: boolean) {
    surfaceVisible = visible
    onDirty()
  }

  // Drop every tile's pixels but keep the context, its programs and its buffers
  // — those are kilobytes, the tiles are hundreds of megabytes. draw() re-requests
  // whatever is on screen and the preview underlay covers the gap meanwhile.
  function releaseTiles() {
    // The mask target is the largest single allocation this renderer makes after
    // the tiles themselves, and it is trivially rebuilt on the next frame that
    // needs one.
    releaseMaskTarget()
    if (disposed) return
    for (const entry of tiles.values()) gl.deleteTexture(entry.texture)
    tiles.clear()
    // Everything queued or decoded refers to entries that no longer exist. The
    // guards would discard them anyway, but a decoded bitmap sitting in
    // readyUploads is real memory — exactly what this function is here to hand
    // back — so drop it now rather than at the next drain.
    discardPendingLoads()
    onDirty()
  }

  // In-flight fetches are not cancellable, but their results are: startLoad's
  // identity re-check sees the replaced entry and closes the bitmap itself.
  function discardPendingLoads() {
    requestQueue.length = 0
    for (const ready of readyUploads) ready.bitmap.close?.()
    readyUploads.length = 0
  }

  function tileStats(): TileStats {
    let bytes = 0
    for (const entry of tiles.values()) bytes += entry.bytes
    return {
      count: tiles.size,
      bytes,
      queued: requestQueue.length,
      ready: readyUploads.length,
      uploadMs: totalUploadMs
    }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    discardPendingLoads()
    for (const entry of tiles.values()) gl.deleteTexture(entry.texture)
    gl.deleteTexture(placeholder)
    releasePreview()
    // The mask target and its geometry. releaseTiles() drops the target on its
    // own because it is rebuildable; here the buffers go too, since nothing is
    // coming back.
    releaseMaskTarget()
    if (maskBufferInfo) {
      deleteBufferInfo(maskBufferInfo)
      maskBufferInfo = null
    }
    if (maskVao && maskVao.vertexArrayObject) {
      gl.deleteVertexArray(maskVao.vertexArrayObject)
      maskVao = null
    }
    maskShapes = []
    tiles.clear()
    if (pillBufferInfo) {
      deleteBufferInfo(pillBufferInfo)
      pillBufferInfo = null
    }
    if (pillVao && pillVao.vertexArrayObject) {
      gl.deleteVertexArray(pillVao.vertexArrayObject)
      pillVao = null
    }
    if (routeBufferInfo) {
      deleteBufferInfo(routeBufferInfo)
      routeBufferInfo = null
    }
    if (routeVao && routeVao.vertexArrayObject) {
      gl.deleteVertexArray(routeVao.vertexArrayObject)
      routeVao = null
    }
    if (scrimVao.vertexArrayObject) {
      gl.deleteVertexArray(scrimVao.vertexArrayObject)
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
    requestTier: (r, c, tier) => {
      if (disposed || gl.isContextLost()) return
      const entry = ensureTile(r, c)
      if (!entry) return
      if (entry.tier >= tier) return
      if (entry.pendingTier !== null && entry.pendingTier >= tier) return
      // Priority 0: an explicit request from outside the draw loop names one
      // tile, so it outranks the frame's own visible-span work.
      enqueueTier(r, c, tier, entry, 0)
      pumpQueue()
    },
    setPoints,
    setRouteOverlay,
    setDebugHitboxes,
    setSurfaceVisible,
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

// Writes into `out` (a scratch matrix owned by the caller) so drawing doesn't
// allocate a fresh Float32Array every frame.
function buildTransformMat3(transform: Transform, cssW: number, cssH: number, out: Float32Array): Float32Array {
  const { tx, ty, scale } = transform
  const sx = 2 / cssW
  const sy = -2 / cssH
  out[0] = scale * sx
  out[1] = 0
  out[2] = 0
  out[3] = 0
  out[4] = scale * sy
  out[5] = 0
  out[6] = tx * sx - 1
  out[7] = ty * sy + 1
  out[8] = 1
  return out
}
