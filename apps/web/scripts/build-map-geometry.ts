/*
 * Builds app/data/map-geometry.json — render-grade vector geometry of the FDTJ map,
 * consumed by app/lib/map-vector-geometry.ts to draw the schematic as GPU primitives
 * instead of raster tiles.
 *
 * A fork of build-map-skeleton.ts, not an extension of it: the skeleton is a loading
 * animation with its own tuning and size budget, and retuning one must never disturb
 * the other. Both read the committed tile SVGs in public/maps/fdtj/ for the reasons
 * documented in build-map-skeleton.ts (regenerable from a clone; never invalidates
 * tile cache), and both rely on the same losslessness argument: tiles clone whole
 * leaf elements, so deduplicating world-space geometry recovers the master's paths.
 *
 * Division of labour: the browser pass is deliberately dumb — it walks every rendered
 * body element in document order and reports raw resolved style plus world-space
 * geometry. All classification (what is a corridor, a casing, a station disc, sheet
 * furniture) happens in Node afterwards, where it is inspectable and re-runnable.
 * Every element is either claimed by exactly one class or lands in an audit bucket
 * that is printed at the end; saturated strokes left unclaimed fail the build.
 *
 * The sheet frame (title header, legend sidebar, grid rulers) is excluded: only
 * geometry inside the map canvas — the bbox of the large #F3F4F3 background fill —
 * is extracted.
 *
 * Run: pnpm build:map-geometry
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import earcut from 'earcut'
import { channelDistance, simplify } from './lib/map-extract-common'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(SCRIPT_DIR, '..')
const TILE_DIR = path.join(WEB_ROOT, 'public', 'maps', 'fdtj')
const OUT_PATH = path.join(WEB_ROOT, 'app', 'data', 'map-geometry.json')

// Curve flattening. Render-grade: 0.25 world units is one device pixel at the deepest
// zoom the renderer reaches (scale * dpr = 4), so flattening is invisible everywhere.
const SAMPLE_STEP = 2
const MAX_SAMPLES = 8000
const SIMPLIFY_EPSILON = 0.25

// Fixed-point factor for the output: coordinates, widths and radii are stored as
// integers of quarter world units, matching SIMPLIFY_EPSILON's resolution.
const FIXED_POINT = 4

// Colour predicates, same thresholds as the skeleton's corridor filter.
const MIN_SATURATION = 0.18
const MIN_LIGHTNESS = 0.12
const MAX_LIGHTNESS = 0.92
// "White" tolerates pdf2svg's percentage rounding (255 vs 254 per channel).
const WHITE_TOLERANCE = 8
const GRID_COLOR = '#E0E1E1'
const GRID_COLOR_TOLERANCE = 10

// Stroke width classes, world units. Widths carry sub-unit jitter from the PDF
// (24.755, 15.001, 14.908 all occur), so each stroke snaps to the nearest class
// centre within the class tolerance; colour predicates disambiguate neighbours
// (saturated 15 is BRT, white 14 is a connector).
interface WidthClass {
  w: number
  cls: string
  tol: number
}
const SATURATED_CLASSES: WidthClass[] = [
  { w: 25, cls: 'rail', tol: 1.2 },
  // The high-speed rail corridor (Whoosh green) is inked at 20, between the
  // BRT and rail weights. Same layer as rail; items keep their true width.
  { w: 20, cls: 'rail', tol: 0.6 },
  { w: 15, cls: 'brt', tol: 1.2 }
]
const DARK_CLASSES: WidthClass[] = [
  { w: 27, cls: 'line-dark', tol: 1.2 }
]
const WHITE_CLASSES: WidthClass[] = [
  { w: 34, cls: 'casing-rail', tol: 1.2 },
  // The cyan C-line's casing is inked at 32, not 34. It must merge into the
  // rail layer's document order or it draws over its own line and erases it.
  { w: 32, cls: 'casing-rail', tol: 1.2 },
  { w: 20, cls: 'casing-brt', tol: 1.2 },
  // Express BRT sections ("Bagian Lin BRT Ekspres"): white runs drawn over the
  // corridor fill, same neighbourhood as the connectors.
  { w: 15.28, cls: 'connector', tol: 0.4 },
  { w: 14, cls: 'connector', tol: 0.4 },
  { w: 13, cls: 'connector', tol: 0.4 },
  { w: 12, cls: 'connector', tol: 0.4 },
  { w: 11, cls: 'connector', tol: 0.4 },
  { w: 9.294, cls: 'text-halo', tol: 0.4 },
  { w: 9, cls: 'text-halo', tol: 0.25 },
  { w: 6.464, cls: 'connector', tol: 0.4 }
]
const GRAY_CLASSES: WidthClass[] = [
  // Rail-width gray corridor (airport/intercity rail on the sheet's gray ink).
  { w: 25, cls: 'rail-gray', tol: 0.6 },
  { w: 22.677, cls: 'casing-gray', tol: 0.5 },
  { w: 8, cls: 'grid', tol: 0.5 },
  // Heavier gray sheet furniture: runways, river casings, terminal links.
  { w: 42.32, cls: 'furniture', tol: 0.6 },
  // Interchange walkway bands (the gray diagonal at Manggarai): drawn after
  // the corridors and black bars in the document, so they get their own layer
  // above line-dark rather than sinking into bottom furniture.
  { w: 41, cls: 'band', tol: 0.6 },
  { w: 32, cls: 'furniture', tol: 1.2 },
  { w: 21.03, cls: 'furniture', tol: 0.4 },
  { w: 20, cls: 'furniture', tol: 0.4 },
  { w: 15.42, cls: 'furniture', tol: 0.4 },
  { w: 13.74, cls: 'furniture', tol: 0.4 },
  { w: 12.14, cls: 'furniture', tol: 0.4 }
]
// Below this width an unclaimed stroke is landmark/icon linework (the Monas
// artwork, logos), excluded and counted rather than failing the build. At or
// above it an unclaimed saturated stroke is a missed transit corridor.
const CORRIDOR_MIN_WIDTH = 10

// Fills. A disc is a square-bbox fill in the station size range; anything larger
// than REGION_MIN_DIM in either dimension is an area fill (water, parks, urban
// regions) that gets triangulated; the small remainder (roundels, icons, arrows)
// is text/iconography for a later phase.
const DISC_MIN = 20
const DISC_MAX = 70
const DISC_SQUARENESS = 3
const REGION_MIN_DIM = 150
// Route-number badges: saturated pills (~85×42) whose text renders in the label
// phase, and letter roundels (~92×92) which are annuli like the station rings.
const BADGE_H_MIN = 36
const BADGE_H_MAX = 48
const BADGE_ASPECT_MIN = 1.6
const BADGE_ASPECT_MAX = 2.6
const ROUNDEL_MIN = 72
const ROUNDEL_MAX = 100

// Painter's order of the output, bottom to top, verified against the tiles'
// document order. The artwork does NOT draw all casings under all lines: each
// corridor is a casing+line *pair* in document order (casing at index n, its
// line at n+1), corridor by corridor, so a crossing corridor's white casing
// visibly cuts across the lines drawn before it. The 'brt' and 'rail' output
// layers therefore contain their casings too, interleaved in master document
// order recovered by mergeDocOrder(). All of BRT precedes all of rail in the
// document, which is what keeps them expressible as two separate layers.
const LAYER_ORDER = [
  'region-fill',
  'casing-gray',
  'grid',
  'furniture',
  'dashed',
  'brt',
  'rail',
  'rail-gray',
  'line-dark',
  'band',
  'connector',
  'disc',
  'ring',
  'badge',
  'badge-ring'
]
// Classes folded into a merged corridor layer, in that layer's doc order.
const MERGED_LAYERS: Record<string, string[]> = {
  brt: ['casing-brt', 'brt'],
  rail: ['casing-rail', 'rail']
}

// Guardrails, in the spirit of the skeleton's MIN_STROKES: a future map edition that
// shifts widths or colours must fail the build, not silently thin the geometry.
const MIN_COUNTS: Record<string, number> = {
  'rail': 14,
  'brt': 30,
  'casing-rail': 10,
  'disc': 300,
  'ring': 250,
  'badge': 40,
  'badge-ring': 6,
  // The street grid is *dotted* in the artwork, so it arrives through the dash
  // expander rather than as a solid 'grid' class.
  'dashed': 3000,
  'region-fill': 3
}
const MAX_BYTES = 1.5 * 1024 * 1024

interface RawSubpath {
  pts: number[][]
  closed: boolean
}

/** One rendered body element, as reported by the browser pass. */
interface RawElement {
  idx: number
  stroke: string | null
  strokeWidth: number
  dash: number[] | null
  fill: string | null
  opacity: number
  bbox: [number, number, number, number]
  curved: boolean
  subpaths: RawSubpath[]
}

