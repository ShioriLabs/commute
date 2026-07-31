/*
 * Pure logic for the vector-primitive map layer: parsing app/data/map-geometry.json
 * (produced by scripts/build-map-geometry.ts) and expanding it into the typed arrays
 * map-vector-layer.ts uploads to the GPU. No GL here — this module is the vitest
 * side of the same pure/GL split map-renderer.ts uses.
 *
 * Two passes come out of one document:
 *  - a mesh pass (triangulated region fills: water, parks, urban areas), drawn
 *    first with a trivial flat-color program;
 *  - an SDF pass (every stroke as a chain of oriented capsule quads, every station
 *    disc as a zero-length capsule) through a vertex-colored fork of the PILL
 *    shader. Index order encodes the painter's z-order across all layers, so each
 *    pass is a single drawElements call.
 */

export interface MapGeometryDoc {
  version: string
  viewBox: [number, number, number, number]
  /** Fixed-point divisor: stored integers are world units times this. */
  scale: number
  canvas: [number, number, number, number]
  palette: string[]
  layers: MapGeometryLayer[]
}

export type MapGeometryLayer =
  | { name: string, kind: 'stroke', items: { c: number, w: number, pts: number[] }[] }
  | { name: string, kind: 'disc', items: { c: number, x: number, y: number, r: number }[] }
  // Annulus markers (station rings): centreline radius r, ring width w.
  | { name: string, kind: 'ring', items: { c: number, x: number, y: number, r: number, w: number }[] }
  | { name: string, kind: 'mesh', items: { c: number, tris: number[] }[] }

export interface VectorBuffers {
  /** Capsule quads: interleaved attribute arrays, 4 vertices per capsule. */
  sdf: {
    quad: Float32Array
    axisA: Float32Array
    axisB: Float32Array
    radius: Float32Array
    color: Uint8Array
    indices: Uint32Array
  }
  /** Flat-color triangles: xy positions plus per-vertex color. */
  mesh: {
    position: Float32Array
    color: Uint8Array
  }
  capsuleCount: number
  triangleCount: number
}

/** #RRGGBB → premultiplied-ready RGBA bytes (alpha 255, so identical either way). */
export function hexToBytes(hex: string): [number, number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
    255
  ]
}

function isFiniteNumberArray(a: unknown): a is number[] {
  return Array.isArray(a) && a.every(v => typeof v === 'number' && Number.isFinite(v))
}

/**
 * Validates and decodes the generated document. Throws on structural problems —
 * the dataset is built by our own script, so anything malformed is a build bug
 * that should surface loudly, not render garbage.
 */
