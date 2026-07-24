// Builds instanced VertexArrayInfos for each pass: the shared unit quad (divisor
// 0) plus per-instance attributes (divisor 1). Trains get a dynamically updated
// offset/color buffer since positions change each hop.
import * as twgl from 'twgl.js'
import type { Programs } from './programs'
import type { NetworkScene } from '../scene/network-scene'

export interface InstancedPass {
  vao: twgl.VertexArrayInfo
  instanceCount: number
}

// A pass whose per-instance emphasis flags can be swapped at runtime, so one
// baked geometry can spotlight different subjects as the scroll beats change.
export interface HighlightablePass extends InstancedPass {
  setHighlight(gl: WebGL2RenderingContext, data: Float32Array): void
}

export interface TrainPass {
  vao: twgl.VertexArrayInfo
  bufferInfo: twgl.BufferInfo
  offsets: Float32Array // reused CPU buffer, updated per hop
  colors: Float32Array
  count: number
  update(gl: WebGL2RenderingContext): void // re-upload offsets
}

// Combine the shared quad corners with instance attributes into one
// VertexArrayInfo. We re-supply a_quad corners (small, 4 verts) per pass rather
// than share a buffer — simpler and cheap.
const QUAD_CORNERS = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])

function buildInstanced(
  gl: WebGL2RenderingContext,
  program: twgl.ProgramInfo,
  instanceArrays: twgl.Arrays,
  instanceCount: number
): InstancedPass {
  const arrays: twgl.Arrays = {
    a_quad: { numComponents: 2, data: QUAD_CORNERS },
    ...instanceArrays
  }
  const bufferInfo = twgl.createBufferInfoFromArrays(gl, arrays)
  const vao = twgl.createVertexArrayInfo(gl, program, bufferInfo)
  return { vao, instanceCount }
}

// As buildInstanced, but a_isHighlight is DYNAMIC_DRAW and re-uploadable. Starts
// all-zero: the director pushes the active subject's flags on the first frame.
function buildHighlightable(
  gl: WebGL2RenderingContext,
  program: twgl.ProgramInfo,
  instanceArrays: twgl.Arrays,
  instanceCount: number
): HighlightablePass {
  const arrays: twgl.Arrays = {
    a_quad: { numComponents: 2, data: QUAD_CORNERS },
    ...instanceArrays,
    a_isHighlight: {
      numComponents: 1,
      data: new Float32Array(instanceCount),
      divisor: 1,
      drawType: gl.DYNAMIC_DRAW
    }
  }
  const bufferInfo = twgl.createBufferInfoFromArrays(gl, arrays)
  const vao = twgl.createVertexArrayInfo(gl, program, bufferInfo)

  function setHighlight(g: WebGL2RenderingContext, data: Float32Array): void {
    const attrib = bufferInfo.attribs!.a_isHighlight!
    g.bindBuffer(g.ARRAY_BUFFER, attrib.buffer)
    g.bufferSubData(g.ARRAY_BUFFER, 0, data)
  }

  return { vao, instanceCount, setHighlight }
}

export function buildFieldPass(
  gl: WebGL2RenderingContext,
  programs: Programs,
  scene: NetworkScene
): InstancedPass {
  return buildInstanced(
    gl,
    programs.field,
    { a_offset: { numComponents: 3, data: scene.field.offsets, divisor: 1 } },
    scene.field.count
  )
}

export function buildDotPass(
  gl: WebGL2RenderingContext,
  programs: Programs,
  scene: NetworkScene
): HighlightablePass {
  return buildHighlightable(
    gl,
    programs.dot,
    {
      a_offset: { numComponents: 3, data: scene.dots.offsets, divisor: 1 },
      a_color: { numComponents: 3, data: scene.dots.colors, divisor: 1 },
      a_radius: { numComponents: 1, data: scene.dots.radii, divisor: 1 },
      a_order: { numComponents: 1, data: scene.dots.order, divisor: 1 }
    },
    scene.dots.count
  )
}

export function buildStationPass(
  gl: WebGL2RenderingContext,
  programs: Programs,
  scene: NetworkScene
): HighlightablePass {
  return buildHighlightable(
    gl,
    programs.station,
    {
      a_offset: { numComponents: 3, data: scene.stations.offsets, divisor: 1 },
      a_radius: { numComponents: 1, data: scene.stations.radii, divisor: 1 }
    },
    scene.stations.count
  )
}

// Trains: one instance per active train. Offsets change each hop, so the buffer
// is created dynamic and re-uploaded via bufferSubData.
export function buildTrainPass(
  gl: WebGL2RenderingContext,
  programs: Programs,
  colors: Float32Array,
  count: number
): TrainPass {
  const offsets = new Float32Array(count * 3)
  const arrays: twgl.Arrays = {
    a_quad: { numComponents: 2, data: QUAD_CORNERS },
    a_offset: { numComponents: 3, data: offsets, divisor: 1, drawType: gl.DYNAMIC_DRAW },
    a_color: { numComponents: 3, data: colors, divisor: 1 }
  }
  const bufferInfo = twgl.createBufferInfoFromArrays(gl, arrays)
  const vao = twgl.createVertexArrayInfo(gl, programs.train, bufferInfo)

  function update(g: WebGL2RenderingContext): void {
    const attrib = bufferInfo.attribs!.a_offset!
    g.bindBuffer(g.ARRAY_BUFFER, attrib.buffer)
    g.bufferSubData(g.ARRAY_BUFFER, 0, offsets)
  }

  return { vao, bufferInfo, offsets, colors, count, update }
}
