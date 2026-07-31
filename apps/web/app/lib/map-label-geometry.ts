/*
 * Pure logic for the map label layer: parsing app/data/map-labels.json (built by
 * scripts/build-map-labels.ts from the source PDF) and app/data/map-label-atlas.json
 * (built by scripts/build-map-label-atlas.ts from the PT Sans families), and
 * expanding them into the typed arrays map-label-layer.ts uploads. No GL here —
 * the vitest side of the pure/GL split, mirroring map-vector-geometry.ts.
 *
 * Every glyph becomes one quad: world-space corners (baseline origin + per-char
 * offset rotated along the run direction + glyph metric offsets — all computed
 * here once), MSDF atlas UVs, fill and halo colors, and the halo expansion in
 * distance-field units so mixed font sizes render in a single pass.
 */

export interface MapLabelsDoc {
  version: string
  /** Fixed-point divisor: stored integers are world units times this. */
  scale: number
  fonts: string[]
  palette: string[]
  runs: LabelRunDoc[]
}

export interface LabelRunDoc {
  f: number
  /** Font size, fixed-point world units. */
  s: number
  c: number
  /** Optional halo palette index; absent = no halo. */
  h?: number
  x: number
  y: number
  /** Optional unit baseline direction x1000; absent = horizontal. */
  d?: [number, number]
  t: string
  /** Per-code-point offsets along the baseline, fixed-point world. */
  a: number[]
}

export interface LabelAtlasGlyph {
  x: number
  y: number
  w: number
  h: number
  /** Offsets from the pen position (BMFont convention), atlas px. */
  xo: number
  yo: number
}

export interface LabelAtlasFont {
  name: string
  /** Font pixel size the glyph metrics are expressed in. */
  fontSize: number
  /** Baseline offset from the line-cell top, atlas px. */
  base: number
  glyphs: Record<string, LabelAtlasGlyph>
}

export interface LabelAtlasDoc {
  size: [number, number]
  /** MSDF distance range, atlas px. */
  distanceRange: number
  fonts: LabelAtlasFont[]
}

export interface LabelBuffers {
  position: Float32Array
  uv: Float32Array
  color: Uint8Array
  halo: Uint8Array
  /** Halo expansion as a fraction of distanceRange, quantized to a byte. */
  haloExpand: Uint8Array
  indices: Uint32Array
  glyphCount: number
}

/**
 * The artwork's glyph halo is a white stroke of ~9.3 world units, i.e. an
 * outward expansion of half that beyond the outline.
 */
export const HALO_EXPAND_WORLD = 4.65

