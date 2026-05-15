/*
 * Builds per-layer 4x4 tile grids from the FDTJ Jakarta integration map PDF.
 *
 * Layers (z-order, bottom -> top):
 *   - terrain: land/water/roads/anything that isn't a transit line, label, or chrome
 *   - lines:   transit-line geometry, classified by fill/stroke color matching the
 *              palette auto-extracted from the legend (chrome region)
 *   - labels:  station-name text (<use> glyph refs) and other near-black text paths
 *   - chrome:  anything outside the central map rect (legend, title, scale bar) —
 *              emitted as a single non-tiled SVG so the renderer can decide whether
 *              to display it
 *
 * Pipeline:
 *   1. pdf2svg <pdf> -> temp master.svg.
 *   2. Headless Chromium loads it; walker captures bbox + computed fill/stroke per leaf.
 *   3. Detect map-content rectangle (largest near-cream/white background fill).
 *   4. Auto-cluster saturated fills in the chrome region -> line palette.
 *   5. Classify each leaf into one of the four layers.
 *   6. For each (layer, tile), extract pruned subtree + pruned <defs>, write tile SVG.
 *   7. Emit manifest.json describing layers + tile geometry.
 *
 * Run: pnpm build:map-tiles
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(SCRIPT_DIR, '..')
const REPO_ROOT = path.resolve(WEB_ROOT, '..', '..')
const PDF_PATH = path.join(REPO_ROOT, '2026-02-Peta-Integrasi-Jakarta-FDTJ-Web.pdf')
const VERSION = '2026-02'
const OUT_DIR = path.join(WEB_ROOT, 'public', 'maps', 'fdtj')
const GRID_ROWS = 4
const GRID_COLS = 4
// Padding around each tile's bbox (in master SVG units) to avoid hairline gaps at seams.
const TILE_PAD = 0.5

type BBox = { x: number, y: number, w: number, h: number }
type RGB = [number, number, number] // 0..1
type LeafInfo = {
  selector: string
  bbox: BBox
  tag: string
  fill: RGB | null
  stroke: RGB | null
}
type Layer = 'terrain' | 'landmarks' | 'lines' | 'labels' | 'stations' | 'chrome'
const LAYERS: Layer[] = ['terrain', 'landmarks', 'lines', 'labels', 'stations', 'chrome']

// Color-classification thresholds.
const SATURATION_MIN = 0.25 // max-min channel for "saturated" (lines & clustering)
const LINE_LIGHTNESS_CEILING = 0.66 // HSL lightness above this is too pale to be a line (parks, water tints)
const CLUSTER_TOLERANCE = 0.05 // per-channel delta for clustering palette entries together
const HUE_TOLERANCE = 30 // degrees on the color wheel; lines that share hue are considered the same line
const LABEL_NEAR_BLACK_MAX = 0.20 // all channels below this -> near-black -> label
const MIN_CLUSTER_SIZE = 2 // legend palette must appear at least this many times

// Station-detection thresholds. FDTJ stations are small marker circles/ovals with
// a white fill and a colored ring (or vice versa for some markers).
const STATION_MAX_DIM = 80 // master units; biggest interchange ovals fit within this
const STATION_MIN_DIM = 4 // tiny stroke fragments below this aren't markers
const WHITE_CHANNEL_MIN = 0.92 // all channels above this -> "white"

// Landmark-detection thresholds. Pale-but-saturated polygons (parks, TMII, GBK, etc.)
// occupy the lightness band above LINE_LIGHTNESS_CEILING.
const LANDMARK_MIN_DIM = 3 // even single-stroke park decorations should land here
const LANDMARK_SAT_MIN = 0.15 // hint of color, not pure gray
const LANDMARK_MAX_AREA_FRAC = 0.20 // bigger than this fraction of map = it's background, not a landmark

// Hardcoded rail-line palette (operator colors from apps/api/src/operators/*).
// We seed the auto-extracted legend palette with these so rail lines are always
// classified as `lines` even if their legend swatches are sparse and got filtered
// by MIN_CLUSTER_SIZE. TransJakarta corridor colors come from the auto-extractor.
const RAIL_PALETTE_HEX: string[] = [
  '#1e2d6e', // KA Bandara Soekarno-Hatta (dark navy)
  '#ee3d43', // KRL Bogor
  '#25b8eb', // KRL Cikarang
  '#ca2a51', // MRT Jakarta North-South
  '#96c83e', // KRL Rangkasbitung
  '#f26324', // LRT Jakarta Southern
  '#c15f28', // KRL Tangerang
  '#ed4f98', // KRL Tanjung Priok
  '#006838', // LRT Jabodebek Bekasi
  '#21409a', // LRT Jabodebek Cibubur
  '#282965', // (manually added)
  '#4e2e64' // (manually added)
]

// Dark fill color used for interchange-marker shapes (small dark filled circles
// with line/station codes inside). These hit the LABEL_NEAR_BLACK_MAX rule by
// default, so the station post-pass promotes them out of `labels`.
const EXCHANGE_MARKER_HEX = '#19171c'

function hexToRgb(hex: string): RGB {
  const m = hex.replace('#', '').match(/.{1,2}/g)!
  return [parseInt(m[0], 16) / 255, parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255]
}

function log(msg: string): void {
  console.log(`[build-map-tiles] ${msg}`)
}

function runPdf2Svg(pdfPath: string, outSvgPath: string): void {
  try {
    execFileSync('pdf2svg', [pdfPath, outSvgPath, '1'], { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    throw new Error(
      `pdf2svg failed. Is it installed? (apt install pdf2svg / brew install pdf2svg)\n${(err as Error).message}`
    )
  }
}

function parseMasterViewBox(svg: string): BBox {
  const m = svg.match(/<svg[^>]*viewBox="([^"]+)"/)
  if (!m) throw new Error('Could not find viewBox on root <svg>')
  const [x, y, w, h] = m[1].split(/\s+/).map(Number)
  return { x, y, w, h }
}

function bboxesIntersect(a: BBox, b: BBox): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)
}

/**
 * Walks the loaded master SVG in the headless page and returns a flat list of leaf
 * elements (paths, uses, rects, images, etc.) with their document-space bboxes and
 * a stable CSS selector path back to them.
 *
 * We treat <g> as containers and recurse. We don't descend into <defs>.
 */
