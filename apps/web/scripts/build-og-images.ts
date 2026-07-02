/*
 * Prerenders per-station and per-hub OpenGraph card images.
 *
 * Pipeline:
 *   1. Fetch /stations (CGK region) + /hubs from the API.
 *   2. For each, substitute the name into the SVG template's headline slot and
 *      shrink the font for long names so they don't overflow the card.
 *   3. Rasterize SVG -> PNG with @resvg/resvg-js, feeding it the vendored Plus
 *      Jakarta Sans Bold TTF (font-family in the SVG is only a name reference —
 *      resvg must be given the actual bytes or it falls back to a default sans).
 *   4. Write public/img/og/stations/<OPERATOR-CODE>.png and
 *      public/img/og/hubs/<slug>.png.
 *
 * Run: pnpm build:og   (API_BASE_URL env or arg, default http://localhost:3000)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(SCRIPT_DIR, '..')
const TEMPLATE_PATH = path.join(SCRIPT_DIR, 'assets', 'og-station-template.svg')
const FONT_PATH = path.join(SCRIPT_DIR, 'assets', 'PlusJakartaSans-Bold.ttf')
const OUT_STATIONS = path.join(WEB_ROOT, 'public', 'img', 'og', 'stations')
const OUT_HUBS = path.join(WEB_ROOT, 'public', 'img', 'og', 'hubs')

const API_BASE_URL = process.env.API_BASE_URL
  ?? process.env.VITE_API_BASE_URL
  ?? process.argv[2]
  ?? 'http://localhost:3000'

// The literal placeholder text sitting in the template's 3rd <tspan>. (The
// Figma export's &#x2028;/&#10; line separators were stripped from the template
// because resvg renders them as visible tofu glyphs.)
const PLACEHOLDER_MARKUP = '>Jakarta Intl. Stadium<'
const TEMPLATE_FONT_SIZE = 64
// Headline x=38 on a 1200-wide card. At 64px bold, ~21 chars fit before the
// right edge. Beyond that we scale down proportionally (floor so it stays legible).
const MAX_CHARS_AT_BASE = 21
const MIN_FONT_SIZE = 40

// Display-only name overrides for the card, keyed by station id. Lets long names
// use a shorter form on the image without touching the API/DB or the OG title.
const STATION_NAME_OVERRIDES: Record<string, string> = {
  'KCI-JIS': 'Jakarta Intl. Stadium',
  'LRTJ-BVU': 'Blvd. Utara Summarecon Mall'
}

interface Line { name: string, lineCode: string, colorCode: string }
interface Station { id: string, name: string, formattedName: string | null, code: string, regionCode: string, operator: { code: string, name: string }, lines: Line[] }
interface Hub { slug: string, name: string, members: Station[] }
interface ApiResponse<T> { status: number, data?: T, error?: { message: string, code: string } }

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Fit the name onto one line by shrinking the font when it's longer than the
// template's slot. Simple char-count heuristic — good enough for station names.
function fontSizeFor(name: string): number {
  if (name.length <= MAX_CHARS_AT_BASE) return TEMPLATE_FONT_SIZE
  const scaled = Math.floor(TEMPLATE_FONT_SIZE * (MAX_CHARS_AT_BASE / name.length))
  return Math.max(MIN_FONT_SIZE, scaled)
}

function renderCard(template: string, name: string): Buffer {
  const fontSize = fontSizeFor(name)
  let svg = template.replace(PLACEHOLDER_MARKUP, `>${xmlEscape(name)}<`)
  // Only shrink when needed; keep the template's 64px otherwise.
  if (fontSize !== TEMPLATE_FONT_SIZE) {
    svg = svg.replace(`font-size="${TEMPLATE_FONT_SIZE}"`, `font-size="${fontSize}"`)
  }
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: [FONT_PATH],
      loadSystemFonts: false,
      defaultFontFamily: 'Plus Jakarta Sans'
    },
    fitTo: { mode: 'width', value: 1200 }
  })
  return resvg.render().asPng()
}

async function fetchData<T>(url: string): Promise<T | null> {
  const res = await fetch(url)
  if (!res.ok) {
    console.error(`  ! ${url} -> ${res.status}`)
    return null
  }
  const body = await res.json() as ApiResponse<T>
  return body.data ?? null
}

async function main() {
  console.log(`Building OG images from ${API_BASE_URL}`)
  const template = readFileSync(TEMPLATE_PATH, 'utf8')
  mkdirSync(OUT_STATIONS, { recursive: true })
  mkdirSync(OUT_HUBS, { recursive: true })

  const stations = await fetchData<Station[]>(`${API_BASE_URL}/stations`)
  const hubs = await fetchData<Hub[]>(`${API_BASE_URL}/hubs`)

  let stationCount = 0
  for (const station of stations ?? []) {
    if (station.regionCode !== 'CGK') continue // match search scope (Jakarta area)
    const name = STATION_NAME_OVERRIDES[station.id] || station.formattedName || station.name
    const png = renderCard(template, name)
    writeFileSync(path.join(OUT_STATIONS, `${station.id}.png`), png)
    stationCount++
  }

  let hubCount = 0
  for (const hub of hubs ?? []) {
    const png = renderCard(template, hub.name)
    writeFileSync(path.join(OUT_HUBS, `${hub.slug}.png`), png)
    hubCount++
  }

  console.log(`Done: ${stationCount} stations, ${hubCount} hubs`)
  if (stationCount === 0) console.warn('WARNING: no stations rendered — check API_BASE_URL / data.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
