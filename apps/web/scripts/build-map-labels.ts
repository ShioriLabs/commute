/*
 * Builds app/data/map-labels.json — every text label on the FDTJ map as
 * positioned runs of real text, extracted from the source PDF via
 * `mutool draw -F stext` (per-character origins, so kerning and shaping are
 * whatever the artwork says, never recomputed).
 *
 * Prerequisites (neither is committed):
 *   - the source PDF at the repo root (same file build-map-tiles.ts consumes)
 *   - mutool on PATH (apt install mupdf-tools)
 *
 * The committed tile SVGs act as two safety nets: a fill-color oracle for
 * mutool versions whose stext omits color, and a registration cross-check that
 * proves the PDF-point → world-unit conversion (×4) on every build by matching
 * sampled characters against the tiles' glyph placements.
 *
 * Run: pnpm build:map-labels
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { channelDistance } from './lib/map-extract-common'
import { collapseHalos, dedupChars, groupRuns, parseStext } from './lib/map-stext'
import type { LabelRun } from './lib/map-stext'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(SCRIPT_DIR, '..')
const REPO_ROOT = path.resolve(WEB_ROOT, '../..')
const PDF_PATH = path.join(REPO_ROOT, '2026-06a-Peta-Integrasi-Jakarta-FDTJ-Web.pdf')
const TILE_DIR = path.join(WEB_ROOT, 'public', 'maps', 'fdtj')
const GEOMETRY_PATH = path.join(WEB_ROOT, 'app', 'data', 'map-geometry.json')
const ATLAS_PATH = path.join(WEB_ROOT, 'app', 'data', 'map-label-atlas.json')
const OUT_PATH = path.join(WEB_ROOT, 'app', 'data', 'map-labels.json')

/**
 * World units per PDF point. The page's MediaBox IS the world viewBox
 * (9513.57 x 6726.88) — pdf2svg carried it through unscaled — so this is 1.
 * The registration cross-check below proves it against the tile glyphs.
 */
const WORLD_PER_PT = 1
const PAGE_W_PT = 9513.57
const PAGE_H_PT = 6726.88
const PAGE_TOLERANCE_PT = 0.5

// stext font names (subset prefix stripped) → canonical names for the dataset
// and the atlas builder's FONT_FILES table. Extend both together when pdffonts
// reveals a variant this misses — the unknown-font guardrail prints the name.
// Actual embedded names per pdffonts (2026-06a edition): PTSans-{Regular,Bold,
// Italic}, PTSans-Narrow, PTSans-NarrowBold, PlusJakartaSans-Regular. The last
// appears only in the sheet frame as of this edition — if it ever moves onto
// the canvas, the unknown-font guardrail names it and it gets a TTF.
const FONT_TABLE: Record<string, string> = {
  'PTSans-Regular': 'PTSans-Regular',
  'PTSans-Bold': 'PTSans-Bold',
  'PTSans-Italic': 'PTSans-Italic',
  'PTSans-BoldItalic': 'PTSans-BoldItalic',
  'PTSans-Narrow': 'PTSansNarrow-Regular',
  'PTSans-NarrowBold': 'PTSansNarrow-Bold'
}

// Colors are quantized onto the artwork's known inks plus whatever else
// survives; this tolerance collapses pdf2svg percentage rounding.
const COLOR_TOLERANCE = 8
// Ceiling on chars whose color had to come from the nearest-ink heuristic.
const MAX_HEURISTIC_COLOR_FRACTION = 0.02

// Guardrails.
const MIN_CHARS = 6000
const MIN_HALO_CHARS = 1500
const MAX_HALO_CHARS = 4000
// Catches gross conversion errors (wrong scale, flipped axis), not per-glyph
// noise: measured on this edition, ~85% of chars sit at distance 0.00 from a
// tile glyph placement and the remainder are rotated-frame or synthesized
// glyphs, so 80% within 1.5 units is decisive while wrong-scale scores ~0%.
const REGISTRATION_SAMPLES = 200
const REGISTRATION_MIN_MATCH = 0.8
const REGISTRATION_TOLERANCE_WORLD = 1.5
const MAX_BYTES = 600 * 1024