async function collectLeafBBoxes(page: Page): Promise<LeafInfo[]> {
  return await page.evaluate(() => {
    const LEAF_TAGS = new Set([
      'path', 'use', 'rect', 'circle', 'ellipse', 'line', 'polyline',
      'polygon', 'text', 'image'
    ])
    const root = document.querySelector('svg')
    if (!root) throw new Error('No <svg> root found in loaded document')

    const indexOf = (el: Element): number => {
      const parent = el.parentElement
      if (!parent) return 0
      return Array.from(parent.children).indexOf(el)
    }
    const selectorFor = (el: Element): string => {
      const parts: string[] = []
      let cur: Element | null = el
      while (cur && cur.nodeName.toLowerCase() !== 'svg') {
        parts.unshift(`${cur.nodeName.toLowerCase()}:nth-child(${indexOf(cur) + 1})`)
        cur = cur.parentElement
      }
      return parts.join(' > ')
    }

    // Parses rgb(r,g,b[,a]) or hex into [r,g,b] in 0..1, or null for none/transparent.
    const parseColor = (value: string): [number, number, number] | null => {
      if (!value || value === 'none' || value === 'transparent') return null
      const rgbm = value.match(/^rgba?\(\s*([\d.]+%?)[ ,]+([\d.]+%?)[ ,]+([\d.]+%?)(?:[ ,/]+([\d.]+%?))?\s*\)$/i)
      if (rgbm) {
        const alpha = rgbm[4] !== undefined
          ? (rgbm[4].endsWith('%') ? parseFloat(rgbm[4]) / 100 : parseFloat(rgbm[4]))
          : 1
        if (alpha <= 0) return null
        const ch = (s: string) => s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s) / 255
        return [ch(rgbm[1]), ch(rgbm[2]), ch(rgbm[3])]
      }
      // Fallback: let the browser resolve named/hex colors via a sacrificial element.
      const probe = document.createElement('div')
      probe.style.color = value
      document.body.appendChild(probe)
      const computed = getComputedStyle(probe).color
      probe.remove()
      if (computed === value) return null
      return parseColor(computed)
    }

    const leaves: {
      selector: string
      bbox: { x: number, y: number, w: number, h: number }
      tag: string
      fill: [number, number, number] | null
      stroke: [number, number, number] | null
    }[] = []
    const walk = (el: Element): void => {
      const tag = el.nodeName.toLowerCase()
      if (tag === 'defs') return
      if (LEAF_TAGS.has(tag)) {
        try {
          const b = (el as SVGGraphicsElement).getBBox()
          if (!isFinite(b.x) || !isFinite(b.y) || !isFinite(b.width) || !isFinite(b.height)) return
          if (b.width === 0 && b.height === 0) return
          // Transform local bbox to document SVG coordinates using getCTM.
          const ctm = (el as SVGGraphicsElement).getCTM()
          let x1 = b.x, y1 = b.y, x2 = b.x + b.width, y2 = b.y + b.height
          if (ctm) {
            const pts = [
              [x1, y1], [x2, y1], [x1, y2], [x2, y2]
            ].map(([x, y]) => ({
              X: ctm.a * x + ctm.c * y + ctm.e,
              Y: ctm.b * x + ctm.d * y + ctm.f
            }))
            x1 = Math.min(...pts.map(p => p.X))
            y1 = Math.min(...pts.map(p => p.Y))
            x2 = Math.max(...pts.map(p => p.X))
            y2 = Math.max(...pts.map(p => p.Y))
          }
          const cs = getComputedStyle(el)
          leaves.push({
            selector: selectorFor(el),
            bbox: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 },
            tag,
            fill: parseColor(cs.fill),
            stroke: parseColor(cs.stroke)
          })
        } catch {
          // ignore elements where getBBox throws (defs glyphs, etc.)
        }
        return
      }
      for (const child of Array.from(el.children)) {
        walk(child)
      }
    }
    for (const child of Array.from(root.children)) {
      walk(child)
    }
    return leaves
  })
}

