import * as twgl from 'twgl.js'
import type { LabelBuffers } from './map-label-geometry'

/*
 * GL half of the map label layer: MSDF text quads in a single draw call.
 * Mirrors map-vector-layer.ts (lazy creation by the renderer, delete-then-
 * recreate buffer lifecycle, no context-loss handling — the renderer is rebuilt
 * on loss and map.tsx re-pushes).
 *
 * The fragment shader renders halo + fill in one pass from one median sample:
 * the halo is a uniform outward expansion of the glyph outline, so thresholding
 * the same distance field at (0.5 - expand) yields the halo shape. Expansion
 * arrives per-vertex as a fraction of the atlas distance range, which is what
 * lets mixed font sizes share the pass. Output is premultiplied to match the
 * renderer's ONE / ONE_MINUS_SRC_ALPHA blending.
 */

const TEXT_VS = `#version 300 es
in vec2 a_position; // world
in vec2 a_uv;
in vec4 a_color;
in vec4 a_halo;
in float a_haloExpand; // fraction of distanceRange (normalized byte)
uniform mat3 u_transform;
out vec2 v_uv;
out vec4 v_color;
out vec4 v_halo;
out float v_haloExpand;
void main() {
  vec3 clip = u_transform * vec3(a_position, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
  v_halo = a_halo;
  v_haloExpand = a_haloExpand;
}
`

const TEXT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
in vec4 v_halo;
in float v_haloExpand;
uniform sampler2D u_atlas;
uniform float u_distanceRange; // atlas px
out vec4 outColor;
float median3(vec3 v) {
  return max(min(v.x, v.y), min(max(v.x, v.y), v.z));
}
void main() {
  float sd = median3(texture(u_atlas, v_uv).rgb) - 0.5;
  // Screen pixels spanned by one distance-field unit, via UV derivatives.
  vec2 unitRange = vec2(u_distanceRange) / vec2(textureSize(u_atlas, 0));
  float screenPxRange = max(0.5 * dot(unitRange, vec2(1.0) / fwidth(v_uv)), 1.0);
  float fill = clamp(sd * screenPxRange + 0.5, 0.0, 1.0);
  float halo = clamp((sd + v_haloExpand) * screenPxRange + 0.5, 0.0, 1.0);
  float aFill = fill * v_color.a;
  float aHalo = halo * v_halo.a;
  float a = aFill + aHalo * (1.0 - aFill);
  if (a <= 0.0) discard;
  vec3 rgb = v_color.rgb * aFill + v_halo.rgb * aHalo * (1.0 - aFill);
  outColor = vec4(rgb, a);
}
`

export interface LabelLayer {
  setGeometry(buffers: LabelBuffers | null): void
  /** Uploads the MSDF atlas; replaces (and frees) any previous texture. */
  setAtlas(image: TexImageSource | null, distanceRange: number): void
  /** True once both geometry and the atlas texture are present. */
  hasLabels(): boolean
  draw(mat: Float32Array): void
  dispose(): void
}

function deleteBufferInfo(gl: WebGL2RenderingContext, info: twgl.BufferInfo | null): void {
  if (!info) return
  for (const k in info.attribs) {
    const buf = info.attribs[k].buffer
    if (buf) gl.deleteBuffer(buf)
  }
  if (info.indices) gl.deleteBuffer(info.indices)
}

export function createLabelLayer(
  gl: WebGL2RenderingContext,
  twglGl: WebGLRenderingContext
): LabelLayer {
  const programInfo = twgl.createProgramInfo(twglGl, [TEXT_VS, TEXT_FS])

  let bufferInfo: twgl.BufferInfo | null = null
  let vao: twgl.VertexArrayInfo | null = null
  let texture: WebGLTexture | null = null
  let distanceRange = 0
  let disposed = false

  function releaseBuffers() {
    deleteBufferInfo(gl, bufferInfo)
    bufferInfo = null
    if (vao && vao.vertexArrayObject) gl.deleteVertexArray(vao.vertexArrayObject)
    vao = null
  }

  function releaseTexture() {
    if (texture) {
      gl.deleteTexture(texture)
      texture = null
    }
  }

  function setGeometry(buffers: LabelBuffers | null) {
    if (disposed) return
    // The ELEMENT_ARRAY_BUFFER binding is part of VAO state, and the renderer
    // leaves the last-drawn VAO bound between frames. Creating index buffers
    // now would silently rewrite that VAO's element binding — unbind first.
    gl.bindVertexArray(null)
    releaseBuffers()
    if (!buffers || buffers.glyphCount === 0) return

    bufferInfo = twgl.createBufferInfoFromArrays(twglGl, {
      a_position: { numComponents: 2, data: buffers.position },
      a_uv: { numComponents: 2, data: buffers.uv },
      a_color: { numComponents: 4, data: buffers.color, normalize: true },
      a_halo: { numComponents: 4, data: buffers.halo, normalize: true },
      a_haloExpand: { numComponents: 1, data: buffers.haloExpand, normalize: true },
      indices: { numComponents: 3, data: buffers.indices }
    })
    vao = twgl.createVertexArrayInfo(twglGl, programInfo, bufferInfo)
  }

  function setAtlas(image: TexImageSource | null, range: number) {
    if (disposed) return
    releaseTexture()
    distanceRange = range
    if (!image) return

    const tex = gl.createTexture()
    if (!tex) return
    gl.bindTexture(gl.TEXTURE_2D, tex)
    // Distance data, not color: premultiplication would corrupt the field. The
    // tile path sets this pixel-store flag globally, so force it off here.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    // No mipmaps: the per-channel median breaks under naive downsampling and
    // fringes exactly at the minification levels mipmaps would serve. The
    // shader's screenPxRange clamp degrades to a soft gray instead.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    texture = tex
  }

  function draw(mat: Float32Array) {
    if (disposed || !vao || !texture) return
    gl.useProgram(programInfo.program)
    twgl.setBuffersAndAttributes(twglGl, programInfo, vao)
    twgl.setUniforms(programInfo, {
      u_transform: mat,
      u_atlas: texture,
      u_distanceRange: distanceRange
    })
    twgl.drawBufferInfo(twglGl, vao, gl.TRIANGLES)
  }

  function dispose() {
    if (disposed) return
    disposed = true
    releaseBuffers()
    releaseTexture()
  }

  return {
    setGeometry,
    setAtlas,
    hasLabels: () => vao !== null && texture !== null,
    draw,
    dispose
  }
}
