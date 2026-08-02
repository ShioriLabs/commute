/*
 * Builds app/data/map-skeleton.json — the rail centrelines of the FDTJ map, used by
 * components/map-skeleton.tsx to draw the network while the real tiles load.
 *
 * Source is the committed tile SVGs in public/maps/fdtj/, NOT the master SVG that
 * build-map-tiles.ts works from. Two reasons:
 *   - The master only exists inside that script's tmpdir, and rebuilding it needs the
 *     source PDF plus a system `pdf2svg`. The tiles are in the repo, so anyone who can
 *     clone can regenerate the skeleton.
 *   - build-map-tiles.ts hashes its own outputs into manifest.build, which is the `?v=`
 *     on all 193 tile URLs. Keeping this a separate script means a skeleton retune can
 *     never invalidate ~9 MB of tile cache for every user.
 *
 * Extracting from tiles is lossless here because writeTile() clones whole leaf elements
 * (with their transform chain intact) into every tile their bbox intersects. A corridor
 * that crosses a seam therefore appears *complete* and byte-identical in each of those
 * tiles, so deduplicating world-space geometry recovers the master's paths exactly. And
 * a tile's user space IS master world space — the viewBox windows it without rescaling
 * (width/height equal viewBox w/h) — so no per-tile offset correction is needed.
 *
 * Run: pnpm build:map-skeleton
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(SCRIPT_DIR, '..')
const TILE_DIR = path.join(WEB_ROOT, 'public', 'maps', 'fdtj')
const OUT_PATH = path.join(WEB_ROOT, 'app', 'data', 'map-skeleton.json')

// Line selection. The schematic's transit lines are the only saturated strokes on the
// sheet: everything else is white casing/halo, near-gray furniture, or near-black label ink.
// A saturation threshold beats a hex allowlist because the palette shifts between map
// editions, and a list of "the KRL colours" goes stale silently — the failure mode is a
// thinner animation, which nobody notices — whereas MIN_STROKES below fails the build.
//
// This deliberately yields only *operating* lines. Planned corridors are drawn dashed, and
// pdf2svg renders a dashed stroke as dozens of short clipped fragments inside <defs> rather
// than one path, so they have no centreline to extract. Restoring them would mean stitching
// fragments back together — not worth it for a loading animation of the network as it runs.
const MIN_SATURATION = 0.18
const MIN_LIGHTNESS = 0.12
const MAX_LIGHTNESS = 0.92
// Rail only — KRL, MRT and LRT, stroked at 25. TransJakarta's BRT corridors are the
// thinner 15 and are deliberately excluded: they are a dense urban mesh of ~39 short,
// heavily parallel segments that reads as noise at the loading camera, where rail is a
// handful of long radials that actually draw as recognisable lines.
//
// Widths carry sub-unit jitter from the PDF (24.755 occurs), and the tolerance covers
// that without reaching the nearest furniture weights on either side — 22.677 gray
// route casing below, 34 white halo above.
const WIDTH_CLASSES = [25]
const WIDTH_TOLERANCE = 1.2
// Below this a "stroke" is a station tick or an icon detail, not a corridor.
const MIN_LENGTH = 320

// Sampling step in world units. The schematic is straight runs plus small corner fillets,
// so flattening curves at this resolution is visually exact once RDP collapses the runs.
const SAMPLE_STEP = 8
const MAX_SAMPLES = 4000
// Douglas-Peucker tolerance, world units. The initial camera draws at scale 0.5, so 2.5
// world units is 1.25 CSS px — below the threshold of visibility, and enough to collapse
// an 8-unit-sampled straight run back to its two endpoints.
const SIMPLIFY_EPSILON = 2.5

// Guardrails. MIN_STROKES is the one that matters: it is what turns "a future map edition
// changed its stroke widths and the predicate now matches nothing" from a silently empty
// animation into a failed build.
const MIN_STROKES = 12
const MAX_STROKES = 120
const MAX_VERTICES = 12000
const MAX_BYTES = 120 * 1024

// Station markers. Every station on this map — plain or interchange — is the same object:
// a saturated disc with a white disc stacked on it, so the ring is the sliver of the lower
// one that shows. Plain stations are 44x44 (MRT uses 50x50), and an interchange is simply
// several of them strung along its line, one per line served. So there is no interchange
// case to handle: pull the discs and each is a marker.
const DISC_MIN = 36
const DISC_MAX = 56
const DISC_SQUARENESS = 3
// A marker sits directly on its line (real ones are within 3 units). This is what rejects
// the legend keys and route badges drawn in the margins, which are the same discs but
// nowhere near track.
const STATION_ON_LINE = 30
// The disc carries its own fill, which differs from the line it belongs to by a point or
// two per channel (#EF3839 against the line's #EF3637). Requiring them to agree this
// closely is what proves the disc was matched to the right line rather than to whichever
// line happened to pass nearest.
const STATION_COLOUR_TOLERANCE = 20
const MIN_STATIONS = 60

interface RawDisc {
  x: number
  y: number
  r: number
  colour: string
}

interface RawStroke {
  color: string
  width: number
  points: number[][]
}

export interface SkeletonStroke {
  c: string
  w: number
  cx: number
  cy: number
  d: string
}

export interface SkeletonStation {
  x: number
  y: number
  /** Outer radius in world units, straight from the disc's own bbox. */
  r: number
  /** Ring colour: the line this marker sits on. */
  c: string
}