export function parseMapGeometry(raw: unknown): MapGeometryDoc {
  const doc = raw as MapGeometryDoc
  if (!doc || typeof doc !== 'object') throw new Error('map-geometry: not an object')
  if (typeof doc.scale !== 'number' || doc.scale <= 0) throw new Error('map-geometry: bad scale')
  if (!isFiniteNumberArray(doc.viewBox) || doc.viewBox.length !== 4) throw new Error('map-geometry: bad viewBox')
  if (!Array.isArray(doc.palette) || doc.palette.some(c => !/^#[0-9A-F]{6}$/.test(c))) {
    throw new Error('map-geometry: bad palette')
  }
  if (!Array.isArray(doc.layers)) throw new Error('map-geometry: bad layers')
  for (const layer of doc.layers) {
    if (!Array.isArray(layer.items)) throw new Error(`map-geometry: layer ${layer.name} has no items`)
    for (const item of layer.items) {
      if (item.c < 0 || item.c >= doc.palette.length) {
        throw new Error(`map-geometry: layer ${layer.name} palette index ${item.c} out of bounds`)
      }
      if (layer.kind === 'stroke') {
        const s = item as { w: number, pts: number[] }
        if (!isFiniteNumberArray(s.pts) || s.pts.length < 4 || s.pts.length % 2 !== 0 || !(s.w > 0)) {
          throw new Error(`map-geometry: layer ${layer.name} malformed stroke`)
        }
      } else if (layer.kind === 'ring') {
        const r = item as { r: number, w: number }
        if (!(r.r > 0) || !(r.w > 0)) {
          throw new Error(`map-geometry: layer ${layer.name} malformed ring`)
        }
      } else if (layer.kind === 'mesh') {
        const m = item as { tris: number[] }
        if (!isFiniteNumberArray(m.tris) || m.tris.length % 6 !== 0) {
          throw new Error(`map-geometry: layer ${layer.name} malformed mesh`)
        }
      }
    }
  }
  return doc
}

const QUAD_CORNERS = [-1, -1, 1, -1, -1, 1, 1, 1]

/** Capsule segments for a ring of world radius r — enough that faceting stays under the AA feather. */
function ringSegments(r: number): number {
  return Math.max(24, Math.ceil((2 * Math.PI * r) / 1.5))
}

/**
 * Expands the document into GPU-ready arrays. Capsules are appended in document
 * layer order and indexed sequentially, so drawing the whole index buffer once
 * reproduces the painter's order exactly. World coordinates come out of fixed
 * point here, once, rather than per frame in the shader.
 */
export function buildVectorBuffers(doc: MapGeometryDoc): VectorBuffers {
  const inv = 1 / doc.scale

  let capsuleCount = 0
  let triangleCount = 0
  for (const layer of doc.layers) {
    if (layer.kind === 'stroke') {
      for (const item of layer.items) capsuleCount += item.pts.length / 2 - 1
    } else if (layer.kind === 'disc') {
      capsuleCount += layer.items.length
    } else if (layer.kind === 'ring') {
      for (const item of layer.items) capsuleCount += ringSegments(item.r * inv)
    } else {
      for (const item of layer.items) triangleCount += item.tris.length / 6
    }
  }

  const quad = new Float32Array(capsuleCount * 4 * 2)
  const axisA = new Float32Array(capsuleCount * 4 * 2)
  const axisB = new Float32Array(capsuleCount * 4 * 2)
  const radius = new Float32Array(capsuleCount * 4)
  const sdfColor = new Uint8Array(capsuleCount * 4 * 4)
  const indices = new Uint32Array(capsuleCount * 6)
  const meshPosition = new Float32Array(triangleCount * 3 * 2)
  const meshColor = new Uint8Array(triangleCount * 3 * 4)

  let ci = 0
  const emitCapsule = (
    ax: number, ay: number, bx: number, by: number, r: number,
    rgba: [number, number, number, number]
  ) => {
    for (let v = 0; v < 4; v++) {
      quad[ci * 8 + v * 2 + 0] = QUAD_CORNERS[v * 2 + 0]
      quad[ci * 8 + v * 2 + 1] = QUAD_CORNERS[v * 2 + 1]
      axisA[ci * 8 + v * 2 + 0] = ax
      axisA[ci * 8 + v * 2 + 1] = ay
      axisB[ci * 8 + v * 2 + 0] = bx
      axisB[ci * 8 + v * 2 + 1] = by
      radius[ci * 4 + v] = r
      sdfColor[ci * 16 + v * 4 + 0] = rgba[0]
      sdfColor[ci * 16 + v * 4 + 1] = rgba[1]
      sdfColor[ci * 16 + v * 4 + 2] = rgba[2]
      sdfColor[ci * 16 + v * 4 + 3] = rgba[3]
    }
    const base = ci * 4
    indices[ci * 6 + 0] = base + 0
    indices[ci * 6 + 1] = base + 1
    indices[ci * 6 + 2] = base + 2
    indices[ci * 6 + 3] = base + 2
    indices[ci * 6 + 4] = base + 1
    indices[ci * 6 + 5] = base + 3
    ci++
  }

  let mi = 0
  for (const layer of doc.layers) {
    if (layer.kind === 'mesh') {
      for (const item of layer.items) {
        const rgba = hexToBytes(doc.palette[item.c])
        for (let i = 0; i + 1 < item.tris.length; i += 2) {
          meshPosition[mi * 2 + 0] = item.tris[i] * inv
          meshPosition[mi * 2 + 1] = item.tris[i + 1] * inv
          meshColor[mi * 4 + 0] = rgba[0]
          meshColor[mi * 4 + 1] = rgba[1]
          meshColor[mi * 4 + 2] = rgba[2]
          meshColor[mi * 4 + 3] = rgba[3]
          mi++
        }
      }
    } else if (layer.kind === 'stroke') {
      for (const item of layer.items) {
        const rgba = hexToBytes(doc.palette[item.c])
        const r = (item.w * inv) / 2
        for (let i = 0; i + 3 < item.pts.length; i += 2) {
          emitCapsule(
            item.pts[i] * inv, item.pts[i + 1] * inv,
            item.pts[i + 2] * inv, item.pts[i + 3] * inv,
            r, rgba
          )
        }
      }
    } else if (layer.kind === 'ring') {
      // Annulus → closed chain of capsules around the centreline circle. The
      // segment count keeps the polygonal error under the AA feather.
      for (const item of layer.items) {
        const rgba = hexToBytes(doc.palette[item.c])
        const cx = item.x * inv
        const cy = item.y * inv
        const r = item.r * inv
        const halfW = (item.w * inv) / 2
        const segments = ringSegments(r)
        let px = cx + r
        let py = cy
        for (let s = 1; s <= segments; s++) {
          const t = (s / segments) * 2 * Math.PI
          const nx = cx + r * Math.cos(t)
          const ny = cy + r * Math.sin(t)
          emitCapsule(px, py, nx, ny, halfW, rgba)
          px = nx
          py = ny
        }
      }
    } else {
      for (const item of layer.items) {
        const rgba = hexToBytes(doc.palette[item.c])
        const x = item.x * inv
        const y = item.y * inv
        emitCapsule(x, y, x, y, item.r * inv, rgba)
      }
    }
  }

  return {
    sdf: { quad, axisA, axisB, radius, color: sdfColor, indices },
    mesh: { position: meshPosition, color: meshColor },
    capsuleCount,
    triangleCount
  }
}
