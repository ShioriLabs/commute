import { WORDMARK_CELLS, WORDMARK_SIZE } from './wordmark'

/*
 * The dot lattice, in 2D canvas.
 *
 * The homepage draws its field in WebGL because it has to: ~34,000 instances
 * plus lit line dots, stations and moving trains, all under a perspective
 * camera that orbits across seven scroll beats. Instancing and a projection
 * matrix are load-bearing there.
 *
 * None of that applies here. This page needs a flat, axis-aligned lattice — no
 * camera, no orbit, no perspective divide — so gl/camera.ts has no job, and
 * reusing the GL path would have cost ~29 KB gzipped (twgl does not tree-shake;
 * asking for six functions still costs 13.4 KB, and gl/renderer.ts imports
 * theme/line-colors.ts, which drags the entire 34 KB NETWORK constant). This
 * file is a tenth of that, and the visible result is the same two beats.
 *
 * The material is deliberately identical to scene/network-scene.ts and
 * gl/shaders.ts so both pages read as the same substance:
 *   - field colour #20242e at radius 0.11 world units (FIELD_COLOR/FIELD_RADIUS)
 *   - lit cells grown to 2.1x radius, matching `mix(1.0, 2.1, v_logo)` in
 *     FIELD_VS — the wordmark reads as the grid ILLUMINATED, not type laid over
 *     it, which is the whole idea
 *   - colour lerped toward the accent, matching `mix(u_color, u_logoColor, …)`
 *
 * Secondary benefit worth noting: headless Chromium in CI has no WebGL2 (see
 * gl/context.ts) but does have 2D canvas, so this is testable without xvfb.
 */

/*
 * Brighter than scene/network-scene.ts's FIELD_COLOR (#20242e), on purpose.
 *
 * That value is tuned for a perspective camera that brings the lattice close
 * and for a canvas the map's own lit dots and trains sit on top of. Here the
 * field is flat, fixed, and alone — at #20242e over the #0d0f14 ground it was
 * measurably painting (8,300+ pixels) and still reading as an empty page.
 * #2b3040 is the same hue, lifted until the texture is actually visible behind
 * the plates.
 */
const FIELD_COLOR = '#2b3040'
const LOGO_COLOR = [0xf5, 0x58, 0x75] as const // --color-accent
const FIELD_RGB = [0x2b, 0x30, 0x40] as const

/** Lattice pitch in CSS px, and the dot radius at that pitch. */
const CELL_PX = 15
const DOT_RADIUS = 1.4
const LOGO_RADIUS_SCALE = 2.1

/** Matches MAX_DPR in gl/renderer.ts — past 2x the dots cost more than they show. */
const MAX_DPR = 2

const REVEAL_MS = 1400

export type FieldMode = 'masthead' | 'wordmark'

export interface DotField {
  /** Begins (or resumes) the reveal animation. */
  start(): void
  /** Halts the rAF loop. Safe to call when already stopped. */
  stop(): void
  /** Paints one frame with the reveal complete, without starting a loop. */
  paintStatic(): void
  dispose(): void
}

/*
 * cubic-bezier(0.36, 0.66, 0.04, 1) — the --ease-ios-spring token, sampled.
 * Solving the bezier per dot per frame is not worth it for a decorative field;
 * this approximation carries the same overshoot-free fast-out settle.
 */
const ease = (t: number): number => 1 - Math.pow(1 - t, 3)