function saturation(c: RGB): number {
  return Math.max(...c) - Math.min(...c)
}

function colorsClose(a: RGB, b: RGB, tol: number): boolean {
  return Math.abs(a[0] - b[0]) <= tol
    && Math.abs(a[1] - b[1]) <= tol
    && Math.abs(a[2] - b[2]) <= tol
}

// Hue in degrees [0, 360). Returns null for grayscale (no defined hue).
function hue(c: RGB): number | null {
  const [r, g, b] = c
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return null
  const d = max - min
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return h
}

function hueDistance(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2) % 360
  return d > 180 ? 360 - d : d
}

// Two line colors are considered the same line iff their hues are within
// HUE_TOLERANCE degrees. Brightness/saturation are ignored, which catches the
// shade variants pdf2svg emits for halos and slightly-off legend swatches.
function huesMatch(a: RGB, b: RGB, tol = HUE_TOLERANCE): boolean {
  const ha = hue(a)
  const hb = hue(b)
  if (ha === null || hb === null) return false
  return hueDistance(ha, hb) <= tol
}

/**
 * Heuristically picks the central map-content rectangle. pdf2svg emits a near-cream
 * background path as one of the first body elements; we look for the leaf with the
 * largest bbox whose fill is light-and-desaturated and that doesn't cover the entire
 * page. That's our map-content rect. Falls back to a margin-inset of the viewBox.
 */