interface StrokeItem {
  cls: string
  color: string
  width: number
  pts: number[][]
  /** (tileIdx, docIdx) of every tile this item was seen in, for order merging. */
  occ: [number, number][]
}

interface DiscItem {
  color: string
  x: number
  y: number
  r: number
}

interface MeshItem {
  color: string
  tris: number[]
}

/** Annulus marker: centreline radius r, ring width w. */
interface RingItem {
  color: string
  x: number
  y: number
  r: number
  w: number
}

function log(msg: string): void {
  console.log(`[build-map-geometry] ${msg}`)
}

/**
 * Reports every rendered body element of the SVG currently loaded in the page, in
 * document order, with resolved style and world-space geometry. No classification
 * happens here — see the header comment.
 */
async function extractElements(page: import('playwright').Page): Promise<RawElement[]> {
  return await page.evaluate((cfg: {
    sampleStep: number
    maxSamples: number
    discMin: number
    discMax: number
    discSquareness: number
    regionMinDim: number
    roundelMax: number
  }) => {
    const root = document.querySelector('svg')!
    const rootInverse = root.getScreenCTM()!.inverse()

    const parseColor = (value: string): string | null => {
      const match = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(value)
      if (!match) return null
      return '#' + [match[1], match[2], match[3]]
        .map(v => Math.round(Number(v)).toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
    }

    const round = (v: number) => Math.round(v * 100) / 100

    const out: {
      idx: number
      stroke: string | null
      strokeWidth: number
      dash: number[] | null
      fill: string | null
      opacity: number
      bbox: [number, number, number, number]
      curved: boolean
      subpaths: { pts: number[][], closed: boolean }[]
    }[] = []

    const els = Array.from(document.querySelectorAll<SVGGraphicsElement>('path, rect'))
    for (let idx = 0; idx < els.length; idx++) {
      const el = els[idx]
      // defs/clipPath/mask/pattern content is plumbing, not rendered artwork; glyph
      // outlines painted through <use> are excluded with their defs.
      if (el.closest('defs, clipPath, mask, pattern, symbol, filter')) continue

      const style = getComputedStyle(el)
      const stroke = style.stroke === 'none' ? null : parseColor(style.stroke)
      const fill = style.fill === 'none' ? null : parseColor(style.fill)
      if (!stroke && !fill) continue

      const ctm = rootInverse.multiply(el.getScreenCTM()!)
      const areaScale = Math.sqrt(Math.abs(ctm.a * ctm.d - ctm.b * ctm.c)) || 1
      const toWorld = (x: number, y: number): number[] => [
        round(ctm.a * x + ctm.c * y + ctm.e),
        round(ctm.b * x + ctm.d * y + ctm.f)
      ]

      const strokeWidth = stroke ? round(parseFloat(style.strokeWidth) * areaScale) : 0
      let dash: number[] | null = null
      if (stroke && style.strokeDasharray !== 'none') {
        dash = style.strokeDasharray.split(',').map(v => round(parseFloat(v) * areaScale))
        if (dash.some(v => !Number.isFinite(v)) || dash.length === 0) dash = null
      }
      const opacity = round(
        parseFloat(style.opacity)
        * Math.max(parseFloat(style.fillOpacity) || 1, parseFloat(style.strokeOpacity) || 1)
      )

      const box = el.getBBox()
      const corners = [
        toWorld(box.x, box.y),
        toWorld(box.x + box.width, box.y),
        toWorld(box.x, box.y + box.height),
        toWorld(box.x + box.width, box.y + box.height)
      ]
      const xs = corners.map(c => c[0])
      const ys = corners.map(c => c[1])
      const bbox: [number, number, number, number] = [
        Math.min(...xs), Math.min(...ys),
        Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)
      ]

      const subpaths: { pts: number[][], closed: boolean }[] = []
      const curved = /[CSQTA]/.test(el.getAttribute('d') ?? '')

      // Geometry is the expensive part (clone + arc-length sampling), and three
      // populous element groups never need it: potential station discs are placed
      // from their bbox alone; sub-region small fills (roundels, icons, glyph
      // fills) and white glyph halos are excluded by the classifier anyway. The
      // predicates here are deliberately *wider* than the Node classifiers so a
      // skip can never lose geometry the classifier would have kept.
      const maxDim = Math.max(bbox[2], bbox[3])
      const nearWhite = (hex: string | null): boolean => {
        if (!hex) return false
        return parseInt(hex.slice(1, 3), 16) >= 247
          && parseInt(hex.slice(3, 5), 16) >= 247
          && parseInt(hex.slice(5, 7), 16) >= 247
      }
      let geometryNeeded = true
      if (!stroke && fill) {
        const squarish = Math.abs(bbox[2] - bbox[3]) <= cfg.discSquareness
        // Annulus candidates reach past the disc range up to the letter-roundel
        // size (92.2 world units): a square fill with multiple subpaths may be a
        // ring (station marker or roundel — concentric circles with a fill-rule
        // hole), and ring detection needs the actual rings — keep its geometry.
        const ringCandidate = squarish && bbox[2] >= cfg.discMin && bbox[2] <= cfg.roundelMax
        const discCandidate = squarish && bbox[2] >= cfg.discMin && bbox[2] <= cfg.discMax
        const subpathCount = (el.getAttribute('d')?.match(/M/g) ?? []).length
        const keepForRings = ringCandidate && subpathCount >= 2
        if (!keepForRings) {
          if (discCandidate && subpathCount < 2) {
            geometryNeeded = false
          } else if (!discCandidate && maxDim < cfg.regionMinDim) {
            geometryNeeded = false
          }
        }
      } else if (stroke && !fill && curved && nearWhite(stroke)
        && strokeWidth >= 5 && strokeWidth <= 10.5 && maxDim < 150) {
        geometryNeeded = false
      }

      if (!geometryNeeded) {
        out.push({ idx, stroke, strokeWidth, dash, fill, opacity, bbox, curved, subpaths })
        continue
      }

      if (el.tagName === 'rect') {
        const x = Number(el.getAttribute('x') ?? 0)
        const y = Number(el.getAttribute('y') ?? 0)
        const w = Number(el.getAttribute('width') ?? 0)
        const h = Number(el.getAttribute('height') ?? 0)
        subpaths.push({
          pts: [toWorld(x, y), toWorld(x + w, y), toWorld(x + w, y + h), toWorld(x, y + h)],
          closed: true
        })
      } else {
        const rawD = el.getAttribute('d') ?? ''
        // Splitting a compound path on 'M' is only sound while every command is
        // absolute; pdf2svg emits absolute exclusively. Fail loudly if that changes.
        if (/[achlmqstvz]/.test(rawD)) {
          throw new Error(`relative path command in ${rawD.slice(0, 60)}...`)
        }

        const pieces = rawD.split(/(?=M)/).map(x => x.trim()).filter(Boolean)
        const parent = el.parentNode!
        for (const sub of pieces) {
          const closed = /Z\s*$/.test(sub)

          if (!/[CSQTA]/.test(sub)) {
            // Pure line geometry: read the coordinates directly instead of arc-length
            // sampling. This is the numerically dominant case (the street grid) and
            // keeps its endpoints exact.
            const pts: number[][] = []
            const re = /([MLHV])\s*((?:[\d.-]+[\s,]*)*)/g
            let m: RegExpExecArray | null
            let last: number[] | null = null
            while ((m = re.exec(sub)) !== null) {
              const nums = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number)
              if (m[1] === 'H') {
                for (const v of nums) {
                  last = [v, last ? last[1] : 0]
                  pts.push(last)
                }
              } else if (m[1] === 'V') {
                for (const v of nums) {
                  last = [last ? last[0] : 0, v]
                  pts.push(last)
                }
              } else {
                for (let i = 0; i + 1 < nums.length; i += 2) {
                  last = [nums[i], nums[i + 1]]
                  pts.push(last)
                }
              }
            }
            if (pts.length >= 2) {
              subpaths.push({ pts: pts.map(p => toWorld(p[0], p[1])), closed })
            }
            continue
          }

          // Curved: flatten by arc length on a throwaway clone so compound paths
          // don't grow phantom connectors between their pieces.
          const temp = el.cloneNode(false) as SVGPathElement
          temp.setAttribute('d', sub)
          parent.appendChild(temp)
          try {
            const len = temp.getTotalLength()
            if (len <= 0) continue
            const count = Math.min(cfg.maxSamples, Math.max(2, Math.ceil(len * areaScale / cfg.sampleStep)))
            const pts: number[][] = []
            for (let i = 0; i <= count; i++) {
              const p = temp.getPointAtLength(i * len / count)
              pts.push(toWorld(p.x, p.y))
            }
            subpaths.push({ pts, closed })
          } finally {
            parent.removeChild(temp)
          }
        }
      }

      if (subpaths.length === 0) continue
      out.push({ idx, stroke, strokeWidth, dash, fill, opacity, bbox, curved, subpaths })
    }

    return out
  }, {
    sampleStep: SAMPLE_STEP,
    maxSamples: MAX_SAMPLES,
    discMin: DISC_MIN,
    discMax: DISC_MAX,
    discSquareness: DISC_SQUARENESS,
    regionMinDim: REGION_MIN_DIM,
    roundelMax: ROUNDEL_MAX
  })
}

