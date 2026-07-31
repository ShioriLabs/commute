import { describe, expect, it, vi } from 'vitest'
import { createLabelLayer } from './map-label-layer'
import { buildLabelBuffers } from './map-label-geometry'
import type { LabelAtlasDoc, MapLabelsDoc } from './map-label-geometry'

// Buffer + texture lifetime assertions for the label layer, in the style of
// map-vector-layer.test.ts: the fake gl tracks create/delete pairing so leaks
// across geometry re-pushes and atlas swaps are observable.

interface FakeObj {
  id: number
  deleted: boolean
}

function createFakeGl() {
  let nextId = 1
  const buffers: FakeObj[] = []
  const vaos: FakeObj[] = []
  const textures: FakeObj[] = []
  const gl = {
    TRIANGLES: 4,
    TEXTURE_2D: 0x0de1,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
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
    createTexture() {
      const t: FakeObj = { id: nextId++, deleted: false }
      textures.push(t)
      return t as unknown as WebGLTexture
    },
    deleteTexture(t: WebGLTexture | null) {
      if (t) (t as unknown as FakeObj).deleted = true
    },
    bindTexture() {}, texImage2D() {}, texParameteri() {}, pixelStorei() {},
    bindVertexArray() {}, useProgram() {}
  }
  return {
    gl: gl as unknown as WebGL2RenderingContext,
    liveBuffers: () => buffers.filter(b => !b.deleted).length,
    liveTextures: () => textures.filter(t => !t.deleted).length
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

function labels(): MapLabelsDoc {
  return {
    version: 'test',
    scale: 4,
    fonts: ['F'],
    palette: ['#19181C'],
    runs: [{ f: 0, s: 130, c: 0, x: 0, y: 0, t: 'A', a: [0] }]
  }
}

function atlas(): LabelAtlasDoc {
  return {
    size: [64, 64],
    distanceRange: 8,
    fonts: [{ name: 'F', fontSize: 48, base: 38, glyphs: { A: { x: 0, y: 0, w: 8, h: 8, xo: 0, yo: 0 } } }]
  }
}

const fakeImage = {} as TexImageSource

function setup() {
  const fake = createFakeGl()
  const layer = createLabelLayer(fake.gl, fake.gl as unknown as WebGLRenderingContext)
  return { ...fake, layer }
}

describe('label layer lifecycle', () => {
  it('needs both geometry and atlas before drawing', () => {
    const { layer } = setup()
    const mat = new Float32Array(9)

    drawCalls.length = 0
    layer.draw(mat)
    expect(drawCalls.length).toBe(0)
    expect(layer.hasLabels()).toBe(false)

    layer.setGeometry(buildLabelBuffers(labels(), atlas()))
    layer.draw(mat)
    expect(drawCalls.length).toBe(0)

    layer.setAtlas(fakeImage, 8)
    expect(layer.hasLabels()).toBe(true)
    layer.draw(mat)
    // Exactly one drawElements for the whole label set.
    expect(drawCalls.length).toBe(1)
  })

  it('replaces buffers and texture without leaking', () => {
    const { layer, liveBuffers, liveTextures } = setup()
    layer.setGeometry(buildLabelBuffers(labels(), atlas()))
    const firstLive = liveBuffers()
    layer.setGeometry(buildLabelBuffers(labels(), atlas()))
    expect(liveBuffers()).toBe(firstLive)

    layer.setAtlas(fakeImage, 8)
    layer.setAtlas(fakeImage, 8)
    expect(liveTextures()).toBe(1)
  })

  it('releases everything on null pushes and dispose', () => {
    const { layer, liveBuffers, liveTextures } = setup()
    layer.setGeometry(buildLabelBuffers(labels(), atlas()))
    layer.setAtlas(fakeImage, 8)
    layer.setGeometry(null)
    layer.setAtlas(null, 0)
    expect(liveBuffers()).toBe(0)
    expect(liveTextures()).toBe(0)
    expect(layer.hasLabels()).toBe(false)

    layer.setGeometry(buildLabelBuffers(labels(), atlas()))
    layer.setAtlas(fakeImage, 8)
    layer.dispose()
    expect(liveBuffers()).toBe(0)
    expect(liveTextures()).toBe(0)
  })

  it('ignores pushes after dispose and empty geometry', () => {
    const { layer, liveBuffers } = setup()
    layer.dispose()
    layer.setGeometry(buildLabelBuffers(labels(), atlas()))
    layer.setAtlas(fakeImage, 8)
    expect(liveBuffers()).toBe(0)

    const { layer: layer2 } = setup()
    const empty = buildLabelBuffers({ ...labels(), runs: [] }, atlas())
    layer2.setGeometry(empty)
    expect(layer2.hasLabels()).toBe(false)
  })
})