function detectMapBBox(leaves: LeafInfo[], viewBox: BBox): BBox {
  const pageArea = viewBox.w * viewBox.h
  let best: LeafInfo | null = null
  let bestArea = 0
  for (const leaf of leaves) {
    if (!leaf.fill) continue
    const sat = saturation(leaf.fill)
    const lightness = (leaf.fill[0] + leaf.fill[1] + leaf.fill[2]) / 3
    if (sat > 0.10 || lightness < 0.85) continue
    const area = leaf.bbox.w * leaf.bbox.h
    if (area < pageArea * 0.3 || area > pageArea * 0.98) continue
    if (area > bestArea) {
      bestArea = area
      best = leaf
    }
  }
  if (best) return best.bbox
  // Fallback: 5% inset.
  return {
    x: viewBox.x + viewBox.w * 0.05,
    y: viewBox.y + viewBox.h * 0.05,
    w: viewBox.w * 0.9,
    h: viewBox.h * 0.9
  }
}

function bboxCenter(b: BBox): { x: number, y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

function bboxContainsPoint(b: BBox, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h
}

/**
 * Auto-clusters saturated fill colors found in chrome leaves into a palette.
 * Returns cluster centroids; only clusters with at least MIN_CLUSTER_SIZE members
 * are kept (filters out one-off decorative colors).
 */
function extractPalette(chromeLeaves: LeafInfo[]): RGB[] {
  type Cluster = { centroid: RGB, members: RGB[] }
  const clusters: Cluster[] = []
  const sampleColors = (leaf: LeafInfo): RGB[] => {
    const out: RGB[] = []
    if (leaf.fill && saturation(leaf.fill) >= SATURATION_MIN) out.push(leaf.fill)
    if (leaf.stroke && saturation(leaf.stroke) >= SATURATION_MIN) out.push(leaf.stroke)
    return out
  }
  for (const leaf of chromeLeaves) {
    for (const c of sampleColors(leaf)) {
      const hit = clusters.find(cl => colorsClose(cl.centroid, c, CLUSTER_TOLERANCE))
      if (hit) {
        hit.members.push(c)
        // Recompute centroid as mean.
        const n = hit.members.length
        hit.centroid = [
          hit.members.reduce((s, m) => s + m[0], 0) / n,
          hit.members.reduce((s, m) => s + m[1], 0) / n,
          hit.members.reduce((s, m) => s + m[2], 0) / n
        ]
      } else {
        clusters.push({ centroid: c, members: [c] })
      }
    }
  }
  return clusters
    .filter(cl => cl.members.length >= MIN_CLUSTER_SIZE)
    .map(cl => cl.centroid)
}

function rgbToHex(c: RGB): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)))
  return '#' + [clamp(c[0]), clamp(c[1]), clamp(c[2])]
    .map(v => v.toString(16).padStart(2, '0'))
    .join('')
}

function isWhite(c: RGB | null): boolean {
  if (!c) return false
  return c[0] >= WHITE_CHANNEL_MIN && c[1] >= WHITE_CHANNEL_MIN && c[2] >= WHITE_CHANNEL_MIN
}

const EXCHANGE_MARKER_RGB = hexToRgb(EXCHANGE_MARKER_HEX)
function isExchangeMarkerColor(c: RGB | null): boolean {
  if (!c) return false
  return colorsClose(c, EXCHANGE_MARKER_RGB, 0.03)
}

function isLineColor(c: RGB | null, palette: RGB[]): boolean {
  if (!c) return false
  if (saturation(c) < SATURATION_MIN) return false
  const L = (Math.max(...c) + Math.min(...c)) / 2
  if (L > LINE_LIGHTNESS_CEILING) return false
  return palette.some(p => huesMatch(p, c))
}