function log(msg: string): void {
  console.log(`[build-map-skeleton] ${msg}`)
}

/**
 * Pulls every corridor centreline out of the SVG document currently loaded in the page,
 * in world coordinates.
 *
 * Runs entirely in the browser because the geometry needs three things only a rendering
 * engine has: resolved presentation styles (pdf2svg writes stroke as rgb(%) attributes,
 * but weights can also arrive via inherited properties), getTotalLength/getPointAtLength
 * for curve flattening, and getScreenCTM for the transform chain.
 */
async function extractStrokes(page: import('playwright').Page): Promise<RawStroke[]> {
  return await page.evaluate((cfg: {
    minSaturation: number
    minLightness: number
    maxLightness: number
    widthClasses: number[]
    widthTolerance: number
    minLength: number
    sampleStep: number
    maxSamples: number
  }) => {
    const root = document.querySelector('svg')!
    // getScreenCTM composition rather than getCTM: both factors share the same screen
    // basis, so the product is exactly element-local -> root user space even if the
    // converter ever nests an <svg>/<symbol> viewport in between.
    const rootInverse = root.getScreenCTM()!.inverse()

    const rgbToHsl = (r: number, g: number, b: number) => {
      const rr = r / 255
      const gg = g / 255
      const bb = b / 255
      const max = Math.max(rr, gg, bb)
      const min = Math.min(rr, gg, bb)
      const l = (max + min) / 2
      if (max === min) return { s: 0, l }
      const delta = max - min
      const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
      return { s, l }
    }

    const out: { color: string, width: number, points: number[][] }[] = []
    const paths = Array.from(document.querySelectorAll('path'))

    for (const el of paths) {
      // Glyph outlines live in <defs> and are painted through <use>; they are label
      // artwork, never corridors.
      if (el.closest('defs')) continue

      const style = getComputedStyle(el)
      const match = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(style.stroke)
      if (!match) continue
      const r = Number(match[1])
      const g = Number(match[2])
      const b = Number(match[3])
      const { s, l } = rgbToHsl(r, g, b)
      if (s < cfg.minSaturation || l < cfg.minLightness || l > cfg.maxLightness) continue

      const width = parseFloat(style.strokeWidth)
      if (!Number.isFinite(width)) continue
      const widthClass = cfg.widthClasses.find(w => Math.abs(width - w) <= cfg.widthTolerance)
      if (widthClass === undefined) continue

      const rawD = el.getAttribute('d') ?? ''
      // Splitting a compound path on 'M' is only sound while every command is absolute.
      // pdf2svg emits absolute exclusively; fail the build rather than silently emit
      // geometry that has been reassembled wrong if that ever changes.
      if (/[achlmqstvz]/.test(rawD)) {
        throw new Error(`relative path command in ${rawD.slice(0, 60)}...`)
      }

      // getPointAtLength walks straight across a subpath boundary, so sampling a compound
      // path emits a phantom connector between its pieces. Split first, reusing the same
      // parent and transform so each piece resolves through an identical CTM.
      const subpaths = rawD.split(/(?=M)/).map(x => x.trim()).filter(Boolean)
      const parent = el.parentNode!

      for (const sub of subpaths) {
        let target = el
        let temp: SVGPathElement | null = null
        if (subpaths.length > 1) {
          temp = el.cloneNode(false) as SVGPathElement
          temp.setAttribute('d', sub)
          parent.appendChild(temp)
          target = temp
        }

        try {
          const len = target.getTotalLength()
          if (len < cfg.minLength) continue

          const ctm = rootInverse.multiply(target.getScreenCTM()!)
          // Area scale of the matrix, so the sample step stays in world units whatever
          // the local transform does. pdf2svg's matrix(1,0,0,-1,tx,ty) gives exactly 1.
          const areaScale = Math.sqrt(Math.abs(ctm.a * ctm.d - ctm.b * ctm.c)) || 1
          const count = Math.min(cfg.maxSamples, Math.max(2, Math.ceil(len * areaScale / cfg.sampleStep)))

          const points: number[][] = []
          for (let i = 0; i <= count; i++) {
            const p = target.getPointAtLength(i * len / count)
            points.push([
              ctm.a * p.x + ctm.c * p.y + ctm.e,
              ctm.b * p.x + ctm.d * p.y + ctm.f
            ])
          }

          const hex = '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()
          out.push({ color: hex, width: widthClass, points })
        } finally {
          if (temp) parent.removeChild(temp)
        }
      }
    }

    return out
  }, {
    minSaturation: MIN_SATURATION,
    minLightness: MIN_LIGHTNESS,
    maxLightness: MAX_LIGHTNESS,
    widthClasses: [...WIDTH_CLASSES],
    widthTolerance: WIDTH_TOLERANCE,
    minLength: MIN_LENGTH,
    sampleStep: SAMPLE_STEP,
    maxSamples: MAX_SAMPLES
  })
}

