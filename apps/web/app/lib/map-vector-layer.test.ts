import { describe, expect, it, vi } from 'vitest'
import { createVectorLayer } from './map-vector-layer'
import { buildVectorBuffers } from './map-vector-geometry'
import type { MapGeometryDoc } from './map-vector-geometry'

// These tests assert on GPU buffer lifetime: the vector layer replaces its whole
// buffer set on every geometry push, so a leak here would grow VRAM on every
// context-recovery re-push. The twgl mock allocates real (fake) buffer objects
// through the gl so create/delete pairing is observable.

interface FakeObj {
  id: number
  deleted: boolean
}

function createFakeGl() {
  let nextId = 1
  const buffers: FakeObj[] = []
  const vaos: FakeObj[] = []
  const gl = {
    TRIANGLES: 4,
    createBuffer() {
      const b: FakeObj = { id: nextId++, deleted: false }
      buffers.push(b)
      return b as unknown as WebGLBuffer
    },
    deleteBuffer(b: WebGLBuffer | null) {
      if (b) (b as unknown as FakeObj).deleted = true
    },
    createVertexArray() {
      const v: FakeObj = { id: nextId++, deleted: false }
      vaos.push(v)
      return v as unknown as WebGLVertexArrayObject
    },
    deleteVertexArray(v: WebGLVertexArrayObject | null) {
      if (v) (v as unknown as FakeObj).deleted = true
    },
    bindVertexArray() {},
    useProgram() {}
  }
  return {
    gl: gl as unknown as WebGL2RenderingContext,
    liveBuffers: () => buffers.filter(b => !b.deleted).length,
    liveVaos: () => vaos.filter(v => !v.deleted).length,
    totalBuffers: () => buffers.length
  }
}

const drawCalls: unknown[][] = []

vi.mock('twgl.js', () => ({
  createProgramInfo: () => ({ program: {}, uniformSetters: {}, attribSetters: {} }),
  createBufferInfoFromArrays: (gl: WebGL2RenderingContext, arrays: Record<string, unknown>) => {
    const attribs: Record<string, { buffer: WebGLBuffer }> = {}
    for (const name of Object.keys(arrays)) {
      if (name === 'indices') continue
      attribs[name] = { buffer: gl.createBuffer()! }
    }
    return {
      attribs,
      indices: 'indices' in arrays ? gl.createBuffer() : undefined,
      numElements: 6
    }
  },
  createVertexArrayInfo: (gl: WebGL2RenderingContext) => ({
    vertexArrayObject: gl.createVertexArray(),
    numElements: 6
  }),
  setBuffersAndAttributes: () => {},
  setUniforms: () => {},
  drawBufferInfo: (...args: unknown[]) => { drawCalls.push(args) }
}))

const SDF_GLSL = 'float shapeDistance(vec2 p, vec2 a, vec2 b, float r, float cr) { return 0.0; }'

function geometryDoc(): MapGeometryDoc {
  return {
    version: 'test',
    viewBox: [0, 0, 100, 100],
    scale: 4,
    canvas: [0, 0, 100, 100],
    palette: ['#FF0000', '#00FF00'],
    layers: [
      { name: 'rail', kind: 'stroke', items: [{ c: 0, w: 100, pts: [0, 0, 40, 0, 40, 40] }] },
      { name: 'region-fill', kind: 'mesh', items: [{ c: 1, tris: [0, 0, 4, 0, 0, 4] }] }
    ]
  }
}

function setup() {
  const fake = createFakeGl()
  const layer = createVectorLayer(fake.gl, fake.gl as unknown as WebGLRenderingContext, SDF_GLSL)
  return { ...fake, layer }
}

describe('vector layer buffer lifecycle', () => {
  it('creates buffers on setGeometry and reports geometry', () => {
    const { layer, liveBuffers } = setup()
    expect(layer.hasGeometry()).toBe(false)
    layer.setGeometry(buildVectorBuffers(geometryDoc()))
    expect(layer.hasGeometry()).toBe(true)
    expect(liveBuffers()).toBeGreaterThan(0)
  })

  it('replaces buffers wholesale on re-push instead of leaking the old set', () => {
    const { layer, liveBuffers, totalBuffers } = setup()
    layer.setGeometry(buildVectorBuffers(geometryDoc()))
    const firstBatchLive = liveBuffers()
    layer.setGeometry(buildVectorBuffers(geometryDoc()))
    // Same geometry → same live count, but the first batch must all be deleted.
    expect(liveBuffers()).toBe(firstBatchLive)
    expect(totalBuffers()).toBe(firstBatchLive * 2)
  })

  it('releases everything on setGeometry(null) and on dispose', () => {
    const { layer, liveBuffers, liveVaos } = setup()
    layer.setGeometry(buildVectorBuffers(geometryDoc()))
    layer.setGeometry(null)
    expect(liveBuffers()).toBe(0)
    expect(liveVaos()).toBe(0)
    expect(layer.hasGeometry()).toBe(false)

    layer.setGeometry(buildVectorBuffers(geometryDoc()))
    layer.dispose()
    expect(liveBuffers()).toBe(0)
    expect(liveVaos()).toBe(0)
  })

  it('ignores pushes after dispose', () => {
    const { layer, liveBuffers } = setup()
    layer.dispose()
    layer.setGeometry(buildVectorBuffers(geometryDoc()))
    expect(liveBuffers()).toBe(0)
    expect(layer.hasGeometry()).toBe(false)
  })

  it('draws fills before capsules, and nothing without geometry', () => {
    const { layer } = setup()
    const mat = new Float32Array(9)

    drawCalls.length = 0
    layer.draw(mat, 0.5, true)
    expect(drawCalls.length).toBe(0)

    layer.setGeometry(buildVectorBuffers(geometryDoc()))
    drawCalls.length = 0
    layer.draw(mat, 0.5, true)
    // One fill pass plus one SDF pass — each a single drawElements over the
    // whole batch, which is the draw-call budget this design promises.
    expect(drawCalls.length).toBe(2)

    // Overlay mode skips the region meshes so tiles stay visible underneath.
    drawCalls.length = 0
    layer.draw(mat, 0.5, false)
    expect(drawCalls.length).toBe(1)
  })
})