function classifyLeaf(leaf: LeafInfo, mapBBox: BBox, palette: RGB[]): Layer {
  const center = bboxCenter(leaf.bbox)
  if (!bboxContainsPoint(mapBBox, center.x, center.y)) return 'chrome'

  // -------- Labels (cheapest, most specific): -------------------------------
  // Glyph use elements are always labels (text rendered via <use href="#glyph">).
  if (leaf.tag === 'use') return 'labels'
  // Near-black solid fills are label paths.
  if (leaf.fill && leaf.fill.every(c => c <= LABEL_NEAR_BLACK_MAX)) return 'labels'

  // -------- Lines: any color matching the palette. --------------------------
  // (Stations are extracted in a post-pass below by looking for white-filled
  // small shapes overlapping a line marker.)
  if (isLineColor(leaf.fill, palette) || isLineColor(leaf.stroke, palette)) return 'lines'

  const dim = Math.max(leaf.bbox.w, leaf.bbox.h)

  // -------- Landmarks: pale-but-saturated polygons inside the map. ----------
  // Parks (#c9e9a7), TMII (mixed tan), GBK greens, beaches (#f9f3d8). They sit
  // above the line lightness ceiling but still carry a hint of color.
  const mapArea = mapBBox.w * mapBBox.h
  if (
    leaf.fill
    && dim >= LANDMARK_MIN_DIM
    && saturation(leaf.fill) >= LANDMARK_SAT_MIN
    && (Math.max(...leaf.fill) + Math.min(...leaf.fill)) / 2 > LINE_LIGHTNESS_CEILING
    && leaf.bbox.w * leaf.bbox.h < mapArea * LANDMARK_MAX_AREA_FRAC
  ) {
    return 'landmarks'
  }

  return 'terrain'
}

/**
 * Walks the master SVG DOM (via Playwright) and emits, for a given set of leaf
 * selectors, the minimal subtree that preserves their ancestor <g transform=...>
 * groups so coordinates resolve correctly. Returns an HTML/SVG fragment string.
 */
async function extractSubtreeForTile(page: Page, selectors: string[]): Promise<string> {
  return await page.evaluate((sels: string[]) => {
    const root = document.querySelector('svg')!
    const keep = new Set<Element>()
    for (const sel of sels) {
      const el = root.querySelector(`:scope > ${sel}`)
      if (!el) continue
      keep.add(el)
      // Mark every ancestor up to (but not including) the <svg> root as "keep".
      let p = el.parentElement
      while (p && (p as Element) !== (root as Element)) {
        keep.add(p)
        p = p.parentElement
      }
    }
    // Clone the master subtree, pruning anything not in `keep`.
    const cloneFiltered = (src: Element): Element | null => {
      if (!keep.has(src) && !sels.length) return null
      if (!keep.has(src)) return null
      const c = src.cloneNode(false) as Element
      for (const child of Array.from(src.children)) {
        const cc = cloneFiltered(child)
        if (cc) c.appendChild(cc)
      }
      return c
    }
    const parts: string[] = []
    for (const child of Array.from(root.children)) {
      if (child.nodeName.toLowerCase() === 'defs') continue
      const filtered = cloneFiltered(child)
      if (filtered) parts.push(filtered.outerHTML)
    }
    return parts.join('\n')
  }, selectors)
}

/**
 * Walks the master <defs> in the page DOM and returns a map of id -> outerHTML for
 * every descendant element that carries an id. Flattening like this lets pruneDefs
 * emit those elements directly under the tile's <defs>, regardless of how deep they
 * were nested in the master (e.g. all glyph <g>s sit inside an id-less wrapper <g>).
 */
async function collectDefsById(page: Page): Promise<Map<string, string>> {
  const entries = await page.evaluate(() => {
    const defs = document.querySelector('svg > defs')
    if (!defs) return [] as [string, string][]
    const out: [string, string][] = []
    const all = defs.querySelectorAll('[id]')
    for (const el of Array.from(all)) {
      out.push([el.id, el.outerHTML])
    }
    return out
  })
  return new Map(entries)
}

/**
 * Scans an SVG fragment for id references (xlink:href="#id", href="#id",
 * url(#id), clip-path="url(#id)", fill="url(#id)", etc.) and returns the set.
 */