function rgbToHsl(hex: string): { s: number, l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { s: 0, l }
  const delta = max - min
  return { s: l > 0.5 ? delta / (2 - max - min) : delta / (max + min), l }
}

function isWhite(hex: string): boolean {
  return channelDistance(hex, '#FFFFFF') <= WHITE_TOLERANCE
}

function nearestClass(width: number, classes: WidthClass[]): string | null {
  let best: WidthClass | null = null
  let bestDist = Infinity
  for (const c of classes) {
    const d = Math.abs(width - c.w)
    if (d <= c.tol && d < bestDist) {
      best = c
      bestDist = d
    }
  }
  return best ? best.cls : null
}

/**
 * Classifies one stroked element. Returns the class name, 'text-halo' for excluded
 * glyph halos, or null for the audit bucket.
 */
function classifyStroke(el: RawElement): string | null {
  if (el.dash) return 'dashed'
  const color = el.stroke!
  const { s, l } = rgbToHsl(color)

  // The landmark drawings (Monas, mosques, stadiums) are inked in a distinctive
  // brown that is saturated enough to pass the corridor predicate, at widths up
  // to ~18. Iconography for a later phase, never a corridor.
  if (channelDistance(color, '#583716') <= 24) return 'landmark'

  if (s >= MIN_SATURATION && l >= MIN_LIGHTNESS && l <= MAX_LIGHTNESS) {
    return nearestClass(el.strokeWidth, SATURATED_CLASSES)
  }
  if (l < 0.15) {
    return nearestClass(el.strokeWidth, DARK_CLASSES)
  }
  if (isWhite(color)) {
    return nearestClass(el.strokeWidth, WHITE_CLASSES)
  }
  if (channelDistance(color, GRID_COLOR) <= GRID_COLOR_TOLERANCE && Math.abs(el.strokeWidth - 8) <= 0.5) {
    return 'grid'
  }
  return nearestClass(el.strokeWidth, GRAY_CLASSES)
}

