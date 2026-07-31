/*
 * Builds app/data/map-label-atlas.{png,json} — the MSDF glyph atlas for the map
 * label layer, generated from the committed PT Sans / PT Sans Narrow TTFs in
 * scripts/fonts/ (Google Fonts, OFL — see OFL-PTSans.txt there).
 *
 * The charset is derived from app/data/map-labels.json (whatever characters the
 * artwork actually uses, plus a printable-ASCII floor so authoring edits don't
 * force regeneration). Until build-map-labels.ts has produced a real dataset
 * (it needs the source PDF), the placeholder's empty runs simply yield the
 * ASCII floor — the pipeline stays runnable end to end.
 *
 * distanceRange 8 at fontSize 48 gives a half-band of 0.083 em, which covers
 * the artwork's glyph halo (a ~9.3-world-unit white stroke = up to ~0.06 em of
 * outward expansion at the smallest haloed text) with margin — the label
 * shader renders the halo by re-thresholding this same field.
 *
 * Run: pnpm build:map-label-atlas
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import generateBMFont from 'msdf-bmfont-xml'
import { PNG } from 'pngjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(SCRIPT_DIR, '..')
const FONT_DIR = path.join(SCRIPT_DIR, 'fonts')
const LABELS_PATH = path.join(WEB_ROOT, 'app', 'data', 'map-labels.json')
const OUT_PNG = path.join(WEB_ROOT, 'app', 'data', 'map-label-atlas.png')
const OUT_JSON = path.join(WEB_ROOT, 'app', 'data', 'map-label-atlas.json')

const FONT_SIZE = 48
const DISTANCE_RANGE = 8
const PAGE_SIZE = 512
// MSDF RGB is noisy and PNG-compresses poorly; five fonts of real glyph
// coverage genuinely need this much. Context: the raster tiles this layer
// replaces cost ~9 MB.
const MAX_PNG_BYTES = 600 * 1024

// stext font name (subset prefix stripped) → committed TTF. Unknown names in
// map-labels.json fail the build; extend this table (and scripts/fonts/) when
// pdffonts reveals a variant it doesn't cover.
const FONT_FILES: Record<string, string> = {
  'PTSans-Regular': 'PT_Sans-Web-Regular.ttf',
  'PTSans-Bold': 'PT_Sans-Web-Bold.ttf',
  'PTSans-Italic': 'PT_Sans-Web-Italic.ttf',
  'PTSans-BoldItalic': 'PT_Sans-Web-BoldItalic.ttf',
  'PTSansNarrow-Regular': 'PT_Sans-Narrow-Web-Regular.ttf',
  'PTSansNarrow-Bold': 'PT_Sans-Narrow-Web-Bold.ttf'
}

// Digits and capitals stay available in every font even if the current
// edition doesn't use them — cheap insurance against a renamed station —
// but the full printable-ASCII floor tripled the PNG for glyphs nothing uses.
const CHARSET_FLOOR = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

interface BMFontChar {
  id: number
  x: number
  y: number
  width: number
  height: number
  xoffset: number
  yoffset: number
  xadvance: number
}

interface BMFontData {
  common: { lineHeight: number, base: number, scaleW: number, scaleH: number }
  info: { size: number }
  chars: BMFontChar[]
}

function log(msg: string): void {
  console.log(`[build-map-label-atlas] ${msg}`)
}

function generate(fontPath: string, charset: string): Promise<{ texture: Buffer, data: BMFontData }> {
  return new Promise((resolve, reject) => {
    generateBMFont(fontPath, {
      outputType: 'json',
      fieldType: 'msdf',
      fontSize: FONT_SIZE,
      distanceRange: DISTANCE_RANGE,
      charset,
      textureSize: [PAGE_SIZE, PAGE_SIZE],
      // Shrink each page to its content — five near-empty 512² pages tripled
      // the PNG budget; the compositor below stacks variable-height pages.
      smartSize: true,
      pot: false,
      square: false
    }, (err: Error | null, textures: { filename: string, texture: Buffer }[], font: { data: string }) => {
      if (err) {
        reject(err)
        return
      }
      if (textures.length !== 1) {
        reject(new Error(`font ${path.basename(fontPath)} needed ${textures.length} pages — grow PAGE_SIZE`))
        return
      }
      resolve({ texture: textures[0].texture, data: JSON.parse(font.data) as BMFontData })
    })
  })
}

async function main(): Promise<void> {
  const labels = JSON.parse(readFileSync(LABELS_PATH, 'utf8')) as {
    fonts: string[]
    runs: { f: number, t: string }[]
  }

  // Per-font charset: every character the artwork uses, plus the floor.
  const charsets = labels.fonts.map(() => new Set<string>([...CHARSET_FLOOR]))
  for (const run of labels.runs) {
    for (const ch of run.t) {
      if (!/\s/.test(ch)) charsets[run.f].add(ch)
    }
  }

  const pages: { name: string, png: PNG, data: BMFontData }[] = []
  for (let i = 0; i < labels.fonts.length; i++) {
    const name = labels.fonts[i]
    const file = FONT_FILES[name]
    if (!file) {
      throw new Error(`no TTF mapping for font "${name}" — add it to FONT_FILES and scripts/fonts/`)
    }
    const charset = [...charsets[i]].join('')
    const { texture, data } = await generate(path.join(FONT_DIR, file), charset)

    // msdf-bmfont silently drops glyphs the font lacks: assert coverage.
    const covered = new Set(data.chars.map(c => c.id))
    for (const ch of charsets[i]) {
      if (!covered.has(ch.codePointAt(0)!)) {
        throw new Error(`font ${name} (${file}) is missing glyph "${ch}" (U+${ch.codePointAt(0)!.toString(16).toUpperCase()})`)
      }
    }
    pages.push({ name, png: PNG.sync.read(texture), data })
    log(`${name}: ${data.chars.length} glyphs`)
  }

  // Composite the per-font pages into one vertically-stacked atlas.
  const atlasW = Math.max(...pages.map(p => p.png.width))
  const atlasH = pages.reduce((a, p) => a + p.png.height, 0)
  const atlas = new PNG({ width: atlasW, height: atlasH })
  let nextY = 0
  const fonts = pages.map((page) => {
    const yBase = nextY
    nextY += page.png.height
    PNG.bitblt(page.png, atlas, 0, 0, page.png.width, page.png.height, 0, yBase)
    const glyphs: Record<string, { x: number, y: number, w: number, h: number, xo: number, yo: number }> = {}
    for (const ch of page.data.chars) {
      glyphs[String.fromCodePoint(ch.id)] = {
        x: ch.x,
        y: ch.y + yBase,
        w: ch.width,
        h: ch.height,
        xo: ch.xoffset,
        yo: ch.yoffset
      }
    }
    return {
      name: page.name,
      fontSize: page.data.info.size,
      base: page.data.common.base,
      glyphs
    }
  })

  const png = PNG.sync.write(atlas)
  if (png.length > MAX_PNG_BYTES) {
    throw new Error(`atlas PNG is ${(png.length / 1024).toFixed(0)} KB (max ${MAX_PNG_BYTES / 1024} KB)`)
  }
  writeFileSync(OUT_PNG, png)

  const doc = {
    size: [atlasW, atlasH],
    distanceRange: DISTANCE_RANGE,
    fonts
  }
  const json = JSON.stringify(doc) + '\n'
  writeFileSync(OUT_JSON, json)
  log(`wrote ${path.relative(WEB_ROOT, OUT_PNG)} (${(png.length / 1024).toFixed(1)} KB, ${atlasW}x${atlasH}) and ${path.relative(WEB_ROOT, OUT_JSON)} (${(json.length / 1024).toFixed(1)} KB)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