function collectReferencedIds(fragment: string): Set<string> {
  const ids = new Set<string>()
  const patterns = [
    /xlink:href="#([^"]+)"/g,
    /\shref="#([^"]+)"/g,
    /url\(#([^)]+)\)/g
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(fragment)) !== null) ids.add(m[1])
  }
  return ids
}

/**
 * Given the master defs id->outerHTML map and the set of ids referenced by a tile,
 * return a flattened <defs> block containing each kept entry, plus the transitive
 * closure of ids those entries themselves reference (e.g. a clipPath that
 * references another path id, a glyph that references another glyph).
 */
function pruneDefs(defsById: Map<string, string>, keepIds: Set<string>): string {
  if (!defsById.size) return ''
  const finalIds = new Set<string>()
  const queue: string[] = []
  for (const id of keepIds) {
    if (defsById.has(id)) {
      finalIds.add(id)
      queue.push(id)
    }
  }
  while (queue.length) {
    const id = queue.shift()!
    const html = defsById.get(id)
    if (!html) continue
    const refs = collectReferencedIds(html)
    for (const r of refs) {
      if (!finalIds.has(r) && defsById.has(r)) {
        finalIds.add(r)
        queue.push(r)
      }
    }
  }
  if (!finalIds.size) return ''
  const parts: string[] = []
  for (const id of finalIds) {
    parts.push(defsById.get(id)!)
  }
  return `<defs>\n${parts.join('\n')}\n</defs>`
}

function writeTile(filename: string, viewBox: BBox, defsBlock: string, body: string): void {
  const vb = `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`
  const svg
    = `<?xml version="1.0" encoding="UTF-8"?>\n`
      + `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" `
      + `viewBox="${vb}" width="${viewBox.w}" height="${viewBox.h}">\n`
      + (defsBlock ? defsBlock + '\n' : '')
      + body + '\n'
      + `</svg>\n`
  writeFileSync(filename, svg)
}