/** Cumulative length walk emitting the "on" runs of a dash pattern as polylines. */
function expandDash(pts: number[][], dash: number[]): number[][][] {
  const pattern = dash.length % 2 === 1 ? [...dash, ...dash] : dash
  const total = pattern.reduce((a, b) => a + b, 0)
  // A zero or negative entry would stall the cumulative walk below.
  if (total <= 0 || pattern.some(v => v <= 0)) return [pts]

  const runs: number[][][] = []
  let run: number[][] = []
  let patIdx = 0
  let remaining = pattern[0]
  let on = true

  const flush = () => {
    if (run.length >= 2) runs.push(run)
    run = []
  }

  if (on) run.push(pts[0])
  for (let i = 1; i < pts.length; i++) {
    let ax = pts[i - 1][0]
    let ay = pts[i - 1][1]
    const bx = pts[i][0]
    const by = pts[i][1]
    let segLen = Math.hypot(bx - ax, by - ay)

    while (segLen > remaining) {
      const t = remaining / segLen
      const mx = ax + (bx - ax) * t
      const my = ay + (by - ay) * t
      if (on) {
        run.push([mx, my])
        flush()
      } else {
        run = [[mx, my]]
      }
      on = !on
      ax = mx
      ay = my
      segLen -= remaining
      patIdx = (patIdx + 1) % pattern.length
      remaining = pattern[patIdx]
    }

    remaining -= segLen
    if (on) run.push([bx, by])
  }
  flush()
  return runs
}

/**
 * Triangulates the closed rings of a filled element. Ring 0 is the outer contour;
 * later rings inside it are holes, rings outside it start new polygons (pdf2svg
 * emits compound paths both ways).
 */
