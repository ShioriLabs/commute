import * as twgl from 'twgl.js'
import type { Manifest, Point, Renderer, Tier, Transform } from './map-renderer'
import { tileKey } from './map-renderer'
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

// Capsule shader: each pill is a 4-vertex quad whose local-space is the
// capsule's bounding box. Vertex shader maps local quad coords to world
// coords; fragment shader computes signed distance to the capsule centerline.
const PILL_VS = `#version 300 es
in vec2 a_quad; // -1..1 unit quad
in vec2 a_axisA; // world-space endpoint A
in vec2 a_axisB; // world-space endpoint B
in float a_radius;
uniform mat3 u_transform;
out vec2 v_local;
out vec2 v_axisA;
out vec2 v_axisB;
out float v_radius;
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
}
`

const PILL_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in vec2 v_axisA;
in vec2 v_axisB;
in float v_radius;
uniform vec4 u_color;
uniform float u_edgeSoftnessWorld;
out vec4 outColor;
void main() {
  vec2 ab = v_axisB - v_axisA;
  vec2 ap = v_local - v_axisA;
  float lenSq = max(dot(ab, ab), 1e-6);
  float t = clamp(dot(ap, ab) / lenSq, 0.0, 1.0);
  vec2 c = v_axisA + ab * t;
  float d = distance(v_local, c);
  float edge = u_edgeSoftnessWorld;
  float alpha = 1.0 - smoothstep(v_radius - edge, v_radius + edge, d);
  if (alpha <= 0.0) discard;
  outColor = vec4(u_color.rgb * u_color.a * alpha, u_color.a * alpha);
}
`

interface TileEntry {
  texture: WebGLTexture
  tier: Tier | 0
  pendingTier: Tier | null
  mipmapped: boolean
}

export function createWebGLRenderer(
  canvas: HTMLCanvasElement,
  manifest: Manifest,
  baseUrl: string,
  onDirty: () => void
): Renderer {
  const rawGl = canvas.getContext('webgl2', {
    antialias: true,
    premultipliedAlpha: true,
    alpha: true
  }) as WebGL2RenderingContext | null
  if (!rawGl) throw new Error('WebGL2 not available')
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

  // Preview texture rendered under the tile grid until visible tiles are ready.
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
    const indices = new Uint16Array(n * 6)
    const quadCorners = [-1, -1, 1, -1, -1, 1, 1, 1]
    for (let i = 0; i < n; i++) {
      const p = points[i]
      for (let v = 0; v < 4; v++) {
        quadData[i * 8 + v * 2 + 0] = quadCorners[v * 2 + 0]
        quadData[i * 8 + v * 2 + 1] = quadCorners[v * 2 + 1]
        axisAData[i * 8 + v * 2 + 0] = p.ax
        axisAData[i * 8 + v * 2 + 1] = p.ay
        axisBData[i * 8 + v * 2 + 0] = p.bx
        axisBData[i * 8 + v * 2 + 1] = p.by
        radiusData[i * 4 + v] = p.r
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
      indices: { numComponents: 3, data: indices }
    })
    pillVao = twgl.createVertexArrayInfo(twglGl, pillProgramInfo, pillBufferInfo)
  }

  const placeholder = createPlaceholderTexture(gl)

  function ensureTile(r: number, c: number): TileEntry {
    const key = tileKey(r, c)
    let entry = tiles.get(key)
    if (!entry) {
      const texture = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 241, 242, 102]))
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      entry = { texture, tier: 0, pendingTier: null, mipmapped: false }
      tiles.set(key, entry)
    }
    return entry
  }

  async function requestTier(r: number, c: number, tier: Tier): Promise<void> {
    if (disposed) return
    const entry = ensureTile(r, c)
    if (entry.tier >= tier) return
    if (entry.pendingTier !== null && entry.pendingTier >= tier) return
    entry.pendingTier = tier
    try {
      const bitmap = await tileSource.loadTile(r, c, tier)
      if (disposed) {
        bitmap.close?.()
        return
      }
      if (entry.pendingTier !== tier) {
        bitmap.close?.()
        return
      }
      gl.bindTexture(gl.TEXTURE_2D, entry.texture)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
      // Mipmaps are only useful when the tile is rendered smaller than its
      // texture; tier 1 textures are sized for ~1:1 rendering, so skip the
      // generateMipmap stall there. Higher tiers still get full mips so they
      // filter cleanly when the user is zoomed below the tier-1 threshold.
      if (tier > 1) {
        gl.generateMipmap(gl.TEXTURE_2D)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
        entry.mipmapped = true
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        entry.mipmapped = false
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      if (anisoExt && entry.mipmapped) {
        gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, maxAniso))
      }
      entry.tier = tier
      entry.pendingTier = null
      bitmap.close?.()
      onDirty()
    } catch (err) {
      entry.pendingTier = null
      console.warn(`Tile ${r},${c} tier ${tier} load failed`, err)
    }
  }

  function ensurePreview() {
    if (previewTexture || previewLoading || !manifest.preview) return
    previewLoading = true
    tileSource.loadPreview().then((bitmap) => {
      previewLoading = false
      if (disposed) {
        bitmap?.close?.()
        return
      }
      if (!bitmap) return
      const tex = gl.createTexture()!
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

  function draw(transform: Transform, cssW: number, cssH: number, dpr: number, currentTier: Tier) {
    if (disposed) return
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

    // Check whether any visible tile is still missing — if so, the preview
    // underlay (if loaded) gets drawn first to cover blank gaps.
    let anyVisibleMissing = false
    for (let r = 0; r < grid.rows && !anyVisibleMissing; r++) {
      const tileY = r * tileH
      if (tileY + tileH < worldMinY || tileY > worldMaxY) continue
      for (let c = 0; c < grid.cols; c++) {
        const tileX = c * tileW
        if (tileX + tileW < worldMinX || tileX > worldMaxX) continue
        const entry = ensureTile(r, c)
        if (entry.tier === 0) {
          anyVisibleMissing = true
          break
        }
      }
    }

    if (anyVisibleMissing && previewTexture) {
      twgl.setUniforms(programInfo, {
        u_tileOffset: [0, 0],
        u_tileSize: [mapW, mapH],
        u_transform: mat,
        u_texture: previewTexture
      })
      twgl.drawBufferInfo(twglGl, quadVao, gl.TRIANGLE_STRIP)
    } else if (previewTexture && !anyVisibleMissing) {
      releasePreview()
    }

    for (let r = 0; r < grid.rows; r++) {
      const tileY = r * tileH
      if (tileY + tileH < worldMinY || tileY > worldMaxY) continue
      for (let c = 0; c < grid.cols; c++) {
        const tileX = c * tileW
        if (tileX + tileW < worldMinX || tileX > worldMaxX) continue

        const entry = ensureTile(r, c)
        const texture = entry.tier > 0 ? entry.texture : placeholder

        twgl.setUniforms(programInfo, {
          u_tileOffset: [tileX, tileY],
          u_tileSize: [tileW, tileH],
          u_transform: mat,
          u_texture: texture
        })
        twgl.drawBufferInfo(twglGl, quadVao, gl.TRIANGLE_STRIP)

        if (entry.tier < currentTier && entry.pendingTier !== currentTier) {
          void requestTier(r, c, currentTier)
        }
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
    tileSource.dispose()
  }

  ensurePreview()

  return {
    kind: 'webgl2',
    draw,
    resize,
    requestTier: (r, c, tier) => { void requestTier(r, c, tier) },
    setPoints,
    setDebugHitboxes,
    dispose
  }
}

function createPlaceholderTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 241, 242, 102]))
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