async function main(): Promise<void> {
  log(`source PDF: ${PDF_PATH}`)
  mkdirSync(OUT_DIR, { recursive: true })
  const tmp = mkdtempSync(path.join(tmpdir(), 'fdtj-tiles-'))
  const masterSvgPath = path.join(tmp, 'master.svg')

  try {
    log('converting PDF -> master SVG via pdf2svg...')
    runPdf2Svg(PDF_PATH, masterSvgPath)
    const masterSvg = readFileSync(masterSvgPath, 'utf8')
    const viewBox = parseMasterViewBox(masterSvg)
    log(`master viewBox: ${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`)

    log('launching headless Chromium to measure element bboxes...')
    const browser = await chromium.launch()
    const page = await browser.newPage()
    // tsx (via esbuild keepNames) emits __name() calls inside the function we ship to
    // page.evaluate. The browser context lacks that helper, so shim it as a no-op.
    await page.addInitScript(() => {
      // @ts-expect-error - shim for esbuild keepNames helper
      globalThis.__name = (fn: unknown) => fn
    })
    await page.goto('file://' + masterSvgPath)
    await page.waitForLoadState('networkidle')

    log('collecting defs by id (glyphs, clipPaths, gradients, etc.)...')
    const defsById = await collectDefsById(page)
    log(`collected ${defsById.size} id-bearing defs entries`)

    log('collecting leaf bboxes + computed colors (~25k elements)...')
    const leaves = await collectLeafBBoxes(page)
    log(`collected ${leaves.length} leaf bboxes`)

    // 1. Detect map content rectangle.
    const mapBBox = detectMapBBox(leaves, viewBox)
    log(`map bbox: ${mapBBox.x.toFixed(1)} ${mapBBox.y.toFixed(1)} ${mapBBox.w.toFixed(1)} ${mapBBox.h.toFixed(1)}`)

    // 2. Pre-partition: chrome (bbox center outside map) vs map-interior, so we can
    //    extract the palette from chrome only.
    const chromeLeaves: LeafInfo[] = []
    const mapLeaves: LeafInfo[] = []
    for (const leaf of leaves) {
      const c = bboxCenter(leaf.bbox)
      if (bboxContainsPoint(mapBBox, c.x, c.y)) mapLeaves.push(leaf)
      else chromeLeaves.push(leaf)
    }
    log(`partitioned: ${mapLeaves.length} map / ${chromeLeaves.length} chrome`)

    // 3. Build the line palette: hardcoded rail colors + auto-clustered TJ colors
    //    from chrome. Auto-extracted entries that fall within tolerance of a rail
    //    color are merged in so we don't double-count.
    const railPalette = RAIL_PALETTE_HEX.map(hexToRgb)
    const autoPalette = extractPalette(chromeLeaves)
    const palette: RGB[] = [...railPalette]
    for (const c of autoPalette) {
      if (!palette.some(p => colorsClose(p, c, CLUSTER_TOLERANCE * 1.5))) {
        palette.push(c)
      }
    }
    log(`rail palette (${railPalette.length}): ${railPalette.map(rgbToHex).join(' ')}`)
    log(`auto-extracted (${autoPalette.length}): ${autoPalette.map(rgbToHex).join(' ')}`)
    log(`final palette (${palette.length} colors): ${palette.map(rgbToHex).join(' ')}`)

    // 4. Classify every leaf into a layer.
    const leafLayer = new Map<LeafInfo, Layer>()
    for (const leaf of leaves) {
      leafLayer.set(leaf, classifyLeaf(leaf, mapBBox, palette))
    }

    // 4b. Station post-pass: FDTJ station markers are two stacked paths -
    // a colored fill circle (already classified as `lines`) and a white-filled
    // circle drawn on top (currently classified as `terrain` since pure white
    // fails the line/landmark rules). Promote those white-filled small shapes
    // to `stations` when their bbox center sits on top of a `lines`-classified
    // leaf of comparable size.
    //
    // Also promote interchange-marker shapes (small fills in EXCHANGE_MARKER_HEX)
    // out of `labels` and into `stations` — these are the dark circles that hold
    // line/operator code badges at transfer points.
    const lineLeaves = leaves.filter(l => leafLayer.get(l) === 'lines')
    for (const leaf of leaves) {
      const current = leafLayer.get(leaf)
      const d = Math.max(leaf.bbox.w, leaf.bbox.h)
      if (d < STATION_MIN_DIM || d > STATION_MAX_DIM) continue

      // White interior on top of a colored ring.
      if (current === 'terrain' && isWhite(leaf.fill)) {
        const center = bboxCenter(leaf.bbox)
        const hasUnderlyingLine = lineLeaves.some((other) => {
          if (!bboxContainsPoint(other.bbox, center.x, center.y)) return false
          const od = Math.max(other.bbox.w, other.bbox.h)
          return od >= d * 0.8 && od <= d * 2.0
        })
        if (hasUnderlyingLine) leafLayer.set(leaf, 'stations')
        continue
      }

      // Exchange-marker dark fill (#19171c). Currently in `labels` because of
      // the near-black rule; move to `stations`.
      if (current === 'labels' && isExchangeMarkerColor(leaf.fill) && leaf.tag !== 'use') {
        leafLayer.set(leaf, 'stations')
      }
    }

    const byLayer: Record<Layer, LeafInfo[]> = {
      terrain: [],
      landmarks: [],
      lines: [],
      labels: [],
      stations: [],
      chrome: []
    }
    for (const [leaf, layer] of leafLayer) byLayer[layer].push(leaf)
    for (const layer of LAYERS) {
      log(`  layer ${layer}: ${byLayer[layer].length} leaves`)
    }

    // 5. Tile bounds for the 4x4 grid (covers the full master viewBox, not just the
    //    map rect — keeps the tile grid aligned with the existing renderer math).
    const tileW = viewBox.w / GRID_COLS
    const tileH = viewBox.h / GRID_ROWS
    const tileBounds: BBox[][] = []
    for (let r = 0; r < GRID_ROWS; r++) {
      const row: BBox[] = []
      for (let c = 0; c < GRID_COLS; c++) {
        row.push({
          x: viewBox.x + c * tileW - TILE_PAD,
          y: viewBox.y + r * tileH - TILE_PAD,
          w: tileW + 2 * TILE_PAD,
          h: tileH + 2 * TILE_PAD
        })
      }
      tileBounds.push(row)
    }

    // 6. Emit tiles per (layer, r, c). Chrome is emitted as a single non-tiled SVG.
    // Order matters: bottom -> top render order. Labels sit on top of stations so
    // station-code text stays readable inside marker shapes.
    const tiledLayers: Layer[] = ['terrain', 'landmarks', 'lines', 'stations', 'labels']
    for (const layer of tiledLayers) {
      const layerLeaves = byLayer[layer]
      const tileSelectors: string[][][] = tileBounds.map(row => row.map(() => []))
      for (const leaf of layerLeaves) {
        for (let r = 0; r < GRID_ROWS; r++) {
          for (let c = 0; c < GRID_COLS; c++) {
            if (bboxesIntersect(leaf.bbox, tileBounds[r][c])) {
              tileSelectors[r][c].push(leaf.selector)
            }
          }
        }
      }
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          const sels = tileSelectors[r][c]
          const body = sels.length ? await extractSubtreeForTile(page, sels) : ''
          const refs = collectReferencedIds(body)
          const tileDefs = pruneDefs(defsById, refs)
          const tileViewBox: BBox = {
            x: viewBox.x + c * tileW,
            y: viewBox.y + r * tileH,
            w: tileW,
            h: tileH
          }
          writeTile(
            path.join(OUT_DIR, `tile-${layer}-${r}-${c}.svg`),
            tileViewBox,
            tileDefs,
            body
          )
        }
      }
      log(`  wrote ${GRID_ROWS * GRID_COLS} tiles for layer "${layer}"`)
    }

    // Chrome: single SVG with the chrome bbox as viewBox so it can render
    // standalone without a transparent margin around it.
    const chromeSelectors = byLayer.chrome.map(l => l.selector)
    const chromeBody = chromeSelectors.length
      ? await extractSubtreeForTile(page, chromeSelectors)
      : ''
    const chromeRefs = collectReferencedIds(chromeBody)
    const chromeDefs = pruneDefs(defsById, chromeRefs)
    // Compute the tight bbox of all chrome leaves (a few pad units of breathing room).
    let cx0 = Infinity, cy0 = Infinity, cx1 = -Infinity, cy1 = -Infinity
    for (const leaf of byLayer.chrome) {
      cx0 = Math.min(cx0, leaf.bbox.x)
      cy0 = Math.min(cy0, leaf.bbox.y)
      cx1 = Math.max(cx1, leaf.bbox.x + leaf.bbox.w)
      cy1 = Math.max(cy1, leaf.bbox.y + leaf.bbox.h)
    }
    const chromeViewBox: BBox = isFinite(cx0)
      ? { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 }
      : viewBox
    writeTile(
      path.join(OUT_DIR, 'tile-chrome.svg'),
      chromeViewBox,
      chromeDefs,
      chromeBody
    )
    log(`  wrote tile-chrome.svg (${byLayer.chrome.length} leaves)`)

    await browser.close()

    const manifest = {
      version: VERSION,
      source: path.basename(PDF_PATH),
      viewBox: [viewBox.x, viewBox.y, viewBox.w, viewBox.h],
      mapBBox: [mapBBox.x, mapBBox.y, mapBBox.w, mapBBox.h],
      chromeBBox: [chromeViewBox.x, chromeViewBox.y, chromeViewBox.w, chromeViewBox.h],
      grid: { rows: GRID_ROWS, cols: GRID_COLS },
      tileSize: { w: tileW, h: tileH },
      layers: tiledLayers,
      palette: palette.map(rgbToHex)
    }
    writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    log(`wrote manifest.json + ${tiledLayers.length * GRID_ROWS * GRID_COLS} tiled SVGs + chrome SVG to ${OUT_DIR}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