function triangulateRings(rings: number[][][]): number[] {
  const inside = (pt: number[], ring: number[][]): boolean => {
    let winding = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
        winding = !winding
      }
    }
    return winding
  }

  const polygons: { outer: number[][], holes: number[][][] }[] = []
  for (const ring of rings) {
    if (ring.length < 3) continue
    const owner = polygons.find(p => inside(ring[0], p.outer))
    if (owner) {
      owner.holes.push(ring)
    } else {
      polygons.push({ outer: ring, holes: [] })
    }
  }

  const tris: number[] = []
  for (const poly of polygons) {
    const flat: number[] = []
    const holeIndices: number[] = []
    for (const p of poly.outer) flat.push(p[0], p[1])
    for (const hole of poly.holes) {
      holeIndices.push(flat.length / 2)
      for (const p of hole) flat.push(p[0], p[1])
    }
    const indices = earcut(flat, holeIndices.length > 0 ? holeIndices : undefined)
    for (const i of indices) {
      tris.push(flat[i * 2], flat[i * 2 + 1])
    }
  }
  return tris
}

function fixed(v: number): number {
  return Math.round(v * FIXED_POINT)
}

/**
 * Detects an annulus: exactly two concentric near-circular subpaths, one inside
 * the other (the station marker is a hole-punched black ring over a white disc).
 * Returns the outer and inner radii, or null when the element is a plain disc
 * or something more ornate (an icon), which stays on the disc path.
 */
function detectRing(el: RawElement, cx: number, cy: number): { outer: number, inner: number } | null {
  if (el.subpaths.length !== 2) return null
  const radii: number[] = []
  for (const sub of el.subpaths) {
    if (sub.pts.length < 6) return null
    let sum = 0
    let min = Infinity
    let max = 0
    for (const p of sub.pts) {
      const d = Math.hypot(p[0] - cx, p[1] - cy)
      sum += d
      min = Math.min(min, d)
      max = Math.max(max, d)
    }
    const mean = sum / sub.pts.length
    // Non-circular or off-centre subpaths are icon artwork, not a ring.
    if (max - min > Math.max(1.5, mean * 0.15)) return null
    radii.push(mean)
  }
  const [a, b] = radii
  const outer = Math.max(a, b)
  const inner = Math.min(a, b)
  if (outer - inner < 0.75) return null
  return { outer, inner }
}

/**
 * Detects a stroked circle: the badge outlines (the CB/BK "02" circles, the
 * planned-stop rings) are drawn as circle *strokes*, not annulus fills, so
 * they never reach the fill-side ring detection. Centreline radius is half the
 * geometric bbox (getBBox excludes stroke width).
 */
function detectRingStroke(el: RawElement): RingItem | null {
  if (!el.stroke || el.dash || !el.curved) return null
  if (el.strokeWidth < 3 || el.strokeWidth > 7.2) return null
  const [, , w, h] = el.bbox
  if (Math.abs(w - h) > DISC_SQUARENESS) return null
  if (w < DISC_MIN || w > ROUNDEL_MAX) return null
  const cx = el.bbox[0] + w / 2
  const cy = el.bbox[1] + h / 2
  // Fill+stroke circles (a white disc with a colored outline) were geometry-
  // skipped as disc candidates, so there is nothing to verify circularity
  // against — the square bbox and stroke-width gates carry the decision.
  if (el.subpaths.length === 0) {
    return el.fill ? { color: el.stroke, x: cx, y: cy, r: w / 2, w: el.strokeWidth } : null
  }
  if (el.subpaths.length !== 1) return null
  const pts = el.subpaths[0].pts
  if (pts.length < 8) return null
  let min = Infinity
  let max = 0
  for (const p of pts) {
    const d = Math.hypot(p[0] - cx, p[1] - cy)
    min = Math.min(min, d)
    max = Math.max(max, d)
  }
  if (max - min > Math.max(1.5, (w / 2) * 0.15)) return null
  return { color: el.stroke, x: cx, y: cy, r: w / 2, w: el.strokeWidth }
}

/**
 * Merges per-tile document-order sequences of item keys into one global order.
 *
 * Every tile's sequence is a projection of the master document's paint order
 * (writeTile clones leaves in document order), so consecutive-pair edges from
 * all tiles form a DAG whose topological order *is* the master order restricted
 * to these items. Ties (items that never co-occur) break by first appearance,
 * keeping the output deterministic. A cycle means two tiles genuinely disagree,
 * which breaks the losslessness assumption — fail the build.
 */
function mergeDocOrder(sequences: string[][]): string[] {
  const succ = new Map<string, Set<string>>()
  const indegree = new Map<string, number>()
  const firstSeen = new Map<string, number>()
  let seen = 0

  for (const seq of sequences) {
    for (let i = 0; i < seq.length; i++) {
      const key = seq[i]
      if (!firstSeen.has(key)) {
        firstSeen.set(key, seen++)
        indegree.set(key, 0)
        succ.set(key, new Set())
      }
      if (i > 0 && seq[i - 1] !== key) {
        const prev = succ.get(seq[i - 1])!
        if (!prev.has(key)) {
          prev.add(key)
          indegree.set(key, indegree.get(key)! + 1)
        }
      }
    }
  }

  const ready = [...indegree].filter(([, d]) => d === 0).map(([k]) => k)
  const out: string[] = []
  while (ready.length > 0) {
    ready.sort((a, b) => firstSeen.get(a)! - firstSeen.get(b)!)
    const key = ready.shift()!
    out.push(key)
    for (const next of succ.get(key)!) {
      const d = indegree.get(next)! - 1
      indegree.set(next, d)
      if (d === 0) ready.push(next)
    }
  }
  if (out.length !== indegree.size) {
    throw new Error('cycle merging document order — tiles disagree on paint order')
  }
  return out
}

