import { initWasm, Resvg } from '@resvg/resvg-wasm'
// Bundled as a WebAssembly.Module via the wrangler CompiledWasm rule (see wrangler.toml).
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'
import { FONT_BYTES } from './assets/font'
import { FARE_TEMPLATE } from './assets/og-fare-template'

// initWasm must run exactly once per isolate (it throws if called twice). Guard
// with a module-level promise, mirroring the cachedGraph pattern in the api
// worker's fares route.
let wasmReady: Promise<void> | null = null
function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = initWasm(resvgWasm as WebAssembly.Module)
  }
  return wasmReady
}

// Ported from apps/web/scripts/build-og-images.ts.
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Fit a name onto one line by shrinking the font when it's longer than the
// template's slot. Headline x=38 on a 1200-wide card; at 64px bold ~21 chars
// fit before the right edge, then scale down (floored so it stays legible).
const TEMPLATE_FONT_SIZE = 64
const MAX_CHARS_AT_BASE = 21
const MIN_FONT_SIZE = 40
function fontSizeFor(name: string): number {
  if (name.length <= MAX_CHARS_AT_BASE) return TEMPLATE_FONT_SIZE
  const scaled = Math.floor(TEMPLATE_FONT_SIZE * (MAX_CHARS_AT_BASE / name.length))
  return Math.max(MIN_FONT_SIZE, scaled)
}

function buildSvg(fromName: string, toName: string): string {
  // "__FROM__ Ke" adds a fixed suffix, so budget for it when shrinking the from name.
  const fromFs = fontSizeFor(`${fromName} Ke`)
  const toFs = fontSizeFor(toName)
  return FARE_TEMPLATE
    .replace('__FROM_FS__', String(fromFs))
    .replace('__TO_FS__', String(toFs))
    .replace('__FROM__', xmlEscape(fromName))
    .replace('__TO__', xmlEscape(toName))
}

// Render the fare card PNG for a station pair. Returns raw PNG bytes.
export async function renderFareCard(fromName: string, toName: string): Promise<Uint8Array> {
  await ensureWasm()
  const svg = buildSvg(fromName, toName)
  const resvg = new Resvg(svg, {
    font: {
      fontBuffers: [FONT_BYTES],
      loadSystemFonts: false,
      defaultFontFamily: 'Plus Jakarta Sans'
    },
    fitTo: { mode: 'width', value: 1200 }
  })
  return resvg.render().asPng()
}