export function parseMapLabels(raw: unknown): MapLabelsDoc {
  const doc = raw as MapLabelsDoc
  if (!doc || typeof doc !== 'object') throw new Error('map-labels: not an object')
  if (typeof doc.scale !== 'number' || doc.scale <= 0) throw new Error('map-labels: bad scale')
  if (!Array.isArray(doc.fonts) || doc.fonts.length === 0) throw new Error('map-labels: bad fonts')
  if (!Array.isArray(doc.palette) || doc.palette.some(c => !/^#[0-9A-F]{6}$/.test(c))) {
    throw new Error('map-labels: bad palette')
  }
  if (!Array.isArray(doc.runs)) throw new Error('map-labels: bad runs')
  for (const run of doc.runs) {
    if (run.f < 0 || run.f >= doc.fonts.length) throw new Error(`map-labels: font index ${run.f} out of bounds`)
    if (run.c < 0 || run.c >= doc.palette.length) throw new Error(`map-labels: palette index ${run.c} out of bounds`)
    if (run.h !== undefined && (run.h < 0 || run.h >= doc.palette.length)) {
      throw new Error(`map-labels: halo palette index ${run.h} out of bounds`)
    }
    if (!(run.s > 0) || !Number.isFinite(run.x) || !Number.isFinite(run.y)) {
      throw new Error('map-labels: malformed run geometry')
    }
    if (typeof run.t !== 'string' || run.t.length === 0) throw new Error('map-labels: empty run text')
    const codePoints = [...run.t]
    if (!Array.isArray(run.a) || run.a.length !== codePoints.length) {
      throw new Error(`map-labels: run "${run.t}" has ${run.a?.length} offsets for ${codePoints.length} code points`)
    }
    if (run.d !== undefined) {
      const len = Math.hypot(run.d[0], run.d[1]) / 1000
      if (Math.abs(len - 1) > 0.01) throw new Error(`map-labels: run "${run.t}" direction is not unit length`)
    }
  }
  return doc
}

export function parseLabelAtlas(raw: unknown): LabelAtlasDoc {
  const doc = raw as LabelAtlasDoc
  if (!doc || typeof doc !== 'object') throw new Error('label-atlas: not an object')
  if (!Array.isArray(doc.size) || doc.size.length !== 2 || !(doc.size[0] > 0) || !(doc.size[1] > 0)) {
    throw new Error('label-atlas: bad size')
  }
  if (!(doc.distanceRange > 0)) throw new Error('label-atlas: bad distanceRange')
  if (!Array.isArray(doc.fonts) || doc.fonts.length === 0) throw new Error('label-atlas: no fonts')
  for (const font of doc.fonts) {
    if (!(font.fontSize > 0)) throw new Error(`label-atlas: font ${font.name} bad fontSize`)
    if (!font.glyphs || typeof font.glyphs !== 'object') throw new Error(`label-atlas: font ${font.name} has no glyphs`)
  }
  return doc
}

/** True for characters whose absence from the atlas is fine (they draw nothing). */
function isSkippableWhitespace(ch: string): boolean {
  return /^\s$/.test(ch)
}

/**
 * Expands labels + atlas metrics into GPU-ready arrays. Quads are appended in
 * document (run) order and indexed sequentially, so one drawElements reproduces
 * the paint order. All fixed-point decode and metric math happens here, once.
 */
export function buildLabelBuffers(labels: MapLabelsDoc, atlas: LabelAtlasDoc): LabelBuffers {
  const inv = 1 / labels.scale
  const [atlasW, atlasH] = atlas.size

  // Count drawable glyphs first for exact allocation.
  let glyphCount = 0
  for (const run of labels.runs) {
    const font = atlas.fonts[run.f]
    if (!font) throw new Error(`label-buffers: run "${run.t}" references missing atlas font ${run.f}`)
    for (const ch of run.t) {
      if (font.glyphs[ch]) {
        glyphCount++
      } else if (!isSkippableWhitespace(ch)) {
        throw new Error(`label-buffers: glyph "${ch}" (font ${font.name}) missing from atlas`)
      }
    }
  }

  const position = new Float32Array(glyphCount * 4 * 2)
  const uv = new Float32Array(glyphCount * 4 * 2)
  const color = new Uint8Array(glyphCount * 4 * 4)
  const halo = new Uint8Array(glyphCount * 4 * 4)
  const haloExpand = new Uint8Array(glyphCount * 4)
  const indices = new Uint32Array(glyphCount * 6)

  const hexBytes = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]

  let gi = 0
  for (const run of labels.runs) {
    const font = atlas.fonts[run.f]
    const sizeWorld = run.s * inv
    // World units per atlas font pixel.
    const pxScale = sizeWorld / font.fontSize
    const dx = run.d ? run.d[0] / 1000 : 1
    const dy = run.d ? run.d[1] / 1000 : 0
    const ox = run.x * inv
    const oy = run.y * inv

    const fill = hexBytes(labels.palette[run.c])
    const haloRgb = run.h !== undefined ? hexBytes(labels.palette[run.h]) : [0, 0, 0] as [number, number, number]
    const haloA = run.h !== undefined ? 255 : 0
    // Halo expansion in distance-field units (fraction of distanceRange).
    const expandPx = HALO_EXPAND_WORLD / pxScale
    const expandByte = run.h !== undefined
      ? Math.max(0, Math.min(255, Math.round((expandPx / atlas.distanceRange) * 255)))
      : 0

    const codePoints = [...run.t]
    for (let i = 0; i < codePoints.length; i++) {
      const glyph = font.glyphs[codePoints[i]]
      if (!glyph) continue

      const along = run.a[i] * inv
      // Pen position for this char, world space.
      const px = ox + dx * along
      const py = oy + dy * along
      // Glyph box corners relative to the pen, in atlas px (BMFont: yo is from
      // the line-cell top; base shifts it to be baseline-relative).
      const left = glyph.xo * pxScale
      const top = (glyph.yo - font.base) * pxScale
      const w = glyph.w * pxScale
      const h = glyph.h * pxScale

      // Rotate the local (right, down) frame onto the baseline direction.
      const corner = (lx: number, ly: number): [number, number] => [
        px + dx * lx - dy * ly,
        py + dy * lx + dx * ly
      ]
      const corners = [
        corner(left, top),
        corner(left + w, top),
        corner(left, top + h),
        corner(left + w, top + h)
      ]
      const uvs = [
        [glyph.x / atlasW, glyph.y / atlasH],
        [(glyph.x + glyph.w) / atlasW, glyph.y / atlasH],
        [glyph.x / atlasW, (glyph.y + glyph.h) / atlasH],
        [(glyph.x + glyph.w) / atlasW, (glyph.y + glyph.h) / atlasH]
      ]

      for (let v = 0; v < 4; v++) {
        position[gi * 8 + v * 2 + 0] = corners[v][0]
        position[gi * 8 + v * 2 + 1] = corners[v][1]
        uv[gi * 8 + v * 2 + 0] = uvs[v][0]
        uv[gi * 8 + v * 2 + 1] = uvs[v][1]
        color[gi * 16 + v * 4 + 0] = fill[0]
        color[gi * 16 + v * 4 + 1] = fill[1]
        color[gi * 16 + v * 4 + 2] = fill[2]
        color[gi * 16 + v * 4 + 3] = 255
        halo[gi * 16 + v * 4 + 0] = haloRgb[0]
        halo[gi * 16 + v * 4 + 1] = haloRgb[1]
        halo[gi * 16 + v * 4 + 2] = haloRgb[2]
        halo[gi * 16 + v * 4 + 3] = haloA
        haloExpand[gi * 4 + v] = expandByte
      }
      const base = gi * 4
      indices[gi * 6 + 0] = base + 0
      indices[gi * 6 + 1] = base + 1
      indices[gi * 6 + 2] = base + 2
      indices[gi * 6 + 3] = base + 2
      indices[gi * 6 + 4] = base + 1
      indices[gi * 6 + 5] = base + 3
      gi++
    }
  }

  return { position, uv, color, halo, haloExpand, indices, glyphCount }
}