function log(msg: string): void {
  console.log(`[build-map-labels] ${msg}`)
}

function stripSubsetPrefix(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, '')
}

/**
 * Position → fill index over the committed tile SVGs' glyph placements:
 * `<use xlink:href="#glyph-…" x y>` inside `<g fill="rgb(p%, p%, p%)">`
 * wrappers, already in world units. Serves the color fallback and the
 * registration cross-check.
 */
function buildTileGlyphIndex(): Map<string, { x: number, y: number, color: string }[]> {
  const index = new Map<string, { x: number, y: number, color: string }[]>()
  const cell = (x: number, y: number) => `${Math.round(x / 4)},${Math.round(y / 4)}`
  const tiles = readdirSync(TILE_DIR).filter(f => /^tile-\d+-\d+\.svg$/.test(f))

  const pctToHex = (m: RegExpExecArray): string => '#' + [m[1], m[2], m[3]]
    .map(v => Math.round((parseFloat(v) / 100) * 255).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()

  for (const tile of tiles) {
    const svg = readFileSync(path.join(TILE_DIR, tile), 'utf8')
    const fillStack: string[] = []
    const tagRe = /<(\/?)(g|use)\b([^>]*?)\/?>/g
    let m: RegExpExecArray | null
    while ((m = tagRe.exec(svg)) !== null) {
      if (m[2] === 'g') {
        if (m[1] === '/') {
          fillStack.pop()
        } else {
          const fill = /fill="rgb\(([\d.]+)%,\s*([\d.]+)%,\s*([\d.]+)%\)"/.exec(m[3])
          fillStack.push(fill ? pctToHex(fill) : fillStack[fillStack.length - 1] ?? '')
        }
        continue
      }
      if (m[1] === '/') continue
      if (!/href="#glyph-/.test(m[3])) continue
      const x = parseFloat(/\bx="([-\d.]+)"/.exec(m[3])?.[1] ?? 'NaN')
      const y = parseFloat(/\by="([-\d.]+)"/.exec(m[3])?.[1] ?? 'NaN')
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      const color = fillStack[fillStack.length - 1] ?? ''
      const key = cell(x, y)
      let bucket = index.get(key)
      if (!bucket) {
        bucket = []
        index.set(key, bucket)
      }
      bucket.push({ x, y, color })
    }
  }
  return index
}

function lookupTileGlyph(
  index: Map<string, { x: number, y: number, color: string }[]>,
  worldX: number,
  worldY: number,
  tolerance: number
): { x: number, y: number, color: string } | null {
  const cx = Math.round(worldX / 4)
  const cy = Math.round(worldY / 4)
  let best: { x: number, y: number, color: string } | null = null
  let bestDist = tolerance
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const g of index.get(`${cx + dx},${cy + dy}`) ?? []) {
        const d = Math.hypot(g.x - worldX, g.y - worldY)
        if (d <= bestDist) {
          bestDist = d
          best = g
        }
      }
    }
  }
  return best
}

/**
 * Halo-stroke bounding boxes from the phase-1 raw extraction cache: the artwork
 * draws haloed text with PDF render mode fill+stroke (one text op — stext sees
 * one char with the fill color, never a white twin), but the white stroke pass
 * survives in the tile SVGs as per-glyph stroked outlines, which the geometry
 * extractor classified (and skipped) as text-halo. A char whose glyph area
 * falls inside one of those boxes is haloed.
 */
function loadHaloBoxes(): [number, number, number, number][] | null {
  const cachePath = path.join(WEB_ROOT, 'node_modules', '.cache', 'map-geometry-raw.json')
  if (!existsSync(cachePath)) return null
  const perTile = JSON.parse(readFileSync(cachePath, 'utf8')) as {
    stroke: string | null
    fill: string | null
    strokeWidth: number
    curved: boolean
    bbox: [number, number, number, number]
  }[][]
  const boxes: [number, number, number, number][] = []
  const seen = new Set<string>()
  for (const els of perTile) {
    for (const el of els) {
      if (!el.stroke || el.fill || !el.curved) continue
      if (el.strokeWidth < 8.5 || el.strokeWidth > 9.8) continue
      if (channelDistance(el.stroke, '#FFFFFF') > 8) continue
      const key = el.bbox.map(v => Math.round(v * 4)).join(',')
      if (seen.has(key)) continue
      seen.add(key)
      boxes.push(el.bbox)
    }
  }
  return boxes
}

