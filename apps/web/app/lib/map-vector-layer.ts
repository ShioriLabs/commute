import * as twgl from 'twgl.js'
import type { VectorBuffers } from './map-vector-geometry'

/*
 * GL half of the vector-primitive map layer. Two programs:
 *
 *  - FILL: triangulated region fills (water, parks, urban areas), flat per-vertex
 *    color, no antialiasing — every visible fill edge sits under a casing stroke
 *    drawn on top of it, so the hard triangle edges are never seen.
 *  - VEC: the whole linework and every station disc as oriented capsule quads,
 *    a vertex-colored fork of the renderer's PILL program. Per-vertex color is
 *    what lets one drawElements call carry every layer's batches in painter's
 *    order; the corner radius attribute is gone because a capsule is the
 *    degenerate rounded rect (cr == r), which the SDF gets for free.
 *
 * The rounded-rect SDF arrives as a constructor argument rather than an import:
 * it is map-renderer-webgl.ts's module-private SHAPE_SDF_GLSL, passed in so both
 * shaders agree on the exact boundary math without a circular import.
 *
 * No special context-loss handling: on loss the whole renderer is rebuilt on a
 * fresh canvas (see map-context-recovery.ts) and map.tsx re-pushes the geometry,
 * so create/dispose hygiene is all that's needed.
 */

const VEC_VS = `#version 300 es
in vec2 a_quad; // -1..1 unit quad
in vec2 a_axisA; // world-space endpoint A
in vec2 a_axisB; // world-space endpoint B
in float a_radius;
in vec4 a_color;
uniform mat3 u_transform;
out vec2 v_local;
out vec2 v_axisA;
out vec2 v_axisB;
out float v_radius;
out vec4 v_color;
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
  v_color = a_color;
}
`

function vecFs(shapeSdfGlsl: string): string {
  return `#version 300 es
precision highp float;
in vec2 v_local;
in vec2 v_axisA;
in vec2 v_axisB;
in float v_radius;
in vec4 v_color;
uniform float u_edgeSoftnessWorld;
out vec4 outColor;
${shapeSdfGlsl}
void main() {
  float d = shapeDistance(v_local, v_axisA, v_axisB, v_radius, v_radius);
  float edge = u_edgeSoftnessWorld;
  float alpha = 1.0 - smoothstep(-edge, edge, d);
  if (alpha <= 0.0) discard;
  outColor = vec4(v_color.rgb * v_color.a * alpha, v_color.a * alpha);
}
`
}

const FILL_VS = `#version 300 es
in vec2 a_position; // world
in vec4 a_color;
uniform mat3 u_transform;
out vec4 v_color;
void main() {
  vec3 clip = u_transform * vec3(a_position, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_color = a_color;
}
`

const FILL_FS = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 outColor;
void main() {
  outColor = vec4(v_color.rgb * v_color.a, v_color.a);
}
`

export interface VectorLayer {
  setGeometry(buffers: VectorBuffers | null): void
  hasGeometry(): boolean
  /**
   * Fill pass then SDF pass, in that order. Assumes premultiplied blending is
   * on. `includeFills: false` skips the region meshes — overlay mode uses it so
   * the tiles' text and icons stay visible under the vector linework, which is
   * what makes misregistration readable as fringes.
   */
  draw(mat: Float32Array, edgeSoftnessWorld: number, includeFills: boolean): void
  dispose(): void
}

function deleteBufferInfo(gl: WebGL2RenderingContext, info: twgl.BufferInfo | null): void {
  if (!info) return
  // twgl doesn't expose a delete helper for BufferInfo; recreate buffers fresh.
  for (const k in info.attribs) {
    const buf = info.attribs[k].buffer
    if (buf) gl.deleteBuffer(buf)
  }
  if (info.indices) gl.deleteBuffer(info.indices)
}

export function createVectorLayer(
  gl: WebGL2RenderingContext,
  twglGl: WebGLRenderingContext,
  shapeSdfGlsl: string
): VectorLayer {
  const vecProgramInfo = twgl.createProgramInfo(twglGl, [VEC_VS, vecFs(shapeSdfGlsl)])
  const fillProgramInfo = twgl.createProgramInfo(twglGl, [FILL_VS, FILL_FS])

  let sdfBufferInfo: twgl.BufferInfo | null = null
  let sdfVao: twgl.VertexArrayInfo | null = null
  let fillBufferInfo: twgl.BufferInfo | null = null
  let fillVao: twgl.VertexArrayInfo | null = null
  let disposed = false

  function releaseBuffers() {
    deleteBufferInfo(gl, sdfBufferInfo)
    sdfBufferInfo = null
    if (sdfVao && sdfVao.vertexArrayObject) gl.deleteVertexArray(sdfVao.vertexArrayObject)
    sdfVao = null
    deleteBufferInfo(gl, fillBufferInfo)
    fillBufferInfo = null
    if (fillVao && fillVao.vertexArrayObject) gl.deleteVertexArray(fillVao.vertexArrayObject)
    fillVao = null
  }

  function setGeometry(buffers: VectorBuffers | null) {
    if (disposed) return
    // The ELEMENT_ARRAY_BUFFER binding is part of VAO state, and the renderer
    // leaves the last-drawn VAO bound between frames. Creating index buffers
    // now would silently rewrite that VAO's element binding — unbind first.
    gl.bindVertexArray(null)
    releaseBuffers()
    if (!buffers) return

    if (buffers.capsuleCount > 0) {
      sdfBufferInfo = twgl.createBufferInfoFromArrays(twglGl, {
        a_quad: { numComponents: 2, data: buffers.sdf.quad },
        a_axisA: { numComponents: 2, data: buffers.sdf.axisA },
        a_axisB: { numComponents: 2, data: buffers.sdf.axisB },
        a_radius: { numComponents: 1, data: buffers.sdf.radius },
        a_color: { numComponents: 4, data: buffers.sdf.color, normalize: true },
        indices: { numComponents: 3, data: buffers.sdf.indices }
      })
      sdfVao = twgl.createVertexArrayInfo(twglGl, vecProgramInfo, sdfBufferInfo)
    }

    if (buffers.triangleCount > 0) {
      fillBufferInfo = twgl.createBufferInfoFromArrays(twglGl, {
        a_position: { numComponents: 2, data: buffers.mesh.position },
        a_color: { numComponents: 4, data: buffers.mesh.color, normalize: true }
      })
      fillVao = twgl.createVertexArrayInfo(twglGl, fillProgramInfo, fillBufferInfo)
    }
  }

  function draw(mat: Float32Array, edgeSoftnessWorld: number, includeFills: boolean) {
    if (disposed) return

    if (fillVao && includeFills) {
      gl.useProgram(fillProgramInfo.program)
      twgl.setBuffersAndAttributes(twglGl, fillProgramInfo, fillVao)
      twgl.setUniforms(fillProgramInfo, { u_transform: mat })
      twgl.drawBufferInfo(twglGl, fillVao, gl.TRIANGLES)
    }

    if (sdfVao) {
      gl.useProgram(vecProgramInfo.program)
      twgl.setBuffersAndAttributes(twglGl, vecProgramInfo, sdfVao)
      twgl.setUniforms(vecProgramInfo, {
        u_transform: mat,
        u_edgeSoftnessWorld: edgeSoftnessWorld
      })
      twgl.drawBufferInfo(twglGl, sdfVao, gl.TRIANGLES)
    }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    releaseBuffers()
  }

  return {
    setGeometry,
    hasGeometry: () => sdfVao !== null || fillVao !== null,
    draw,
    dispose
  }
}
