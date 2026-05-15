/*
 * Builds a 4x4 grid of self-contained SVG tiles from the FDTJ Jakarta integration map PDF.
 *
 * Pipeline:
 *   1. pdf2svg <pdf> -> temp master.svg (system binary; install via apt/brew).
 *   2. Launch Playwright Chromium, load master.svg, walk the tree calling getBBox() to
 *      get document-space bounds for each leaf element.
 *   3. Split the master viewBox into a 4x4 grid. Assign each leaf to every tile its
 *      bbox intersects.
 *   4. Emit one self-contained SVG per tile with the tile's sub-viewBox, the kept
 *      elements (parent transforms preserved), and a pruned <defs> containing only
 *      ids referenced by those elements.
 *   5. Emit manifest.json describing the tile layout.
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
type LeafInfo = { selector: string, bbox: BBox }

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

    const leaves: LeafInfo[] = []
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
          // getCTM gives transform from this element to the nearest viewport (the <svg>).
          // For elements inside the master SVG, that's document space.
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
          leaves.push({
            selector: selectorFor(el),
            bbox: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
          })
        } catch {
          // ignore elements where getBBox throws (defs glyphs, etc.)
        }
        return
      }
      // Containers (g, svg, symbol, marker, etc.) — recurse.
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

function writeTile(row: number, col: number, viewBox: BBox, defsBlock: string, body: string): void {
  const filename = path.join(OUT_DIR, `tile-${row}-${col}.svg`)
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

    log('collecting leaf bboxes (this may take a moment for ~25k elements)...')
    const leaves = await collectLeafBBoxes(page)
    log(`collected ${leaves.length} leaf bboxes`)

    // Build tile bounds.
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

    // Assign leaves to tiles.
    const tileSelectors: string[][][] = tileBounds.map(row => row.map(() => []))
    for (const leaf of leaves) {
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          if (bboxesIntersect(leaf.bbox, tileBounds[r][c])) {
            tileSelectors[r][c].push(leaf.selector)
          }
        }
      }
    }

    // For each tile, extract the pruned subtree and emit the SVG.
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
        writeTile(r, c, tileViewBox, tileDefs, body)
        log(`  tile-${r}-${c}.svg: ${sels.length} leaves, ${refs.size} defs ids`)
      }
    }

    await browser.close()

    const manifest = {
      version: VERSION,
      source: path.basename(PDF_PATH),
      viewBox: [viewBox.x, viewBox.y, viewBox.w, viewBox.h],
      grid: { rows: GRID_ROWS, cols: GRID_COLS },
      tileSize: { w: tileW, h: tileH }
    }
    writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    log(`wrote manifest.json + ${GRID_ROWS * GRID_COLS} tiles to ${OUT_DIR}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