// The artwork's text inks, for the last-resort color heuristic.
const KNOWN_INKS = ['#19181C', '#FFFFFF', '#583716', '#64696C', '#888D91']

function nearestInk(color: string | null): string {
  if (!color) return KNOWN_INKS[0]
  let best = KNOWN_INKS[0]
  let bestDist = Infinity
  for (const ink of KNOWN_INKS) {
    const d = channelDistance(color, ink)
    if (d < bestDist) {
      bestDist = d
      best = ink
    }
  }
  return best
}

async function main(): Promise<void> {
  if (!existsSync(PDF_PATH)) {
    throw new Error(`source PDF not found at ${PDF_PATH} — it is not committed; place it there (see build-map-tiles.ts)`)
  }
  try {
    const version = execFileSync('mutool', ['-v'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    log(`mutool: ${version || 'present'}`)
  } catch (err) {
    if (err instanceof Error && err.message.includes('ENOENT')) {
      throw new Error('mutool not found — apt install mupdf-tools')
    }
    // mutool -v prints to stderr on some versions and exits 0/1; presence is
    // all that matters here.
    log('mutool: present')
  }

  const geometry = JSON.parse(readFileSync(GEOMETRY_PATH, 'utf8')) as {
    version: string
    canvas: [number, number, number, number]
  }
  const canvas = geometry.canvas

  const tmp = mkdtempSync(path.join(tmpdir(), 'map-labels-'))
  let xml: string
  try {
    const stextPath = path.join(tmp, 'stext.xml')
    execFileSync('mutool', ['draw', '-F', 'stext', '-o', stextPath, PDF_PATH, '1'], { stdio: ['ignore', 'pipe', 'pipe'] })
    xml = readFileSync(stextPath, 'utf8')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  const pages = parseStext(xml)
  if (pages.length !== 1) throw new Error(`expected 1 page, got ${pages.length}`)
  const page = pages[0]
  if (Math.abs(page.width - PAGE_W_PT) > PAGE_TOLERANCE_PT || Math.abs(page.height - PAGE_H_PT) > PAGE_TOLERANCE_PT) {
    throw new Error(`page is ${page.width}x${page.height} pt, expected ${PAGE_W_PT}x${PAGE_H_PT} — wrong PDF or wrong scale assumption`)
  }
  const totalChars = page.lines.reduce((a, l) => a + l.chars.length, 0)
  log(`stext: ${page.lines.length} lines, ${totalChars} chars`)

  // Exact double-draws first (identical glyph+color+origin), then the halo
  // white-twin collapse. This edition draws halos as render-mode fill+stroke
  // instead — no twins — so the tile halo-box fallback below does the tagging.
  const { lines: dedupedLines, dropped } = dedupChars(page.lines)
  log(`char dedup: ${dropped} exact double-draws dropped`)
  const { lines, collapsed } = collapseHalos(dedupedLines)
  log(`halo collapse: ${collapsed} white twins folded`)

  if (collapsed === 0) {
    const boxes = loadHaloBoxes()
    if (!boxes) {
      log('WARN no raw-extraction cache — halo tagging skipped (run build:map-geometry first)')
    } else {
      const cellSize = 64
      const grid = new Map<string, [number, number, number, number][]>()
      for (const box of boxes) {
        const [bx, by, bw, bh] = box
        for (let cx = Math.floor(bx / cellSize); cx <= Math.floor((bx + bw) / cellSize); cx++) {
          for (let cy = Math.floor(by / cellSize); cy <= Math.floor((by + bh) / cellSize); cy++) {
            const key = `${cx},${cy}`
            let bucket = grid.get(key)
            if (!bucket) {
              bucket = []
              grid.set(key, bucket)
            }
            bucket.push(box)
          }
        }
      }
      let tagged = 0
      for (const line of lines) {
        for (const ch of line.chars) {
          // Probe inside the glyph body: a little right of the pen, a bit
          // above the baseline (glyphs sit above it, boxes hug the outline).
          const px = (ch.x + 3) * WORLD_PER_PT
          const py = (ch.y - ch.size * 0.3) * WORLD_PER_PT
          const pad = 2
          const hit = (grid.get(`${Math.floor(px / cellSize)},${Math.floor(py / cellSize)}`) ?? [])
            .some(([bx, by, bw, bh]) => px >= bx - pad && px <= bx + bw + pad && py >= by - pad && py <= by + bh + pad)
          if (hit) {
            ch.halo = true
            tagged++
          }
        }
      }
      log(`halo tagging: ${boxes.length} halo boxes from the raw cache, ${tagged} chars tagged`)
    }
  }

  // Color: prefer stext's own attribute; fall back to the tile-SVG oracle.
  const flatChars = lines.flatMap(l => l.chars)
  const withColor = flatChars.filter(c => c.color !== null).length
  let tileIndex: Map<string, { x: number, y: number, color: string }[]> | null = null
  let heuristicCount = 0
  if (withColor / Math.max(1, flatChars.length) < 0.99) {
    log(`stext color coverage ${(withColor / Math.max(1, flatChars.length) * 100).toFixed(1)}% — using tile-SVG color oracle`)
    tileIndex = buildTileGlyphIndex()
    for (const line of lines) {
      for (const ch of line.chars) {
        if (ch.color !== null) continue
        const hit = lookupTileGlyph(tileIndex, ch.x * WORLD_PER_PT, ch.y * WORLD_PER_PT, REGISTRATION_TOLERANCE_WORLD)
        if (hit && hit.color) {
          ch.color = hit.color
        } else {
          ch.color = nearestInk(ch.color)
          heuristicCount++
        }
      }
    }
    if (heuristicCount / Math.max(1, flatChars.length) > MAX_HEURISTIC_COLOR_FRACTION) {
      throw new Error(`${heuristicCount} chars needed the nearest-ink color heuristic — the tile oracle is misaligned`)
    }
  }

  const runs = groupRuns(lines)

  // Frame exclusion + world conversion + font table.
  const inCanvas = (r: LabelRun): boolean => {
    const x = r.x * WORLD_PER_PT
    const y = r.y * WORLD_PER_PT
    const pad = 8
    return x >= canvas[0] - pad && x <= canvas[0] + canvas[2] + pad
      && y >= canvas[1] - pad && y <= canvas[1] + canvas[3] + pad
  }
  const kept = runs.filter(inCanvas)
  log(`runs: ${runs.length} total, ${kept.length} inside the canvas`)

  const fonts: string[] = []
  const fontIdx = new Map<string, number>()
  const unknownFonts = new Set<string>()
  const fontRef = (stextName: string): number => {
    const canonical = FONT_TABLE[stripSubsetPrefix(stextName)]
    if (!canonical) {
      unknownFonts.add(stripSubsetPrefix(stextName))
      return -1
    }
    let i = fontIdx.get(canonical)
    if (i === undefined) {
      i = fonts.length
      fonts.push(canonical)
      fontIdx.set(canonical, i)
    }
    return i
  }

  // Quantized palette.
  const palette: string[] = []
  const colorRef = (hex: string): number => {
    for (let i = 0; i < palette.length; i++) {
      if (channelDistance(palette[i], hex) <= COLOR_TOLERANCE) return i
    }
    palette.push(hex)
    return palette.length - 1
  }

  // PDF points → fixed-point world units (x4 world scale, x4 fixed point).
  const fixed = (v: number): number => Math.round(v * WORLD_PER_PT * 4)

  const outRuns = kept.map((run) => {
    const f = fontRef(run.font)
    const doc: Record<string, unknown> = {
      f,
      s: Math.round(run.size * WORLD_PER_PT * 4),
      c: colorRef(run.color ?? KNOWN_INKS[0]),
      x: fixed(run.x),
      y: fixed(run.y),
      t: run.text,
      a: run.offsets.map(o => Math.round(o * WORLD_PER_PT * 4))
    }
    if (run.halo) doc.h = colorRef('#FFFFFF')
    if (Math.abs(run.dir[0] - 1) > 0.001 || Math.abs(run.dir[1]) > 0.001) {
      doc.d = [Math.round(run.dir[0] * 1000), Math.round(run.dir[1] * 1000)]
    }
    return doc
  })

  if (unknownFonts.size > 0) {
    throw new Error(`unknown fonts in the PDF: ${[...unknownFonts].join(', ')} — extend FONT_TABLE and the atlas FONT_FILES`)
  }

  // Guardrails.
  const keptChars = kept.reduce((a, r) => a + [...r.text].length, 0)
  if (keptChars < MIN_CHARS) {
    throw new Error(`only ${keptChars} in-canvas chars (min ${MIN_CHARS}) — extraction or frame exclusion is broken`)
  }
  const haloChars = kept.filter(r => r.halo).reduce((a, r) => a + [...r.text].length, 0)
  if (haloChars < MIN_HALO_CHARS || haloChars > MAX_HALO_CHARS) {
    throw new Error(`${haloChars} halo-tagged chars (expected ${MIN_HALO_CHARS}-${MAX_HALO_CHARS}) — the halo collapse predicate no longer matches`)
  }

  // Registration cross-check: sampled chars must land on tile-SVG glyphs.
  // Sampled evenly across every kept run, not just the first ones, so one
  // odd corner of the sheet can't dominate the verdict.
  tileIndex ??= buildTileGlyphIndex()
  const samples: { x: number, y: number }[] = []
  const runStep = Math.max(1, Math.floor(kept.length / REGISTRATION_SAMPLES))
  for (let r = 0; r < kept.length && samples.length < REGISTRATION_SAMPLES; r += runStep) {
    const run = kept[r]
    samples.push({
      x: (run.x + run.dir[0] * run.offsets[0]) * WORLD_PER_PT,
      y: (run.y + run.dir[1] * run.offsets[0]) * WORLD_PER_PT
    })
  }
  const matched = samples.filter(s => lookupTileGlyph(tileIndex!, s.x, s.y, REGISTRATION_TOLERANCE_WORLD) !== null).length
  if (matched / Math.max(1, samples.length) < REGISTRATION_MIN_MATCH) {
    throw new Error(`registration check failed: ${matched}/${samples.length} sampled chars match tile glyph placements`)
  }
  log(`registration: ${matched}/${samples.length} sampled chars matched`)

  // Atlas-charset check, once a real atlas exists.
  if (existsSync(ATLAS_PATH)) {
    const atlas = JSON.parse(readFileSync(ATLAS_PATH, 'utf8')) as {
      fonts: { name: string, glyphs: Record<string, unknown> }[]
    }
    const byName = new Map(atlas.fonts.map(f => [f.name, f.glyphs]))
    let missing = 0
    for (const run of kept) {
      const glyphs = byName.get(fonts[fontRef(run.font)])
      if (!glyphs) continue
      for (const ch of run.text) {
        if (!/\s/.test(ch) && !(ch in glyphs)) {
          if (missing < 10) log(`WARN atlas missing "${ch}" for ${run.font}`)
          missing++
        }
      }
    }
    if (missing > 0) {
      log(`WARN ${missing} chars missing from the atlas — re-run build:map-label-atlas after this build`)
    }
  }

  const doc = {
    version: geometry.version,
    scale: 4,
    fonts,
    palette,
    runs: outRuns
  }
  const json = JSON.stringify(doc) + '\n'
  if (json.length > MAX_BYTES) {
    throw new Error(`${(json.length / 1024).toFixed(0)} KB exceeds ${(MAX_BYTES / 1024).toFixed(0)} KB`)
  }
  writeFileSync(OUT_PATH, json)
  log(`wrote ${path.relative(WEB_ROOT, OUT_PATH)} (${(json.length / 1024).toFixed(1)} KB, ${outRuns.length} runs, ${keptChars} chars, ${palette.length} colours, fonts: ${fonts.join(', ')})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
