/*
 * Side-by-side parity screenshots of the tile map vs the vector-primitive layer.
 *
 * For each camera (default fit plus a few zoom-ins at different anchors) this
 * captures /map in three variants — tiles (?vector off), ?vector=only, and
 * ?vector=overlay — and writes PNGs to the output directory for eyeballing.
 * No pixel-diff threshold: known gaps would dominate any metric. As of the
 * label phase, `only` should show text, badges and roundels; the remaining
 * expected gaps are icons/arrows, landmark artwork, defs-fragmented planned
 * corridor dashes, and hatch patterns. `overlay` is the registration check
 * (misalignment reads as colored fringes; labels are never drawn there since
 * the tiles already rasterize the text); `only` is the coverage check.
 *
 * The dev server hangs on direct sub-route loads, so run this against a
 * production preview:
 *   pnpm build && pnpm start          # serves on :3000
 *   npx tsx scripts/compare-map-vector.ts [baseUrl] [outDir]
 *
 * NOTE: ?vector= is read behind import.meta.env.DEV, so a production build
 * ignores it. For vector shots against a prod server, temporarily build with
 * the guard relaxed — or run the dev server and navigate from '/', which this
 * script does automatically when the direct load times out.
 */

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const BASE_URL = process.argv[2] ?? 'http://localhost:5173'
const OUT_DIR = process.argv[3] ?? path.join(process.cwd(), '.map-vector-compare')

const VARIANTS = [
  { name: 'tiles', query: '' },
  { name: 'vector-only', query: '?vector=only' },
  { name: 'overlay', query: '?vector=overlay' }
]

// Wheel-zoom steps applied cumulatively at each anchor (viewport fractions).
const CAMERAS = [
  { name: 'fit', anchor: [0.5, 0.5], steps: 0 },
  { name: 'center-z1', anchor: [0.5, 0.5], steps: 4 },
  { name: 'center-z2', anchor: [0.5, 0.5], steps: 8 },
  { name: 'west-z2', anchor: [0.25, 0.45], steps: 8 },
  { name: 'east-z2', anchor: [0.75, 0.55], steps: 8 },
  // Text-dense: the Manggarai/Matraman label cluster at label-reading zoom.
  { name: 'labels-z1', anchor: [0.55, 0.45], steps: 5 }
]

const VIEWPORT = { width: 1280, height: 900 }

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 })

  for (const variant of VARIANTS) {
    const page = await context.newPage()
    const url = `${BASE_URL}/map${variant.query}`
    console.log(`[compare-map-vector] ${variant.name}: ${url}`)

    // Direct /map deep links hang the dev server; fall back to a client-side
    // navigation from the home page when that happens. The popstate dispatch is
    // ignored if it lands before hydration, so give it settle time and retry.
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })
    } catch {
      console.log('[compare-map-vector]   direct load timed out; navigating client-side')
      await page.goto(BASE_URL, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1500)
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.evaluate((target: string) => {
          window.history.pushState({}, '', target)
          window.dispatchEvent(new PopStateEvent('popstate'))
        }, `/map${variant.query}`)
        try {
          await page.waitForSelector('canvas', { timeout: 5000 })
          break
        } catch {
          console.log('[compare-map-vector]   canvas not up yet; retrying navigation')
        }
      }
    }
    await page.waitForSelector('canvas', { timeout: 15000 })
    // Let tiles/geometry load and the morph settle.
    await page.waitForTimeout(3500)

    let applied = 0
    for (const camera of CAMERAS) {
      const cx = VIEWPORT.width * camera.anchor[0]
      const cy = VIEWPORT.height * camera.anchor[1]
      // Cameras are ordered by cumulative zoom at (possibly) different anchors;
      // reset by reloading is slow, so zoom deltas apply relative to the last.
      if (camera.steps < applied) {
        for (let i = 0; i < applied - camera.steps; i++) {
          await page.mouse.move(cx, cy)
          await page.mouse.wheel(0, 240)
          await page.waitForTimeout(120)
        }
      } else {
        for (let i = 0; i < camera.steps - applied; i++) {
          await page.mouse.move(cx, cy)
          await page.mouse.wheel(0, -240)
          await page.waitForTimeout(120)
        }
      }
      applied = camera.steps
      await page.waitForTimeout(1500)
      const file = path.join(OUT_DIR, `${camera.name}--${variant.name}.png`)
      await page.screenshot({ path: file })
      console.log(`[compare-map-vector]   wrote ${file}`)
    }
    await page.close()
  }

  await browser.close()
  console.log(`[compare-map-vector] done — compare ${OUT_DIR}/<camera>--{tiles,vector-only,overlay}.png`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