/** Perpendicular distance from p to the segment ab. */
function pointSegmentDistance(p: number[], a: number[], b: number[]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Douglas-Peucker, iterative so a 4000-point sample can't blow the stack. */
function simplify(points: number[][], epsilon: number): number[][] {
  if (points.length <= 2) return points

  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  const stack: [number, number][] = [[0, points.length - 1]]

  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    let maxDistance = 0
    let index = -1
    for (let i = first + 1; i < last; i++) {
      const distance = pointSegmentDistance(points[i], points[first], points[last])
      if (distance > maxDistance) {
        maxDistance = distance
        index = i
      }
    }
    if (index !== -1 && maxDistance > epsilon) {
      keep[index] = true
      stack.push([first, index], [index, last])
    }
  }

  return points.filter((_, i) => keep[i])
}

/**
 * Integer world coordinates. One world unit is 0.5 CSS px at the initial camera, so
 * rounding is invisible, and it is by far the biggest lever on file size.
 */
function serialize(points: number[][]): string {
  const rounded: number[][] = []
  for (const [x, y] of points) {
    const rx = Math.round(x)
    const ry = Math.round(y)
    const last = rounded[rounded.length - 1]
    if (last && last[0] === rx && last[1] === ry) continue
    rounded.push([rx, ry])
  }
  if (rounded.length < 2) return ''
  return 'M' + rounded.map(([x, y]) => `${x} ${y}`).join('L')
}

/** Every station disc in the SVG currently loaded in the page, in world coordinates. */
async function extractDiscs(page: import('playwright').Page): Promise<RawDisc[]> {
  return await page.evaluate((cfg: {
    minSaturation: number
    minLightness: number
    maxLightness: number
    min: number
    max: number
    squareness: number
  }) => {
    const rgbToHsl = (r: number, g: number, b: number) => {
      const [rr, gg, bb] = [r / 255, g / 255, b / 255]
      const max = Math.max(rr, gg, bb)
      const min = Math.min(rr, gg, bb)
      const l = (max + min) / 2
      if (max === min) return { s: 0, l }
      const delta = max - min
      return { s: l > 0.5 ? delta / (2 - max - min) : delta / (max + min), l }
    }

    const out: { x: number, y: number, r: number, colour: string }[] = []
    for (const el of document.querySelectorAll('path')) {
      if (el.closest('defs')) continue

      const style = getComputedStyle(el)
      const match = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(style.fill)
      if (!match) continue
      const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])]
      const { s, l } = rgbToHsl(r, g, b)
      if (s < cfg.minSaturation || l < cfg.minLightness || l > cfg.maxLightness) continue

      const box = el.getBBox()
      if (Math.abs(box.width - box.height) > cfg.squareness) continue
      if (box.width < cfg.min || box.width > cfg.max) continue

      const hex = '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()
      out.push({ x: box.x + box.width / 2, y: box.y + box.height / 2, r: box.width / 2, colour: hex })
    }
    return out
  }, {
    minSaturation: MIN_SATURATION,
    minLightness: MIN_LIGHTNESS,
    maxLightness: MAX_LIGHTNESS,
    min: DISC_MIN,
    max: DISC_MAX,
    squareness: DISC_SQUARENESS
  })
}

/** Shortest distance from p to segment ab. */
function segmentDistance(p: number[], a: number[], b: number[]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function channelDistance(a: string, b: string): number {
  let worst = 0
  for (let i = 1; i < 7; i += 2) {
    worst = Math.max(worst, Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)))
  }
  return worst
}

/**
 * Pairs each extracted disc with the line it belongs to, dropping anything that is not a
 * station on a rail line.
 *
 * Two independent things have to agree: the disc must sit on the line geometrically, and
 * its own fill must match that line's colour. Either alone is too weak — at an interchange
 * three discs sit within 40 units of each other and of all three lines, so distance alone
 * would happily assign the red disc to the cyan line.
 */