function serializePts(pts: number[][]): string {
  return pts.map(p => `${fixed(p[0])},${fixed(p[1])}`).join(' ')
}

async function main(): Promise<void> {
  const tiles = readdirSync(TILE_DIR).filter(f => /^tile-\d+-\d+\.svg$/.test(f)).sort()
  if (tiles.length === 0) throw new Error(`no tile SVGs in ${TILE_DIR}`)
  log(`source: ${tiles.length} tile SVGs in ${path.relative(WEB_ROOT, TILE_DIR)}`)

  const manifest = JSON.parse(readFileSync(path.join(TILE_DIR, 'manifest.json'), 'utf8'))
  const viewBox: number[] = manifest.viewBox

  // The browser pass takes ~20 minutes; classification is seconds. While tuning
  // classifiers, MAP_GEOMETRY_RAW_CACHE=1 reuses the previous run's raw
  // extraction. Never set it after editing the tiles or extractElements().
  const cachePath = path.join(WEB_ROOT, 'node_modules', '.cache', 'map-geometry-raw.json')
  const useCache = process.env.MAP_GEOMETRY_RAW_CACHE === '1' && existsSync(cachePath)

  // Pass 1: raw elements per tile, kept per tile for the document-order merge.
  let perTile: RawElement[][]
  if (useCache) {
    perTile = JSON.parse(readFileSync(cachePath, 'utf8')) as RawElement[][]
    log(`using cached raw extraction from ${path.relative(WEB_ROOT, cachePath)} (${perTile.length} tiles)`)
    if (perTile.length !== tiles.length) throw new Error('raw cache is stale — tile count changed')
  } else {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    // tsx (via esbuild keepNames) emits __name() calls inside the function we ship
    // to page.evaluate. The browser context lacks that helper, so shim it.
    await page.addInitScript(() => {
      // @ts-expect-error - shim for esbuild keepNames helper
      globalThis.__name = (fn: unknown) => fn
    })
    perTile = []
    const startedAt = Date.now()
    try {
      for (let i = 0; i < tiles.length; i++) {
        await page.goto('file://' + path.join(TILE_DIR, tiles[i]))
        perTile.push(await extractElements(page))
        if ((i + 1) % 8 === 0) {
          log(`  ${i + 1}/${tiles.length} tiles (${((Date.now() - startedAt) / 1000).toFixed(0)}s)`)
        }
      }
    } finally {
      await browser.close()
    }
    mkdirSync(path.dirname(cachePath), { recursive: true })
    writeFileSync(cachePath, JSON.stringify(perTile))
  }
  log(`extracted ${perTile.reduce((a, t) => a + t.length, 0)} raw elements`)

  // The map canvas is the bbox of the biggest #F3F4F3 fill on the sheet. Everything
  // whose bbox centre falls outside it is sheet frame (header, legends, rulers).
  let canvas: [number, number, number, number] | null = null
  for (const els of perTile) {
    for (const el of els) {
      if (!el.fill || channelDistance(el.fill, '#F3F4F3') > 4) continue
      const area = el.bbox[2] * el.bbox[3]
      if (!canvas || area > canvas[2] * canvas[3]) canvas = el.bbox
    }
  }
  if (!canvas) throw new Error('no #F3F4F3 canvas background fill found — frame exclusion cannot run')
  log(`map canvas: x ${canvas[0].toFixed(0)}..${(canvas[0] + canvas[2]).toFixed(0)}, y ${canvas[1].toFixed(0)}..${(canvas[1] + canvas[3]).toFixed(0)}`)
  const inCanvas = (el: RawElement): boolean => {
    const cx = el.bbox[0] + el.bbox[2] / 2
    const cy = el.bbox[1] + el.bbox[3] / 2
    const pad = 8
    return cx >= canvas![0] - pad && cx <= canvas![0] + canvas![2] + pad
      && cy >= canvas![1] - pad && cy <= canvas![1] + canvas![3] + pad
  }

  // Classification + dedup. Insertion order within each non-merged class
  // preserves per-tile document order, which is the z-order within a layer
  // (matters for stacked discs); the merged corridor layers get their exact
  // document order from mergeDocOrder() over the recorded occurrences.
  const strokeItems = new Map<string, StrokeItem>()
  const discItems = new Map<string, DiscItem>()
  const ringItems = new Map<string, RingItem>()
  const badgeRingItems = new Map<string, RingItem>()
  const meshItems = new Map<string, MeshItem>()
  const audit = new Map<string, number>()
  const excluded = new Map<string, number>()

  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1)

  for (let tileIdx = 0; tileIdx < perTile.length; tileIdx++) {
    for (const el of perTile[tileIdx]) {
      if (!inCanvas(el)) {
        bump(excluded, 'frame')
        continue
      }
      if (el.opacity < 0.99) bump(audit, `opacity ${el.opacity}`)

      if (el.fill) {
        const [, , w, h] = el.bbox
        const squarish = Math.abs(w - h) <= DISC_SQUARENESS
        const fillHsl = rgbToHsl(el.fill)
        const saturatedFill = fillHsl.s >= MIN_SATURATION
          && fillHsl.l >= MIN_LIGHTNESS && fillHsl.l <= MAX_LIGHTNESS
        if (squarish && w >= DISC_MIN && w <= DISC_MAX) {
          const x = el.bbox[0] + w / 2
          const y = el.bbox[1] + h / 2
          const ring = detectRing(el, x, y)
          if (ring) {
            // Annulus (the black station marker): stored compactly as a circle
            // ring the client expands into an SDF capsule chain — a solid disc
            // here would bury the white disc below it.
            const key = `${el.fill}|${fixed(x)}|${fixed(y)}`
            if (!ringItems.has(key)) {
              ringItems.set(key, {
                color: el.fill,
                x,
                y,
                r: (ring.outer + ring.inner) / 2,
                w: ring.outer - ring.inner
              })
            }
          } else {
            const key = `${el.fill}|${fixed(x)}|${fixed(y)}`
            if (!discItems.has(key)) {
              discItems.set(key, { color: el.fill, x, y, r: w / 2 })
            }
          }
        } else if (squarish && w >= ROUNDEL_MIN && w <= ROUNDEL_MAX) {
          // Letter roundels come in two constructions: annuli (the A/C markers
          // — a solid disc would paint over the letter inside) and stacked
          // solid discs (the CB/BK markers: a dark disc under a white disc,
          // any color incl. white). Claim both.
          const x = el.bbox[0] + w / 2
          const y = el.bbox[1] + h / 2
          const ring = detectRing(el, x, y)
          const key = `${el.fill}|${fixed(x)}|${fixed(y)}`
          if (ring) {
            if (!badgeRingItems.has(key)) {
              badgeRingItems.set(key, {
                color: el.fill,
                x,
                y,
                r: (ring.outer + ring.inner) / 2,
                w: ring.outer - ring.inner
              })
            }
          } else if (!discItems.has(key)) {
            discItems.set(key, { color: el.fill, x, y, r: w / 2 })
          }
        } else if (saturatedFill && h >= BADGE_H_MIN && h <= BADGE_H_MAX
          && w / h >= BADGE_ASPECT_MIN && w / h <= BADGE_ASPECT_MAX) {
          // Route-number badge pill: a capsule spanning the bbox (endcaps extend
          // r past the endpoints, recovering the full width). Reuses the stroke
          // kind so the runtime needs no changes.
          const cy = el.bbox[1] + h / 2
          const pts = [
            [el.bbox[0] + h / 2, cy],
            [el.bbox[0] + w - h / 2, cy]
          ]
          const key = `badge|${el.fill}|${serializePts(pts)}`
          if (!strokeItems.has(key)) {
            strokeItems.set(key, {
              cls: 'badge',
              color: el.fill,
              width: h,
              pts,
              occ: [[tileIdx, el.idx]]
            })
          }
        } else if (Math.max(w, h) >= REGION_MIN_DIM) {
          const rings = el.subpaths
            .filter(s => s.closed || s.pts.length >= 3)
            .map(s => simplify(s.pts, SIMPLIFY_EPSILON))
          const key = `mesh|${el.fill}|${rings.map(serializePts).join('|')}`
          if (!meshItems.has(key)) {
            const tris = triangulateRings(rings)
            if (tris.length > 0) meshItems.set(key, { color: el.fill, tris })
          }
        } else {
          bump(excluded, `small-fill ${el.fill}`)
        }
      }

      if (el.stroke && el.strokeWidth > 0) {
        const ringStroke = detectRingStroke(el)
        if (ringStroke) {
          const target = ringStroke.r * 2 >= ROUNDEL_MIN ? badgeRingItems : ringItems
          const key = `${ringStroke.color}|${fixed(ringStroke.x)}|${fixed(ringStroke.y)}`
          if (!target.has(key)) target.set(key, ringStroke)
          continue
        }

        const cls = classifyStroke(el)
        if (cls === null) {
          bump(audit, `stroke w=${el.strokeWidth} ${el.stroke}`)
          continue
        }
        if (cls === 'text-halo' || cls === 'landmark') {
          bump(excluded, cls)
          continue
        }

        for (const sub of el.subpaths) {
          const pts = sub.closed && sub.pts.length >= 3
            && (sub.pts[0][0] !== sub.pts[sub.pts.length - 1][0] || sub.pts[0][1] !== sub.pts[sub.pts.length - 1][1])
            ? [...sub.pts, sub.pts[0]]
            : sub.pts
          const simplified = simplify(pts, SIMPLIFY_EPSILON)
          if (simplified.length < 2) continue

          if (cls === 'dashed') {
            const runs = expandDash(simplified, el.dash!)
            for (let i = 0; i < runs.length; i++) {
              const key = `dashed|${el.stroke}|${el.strokeWidth}|${serializePts(simplified)}|${i}`
              const existing = strokeItems.get(key)
              if (existing) {
                existing.occ.push([tileIdx, el.idx])
              } else {
                strokeItems.set(key, { cls: 'dashed', color: el.stroke, width: el.strokeWidth, pts: runs[i], occ: [[tileIdx, el.idx]] })
              }
            }
          } else {
            const key = `${cls}|${el.stroke}|${el.strokeWidth}|${serializePts(simplified)}`
            const existing = strokeItems.get(key)
            if (existing) {
              existing.occ.push([tileIdx, el.idx])
            } else {
              strokeItems.set(key, { cls, color: el.stroke, width: el.strokeWidth, pts: simplified, occ: [[tileIdx, el.idx]] })
            }
          }
        }
      }
    }
  }

  // Audit report.
  const classCounts = new Map<string, number>()
  for (const item of strokeItems.values()) bump(classCounts, item.cls)
  classCounts.set('disc', discItems.size)
  classCounts.set('ring', ringItems.size)
  classCounts.set('badge-ring', badgeRingItems.size)
  classCounts.set('region-fill', meshItems.size)
  log(`claimed (deduped): ${[...classCounts].map(([k, n]) => `${k}=${n}`).join(' ')}`)
  log(`excluded: ${[...excluded].map(([k, n]) => `${k}=${n}`).join(' ') || 'none'}`)
  if (audit.size > 0) {
    const rows = [...audit].sort((a, b) => b[1] - a[1])
    log(`AUDIT (unclaimed, pre-dedup): ${rows.length} kinds`)
    for (const [k, n] of rows.slice(0, 40)) log(`  ${n}\t${k}`)
  }

  // Unclaimed saturated strokes at corridor width are transit lines the
  // classifier missed: hard fail. Below CORRIDOR_MIN_WIDTH they are landmark
  // and icon linework (Monas artwork, logo details) — counted above, no more.
  for (const [k, n] of audit) {
    const m = /^stroke w=([\d.]+) (#[0-9A-F]{6})$/.exec(k)
    if (!m) continue
    if (parseFloat(m[1]) < CORRIDOR_MIN_WIDTH) continue
    const { s, l } = rgbToHsl(m[2])
    if (s >= MIN_SATURATION && l >= MIN_LIGHTNESS && l <= MAX_LIGHTNESS) {
      throw new Error(`${n} unclaimed saturated strokes: ${k}`)
    }
  }

  for (const [cls, min] of Object.entries(MIN_COUNTS)) {
    const n = classCounts.get(cls) ?? 0
    if (n < min) {
      throw new Error(`${cls}: ${n} items (min ${min}) — classifier predicate no longer matches this map edition`)
    }
  }

  // Assemble output layers in painter's order.
  const palette: string[] = []
  const paletteIdx = new Map<string, number>()
  const colorRef = (hex: string): number => {
    let i = paletteIdx.get(hex)
    if (i === undefined) {
      i = palette.length
      palette.push(hex)
      paletteIdx.set(hex, i)
    }
    return i
  }

  // Order within a merged corridor layer: rebuild each tile's document-order
  // sequence from the recorded occurrences and topologically merge them back
  // into the master paint order. Subpaths of one compound element share a doc
  // index, so ties break by dedup-map insertion, which is their subpath order.
  const insertionIdx = new Map([...strokeItems.keys()].map((k, i) => [k, i]))
  const strokeInDocOrder = (classes: string[]): StrokeItem[] => {
    const clsSet = new Set(classes)
    const perTileSeq: { key: string, doc: number, ins: number }[][] = perTile.map(() => [])
    for (const [key, item] of strokeItems) {
      if (!clsSet.has(item.cls)) continue
      const seenTiles = new Set<number>()
      for (const [t, doc] of item.occ) {
        if (seenTiles.has(t)) continue
        seenTiles.add(t)
        perTileSeq[t].push({ key, doc, ins: insertionIdx.get(key)! })
      }
    }
    const sequences = perTileSeq
      .filter(seq => seq.length > 0)
      .map(seq => seq.sort((a, b) => (a.doc - b.doc) || (a.ins - b.ins)).map(e => e.key))
    return mergeDocOrder(sequences).map(key => strokeItems.get(key)!)
  }

  const layers: { name: string, kind: string, items: unknown[] }[] = []
  for (const name of LAYER_ORDER) {
    if (name === 'disc') {
      const items = [...discItems.values()].map(d => ({
        c: colorRef(d.color), x: fixed(d.x), y: fixed(d.y), r: fixed(d.r)
      }))
      layers.push({ name: 'stations', kind: 'disc', items })
    } else if (name === 'ring' || name === 'badge-ring') {
      const source = name === 'ring' ? ringItems : badgeRingItems
      const items = [...source.values()].map(r => ({
        c: colorRef(r.color), x: fixed(r.x), y: fixed(r.y), r: fixed(r.r), w: fixed(r.w)
      }))
      layers.push({ name, kind: 'ring', items })
    } else if (name === 'region-fill') {
      const items = [...meshItems.values()].map(m => ({
        c: colorRef(m.color), tris: m.tris.map(fixed)
      }))
      layers.push({ name, kind: 'mesh', items })
    } else {
      const source = name in MERGED_LAYERS
        ? strokeInDocOrder(MERGED_LAYERS[name])
        : [...strokeItems.values()].filter(s => s.cls === name)
      const items = source.map(s => ({
        c: colorRef(s.color),
        w: fixed(s.width),
        pts: s.pts.flatMap(p => [fixed(p[0]), fixed(p[1])])
      }))
      layers.push({ name, kind: 'stroke', items })
    }
  }

  const doc = {
    version: manifest.version,
    viewBox,
    scale: FIXED_POINT,
    canvas: canvas.map(v => Math.round(v)),
    palette,
    layers
  }
  const json = JSON.stringify(doc) + '\n'
  if (json.length > MAX_BYTES) {
    throw new Error(`${(json.length / 1024).toFixed(0)} KB exceeds ${(MAX_BYTES / 1024).toFixed(0)} KB — collinear-merge the grid layer or move to a binary sidecar`)
  }

  writeFileSync(OUT_PATH, json)
  log(`wrote ${path.relative(WEB_ROOT, OUT_PATH)} (${(json.length / 1024).toFixed(1)} KB, ${palette.length} colours)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