export function createDotField(canvas: HTMLCanvasElement, mode: FieldMode): DotField | null {
  // Can be null when canvas is disabled or under extreme memory pressure. Bail
  // the same way main.ts does when createGL returns null: the page is already
  // complete without us.
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  let raf = 0
  let startedAt = 0
  /** Last progress painted, so a resize redraws the state we were already in. */
  let progress = 0
  let width = 0
  let height = 0
  let cell = CELL_PX
  /** Cell keys the wordmark occupies -> normalised column, for the stagger. */
  let logoCells = new Map<string, number>()

  function layout(): void {
    const rect = canvas.getBoundingClientRect()
    width = rect.width
    height = rect.height
    if (width <= 0 || height <= 0) return

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)

    /*
     * The wordmark is 100 cells wide, so the lattice pitch is what decides
     * whether it fits — at the masthead's 14px it would need 1400px and crop on
     * anything narrower, and a cropped wordmark reads as a bug rather than as a
     * crop. So the footer derives its pitch from the width instead of inheriting
     * it, sized so the lockup occupies a comfortable share of the viewport with
     * clear space either side. Capped at CELL_PX so a very wide window gets more
     * field around a well-proportioned wordmark, not one stretched to the edges.
     */
    cell = CELL_PX
    if (mode === 'wordmark') {
      const usable = width * (width < 640 ? 0.92 : 0.72)
      cell = Math.min(CELL_PX, usable / WORDMARK_SIZE.cols)
    }

    logoCells = new Map()
    if (mode !== 'wordmark') return

    // Centre the lockup on the lattice, biased above the middle so it clears the
    // attribution lines resting at the bottom.
    const cols = Math.ceil(width / cell)
    const rows = Math.ceil(height / cell)
    const left = Math.round((cols - WORDMARK_SIZE.cols) / 2)
    const top = Math.round(rows / 2 - WORDMARK_SIZE.rows / 2) - 2
    for (const [c, r] of WORDMARK_CELLS) {
      // Normalised column drives the stagger, so the wordmark writes itself
      // left to right — the same idea as a_order in DOT_VS.
      logoCells.set(`${left + c},${top + r}`, c / WORDMARK_SIZE.cols)
    }
  }

  function paint(at: number): void {
    progress = at
    if (width <= 0 || height <= 0) return
    ctx!.clearRect(0, 0, width, height)

    const cols = Math.ceil(width / cell)
    const rows = Math.ceil(height / cell)
    const scale = cell / CELL_PX
    const baseRadius = DOT_RADIUS * Math.min(1, Math.max(0.55, scale))

    /*
     * The plain field, drawn in one path — one fill for the whole lattice
     * rather than a fillStyle change per dot.
     *
     * Skipped entirely in 'wordmark' mode. That canvas sits on top of the
     * page-wide masthead field, which is `fixed inset-0` and already covering
     * the footer, so painting a second lattice here stacked two grids at
     * different phase: density nearly doubled and a hard horizontal seam
     * appeared exactly where the footer section began. The footer canvas draws
     * the letters and nothing else.
     */
    if (mode === 'masthead') {
      ctx!.fillStyle = FIELD_COLOR
      ctx!.beginPath()
      for (let col = 0; col <= cols; col++) {
        for (let row = 0; row <= rows; row++) {
          if (logoCells.has(`${col},${row}`)) continue
          const x = col * cell + cell / 2
          const y = row * cell + cell / 2
          ctx!.moveTo(x + baseRadius, y)
          ctx!.arc(x, y, baseRadius, 0, Math.PI * 2)
        }
      }
      ctx!.fill()
    }

    if (!logoCells.size) return

    // Lit cells, each at its own point in the stagger. Grouped by the rounded
    // mix value so near-identical dots share a fill.
    for (const [key, order] of logoCells) {
      const parts = key.split(',')
      const col = Number(parts[0])
      const row = Number(parts[1])
      // Each dot runs its own 0..1 over the back half of the window, offset by
      // column so the reveal sweeps.
      const local = Math.min(1, Math.max(0, (at - order * 0.45) / 0.55))
      const mix = ease(local)
      if (mix <= 0) continue

      const x = col * cell + cell / 2
      const y = row * cell + cell / 2
      const radius = baseRadius * (1 + (LOGO_RADIUS_SCALE - 1) * mix)
      const r = Math.round(FIELD_RGB[0] + (LOGO_COLOR[0] - FIELD_RGB[0]) * mix)
      const g = Math.round(FIELD_RGB[1] + (LOGO_COLOR[1] - FIELD_RGB[1]) * mix)
      const b = Math.round(FIELD_RGB[2] + (LOGO_COLOR[2] - FIELD_RGB[2]) * mix)

      ctx!.fillStyle = `rgb(${r},${g},${b})`
      ctx!.beginPath()
      ctx!.arc(x, y, radius, 0, Math.PI * 2)
      ctx!.fill()
    }
  }

  function frame(now: number): void {
    if (!startedAt) startedAt = now
    const at = Math.min(1, (now - startedAt) / REVEAL_MS)
    paint(at)
    // The masthead has no lit cells and the wordmark settles — either way there
    // is nothing left to animate once progress hits 1, so the loop ends rather
    // than idling at 60fps behind a static image.
    if (at < 1 && logoCells.size) raf = requestAnimationFrame(frame)
    else raf = 0
  }

  /*
   * Repaint at whatever point the reveal had reached, so a resize mid-animation
   * does not restart it and a resize after it does not wipe the wordmark.
   *
   * The height guard matters more than it looks. The masthead canvas is
   * `fixed inset-0`, so on iOS Safari and Chrome Android every scroll-direction
   * change collapses or restores the URL bar, changes innerHeight by ~60-100px,
   * and fires resize — which without this would repaint ~6,700 dots mid-scroll
   * on exactly the devices least able to afford it.
   *
   * A height change cannot alter the masthead image: the lattice is laid out
   * from the top-left on a fixed pitch, so taller just means more rows below the
   * fold. Only 'wordmark' mode centres vertically and genuinely needs height.
   */
  const onResize = (): void => {
    const rect = canvas.getBoundingClientRect()
    const widthChanged = Math.round(rect.width) !== Math.round(width)
    if (!widthChanged && mode !== 'wordmark') return
    layout()
    paint(progress)
  }

  layout()
  window.addEventListener('resize', onResize)

  return {
    start(): void {
      if (raf) return
      layout()
      startedAt = 0
      raf = requestAnimationFrame(frame)
    },
    stop(): void {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    },
    paintStatic(): void {
      layout()
      startedAt = 1
      paint(1)
    },
    dispose(): void {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      window.removeEventListener('resize', onResize)
    }
  }
}