function collectStations(
  strokes: readonly SkeletonStroke[],
  discs: readonly RawDisc[]
): SkeletonStation[] {
  const lines = strokes.map(stroke => ({
    c: stroke.c,
    points: stroke.d.slice(1).split('L').map(pair => pair.split(' ').map(Number))
  }))

  const out: SkeletonStation[] = []
  for (const disc of discs) {
    let best = STATION_ON_LINE
    let colour: string | null = null
    for (const line of lines) {
      if (channelDistance(line.c, disc.colour) > STATION_COLOUR_TOLERANCE) continue
      for (let i = 0; i < line.points.length - 1; i++) {
        const d = segmentDistance([disc.x, disc.y], line.points[i], line.points[i + 1])
        if (d < best) {
          best = d
          colour = line.c
        }
      }
    }
    if (!colour) continue

    out.push({ x: Math.round(disc.x), y: Math.round(disc.y), r: Math.round(disc.r), c: colour })
  }
  return out
}

async function main(): Promise<void> {
  const tiles = readdirSync(TILE_DIR).filter(f => /^tile-\d+-\d+\.svg$/.test(f)).sort()
  if (tiles.length === 0) throw new Error(`no tile SVGs in ${TILE_DIR}`)
  log(`source: ${tiles.length} tile SVGs in ${path.relative(WEB_ROOT, TILE_DIR)}`)

  const manifest = JSON.parse(readFileSync(path.join(TILE_DIR, 'manifest.json'), 'utf8'))
  const viewBox: number[] = manifest.viewBox

  const browser = await chromium.launch()
  const page = await browser.newPage()
  // tsx (via esbuild keepNames) emits __name() calls inside the function we ship to
  // page.evaluate. The browser context lacks that helper, so shim it as a no-op.
  await page.addInitScript(() => {
    // @ts-expect-error - shim for esbuild keepNames helper
    globalThis.__name = (fn: unknown) => fn
  })

  // Insertion-ordered, so identical geometry from a later tile collapses onto the first
  // occurrence and the output stays deterministic across runs.
  const strokes = new Map<string, SkeletonStroke>()
  const discs = new Map<string, RawDisc>()
  let vertices = 0

  try {
    for (const tile of tiles) {
      await page.goto('file://' + path.join(TILE_DIR, tile))
      const raw = await extractStrokes(page)

      for (const stroke of raw) {
        const d = serialize(simplify(stroke.points, SIMPLIFY_EPSILON))
        if (!d) continue
        const key = `${stroke.color}|${stroke.width}|${d}`
        if (strokes.has(key)) continue

        const xs = stroke.points.map(p => p[0])
        const ys = stroke.points.map(p => p[1])
        strokes.set(key, {
          c: stroke.color,
          w: stroke.width,
          cx: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
          cy: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
          d
        })
        vertices += d.split('L').length
      }

      // Same seam duplication as the strokes: a disc near a tile edge is cloned into every
      // tile it touches, so collapse on rounded position.
      for (const disc of await extractDiscs(page)) {
        discs.set(`${Math.round(disc.x)}|${Math.round(disc.y)}|${disc.colour}`, disc)
      }
    }
  } finally {
    await browser.close()
  }

  const list = [...strokes.values()]
  log(`extracted ${list.length} unique strokes, ${vertices} vertices`)

  const byLine = new Map<string, number>()
  for (const s of list) byLine.set(`${s.c}@${s.w}`, (byLine.get(`${s.c}@${s.w}`) ?? 0) + 1)
  log(`${byLine.size} distinct line colours: ${[...byLine].map(([k, n]) => `${k}x${n}`).join(' ')}`)

  if (list.length < MIN_STROKES) {
    throw new Error(`only ${list.length} strokes (min ${MIN_STROKES}) — the corridor predicate probably no longer matches this map edition`)
  }
  if (list.length > MAX_STROKES) throw new Error(`${list.length} strokes exceeds ${MAX_STROKES}`)
  if (vertices > MAX_VERTICES) throw new Error(`${vertices} vertices exceeds ${MAX_VERTICES}`)

  const stations = collectStations(list, [...discs.values()])
  log(`${stations.length} station markers`)
  if (stations.length < MIN_STATIONS) {
    throw new Error(`only ${stations.length} stations (min ${MIN_STATIONS}) — check the operator filter against points.json`)
  }

  // Self-describing: the route fallback needs the skeleton *before* manifest.json has
  // resolved, so it cannot depend on the manifest for its coordinate space. A test
  // cross-checks the two rather than making the manifest a second source of truth.
  const doc = { version: manifest.version, viewBox, strokes: list, stations }
  const json = JSON.stringify(doc) + '\n'
  if (json.length > MAX_BYTES) throw new Error(`${json.length} bytes exceeds ${MAX_BYTES}`)

  writeFileSync(OUT_PATH, json)
  log(`wrote ${path.relative(WEB_ROOT, OUT_PATH)} (${(json.length / 1024).toFixed(1)} KB)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
