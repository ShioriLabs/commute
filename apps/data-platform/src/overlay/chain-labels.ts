// Station-code labels for the topology beat's highlighted chain.
//
// Labels were deliberately removed from this page once already (the old
// overlay/labels.ts labelled every named station and buried the dense core).
// These are scoped hard to avoid that: only the 4 stations of the highlighted
// chain, only while the topology beat is active, and only station CODES — short
// enough not to overlap at the framing that beat uses.
import type { FrameContext } from '../gl/renderer'
import type { Vec3 } from '../scene/network-scene'
import { clamp } from './html'

export interface ChainLabels {
  setVisible(v: boolean): void
  update(ctx: FrameContext): void
  dispose(): void
}

export interface ChainLabelAnchor {
  /** Short code shown on the plate, e.g. "MRI". */
  code: string
  world: Vec3
}

// Centred above the roundel: the chain runs diagonally at this beat, so a plate
// sitting to the right would lean into the next station along the line.
const OFFSET_Y = -22
// Adjacent stations can project close enough that their plates collide (Sudirman
// Baru and Sudirman are ~28px apart here). Flip the second one below its dot.
const BELOW_Y = 14
const COLLIDE_PX = 46
// Sticky-header keep-out; a code plate tucked under the nav lockup is unreadable
// against the wordmark. Mirrors TOP_GUTTER in route-strip.ts.
const TOP_GUTTER = 64

export function createChainLabels(
  root: HTMLElement,
  anchors: readonly ChainLabelAnchor[],
  reduceMotion: boolean
): ChainLabels {
  const els = anchors.map((a) => {
    const el = document.createElement('div')
    el.className
      = 'absolute left-0 top-0 border border-line/70 bg-plate/90 px-1.5 py-0.5 '
        + 'font-mono text-[10px] font-medium uppercase tracking-wider text-white/75 '
        + 'backdrop-blur-sm will-change-transform'
    el.textContent = a.code
    el.style.opacity = '0'
    el.style.transition = reduceMotion ? 'none' : 'opacity 200ms ease'
    root.appendChild(el)
    return el
  })

  let visible = false
  // First placement must land with transitions off, or the plates slide in from
  // the overlay origin. Same guard as the departures flyout.
  let placed = false

  function setVisible(v: boolean): void {
    visible = v
  }

  function update(ctx: FrameContext): void {
    if (!visible) {
      for (const el of els) el.style.opacity = '0'
      return
    }

    // Screen position of the previously placed plate, to detect collisions.
    let prev: { x: number, y: number } | null = null

    anchors.forEach((a, i) => {
      const el = els[i]!
      const p = ctx.project([a.world.x, a.world.y, a.world.z], ctx.viewportW, ctx.viewportH)
      // project() returns (0,0) for points behind the camera and reuses a stale
      // matrix before the camera is first driven; either would park a plate in
      // the viewport corner.
      const anchored = Number.isFinite(p.x) && Number.isFinite(p.y) && !(p.x === 0 && p.y === 0)
      if (!p.visible || !anchored || ctx.progress <= 0.6) {
        el.style.opacity = '0'
        return
      }
      // Centre on the dot; offsetWidth is 0 until the first layout, in which
      // case the plate lands one frame later at its real width.
      const halfW = el.offsetWidth / 2
      // Drop below the dot when the plate above would land on its neighbour's.
      const near = prev !== null
        && Math.abs(p.x - prev.x) < COLLIDE_PX
        && Math.abs(p.y - prev.y) < COLLIDE_PX
      const dy = near ? BELOW_Y : OFFSET_Y
      prev = { x: p.x, y: p.y }
      // Keep the plate inside the frame. It matters on mobile, where the frame is
      // the map band: a label on a dot near the lower edge would otherwise render
      // below the band, over the copy. Clamped rather than hidden — the code is
      // the point of this beat, and a station whose label vanished would read as
      // missing data.
      const h = el.offsetHeight || 18
      const lx = clamp(Math.round(p.x - halfW), 4, Math.max(4, ctx.viewportW - el.offsetWidth - 4))
      // TOP_GUTTER, not 4: the sticky header's lockup owns the top-left corner, and
      // a code plate tucked under it is unreadable against the wordmark. Same
      // reasoning and same value as route-strip.ts.
      const ly = clamp(Math.round(p.y) + dy, TOP_GUTTER, Math.max(TOP_GUTTER, ctx.viewportH - h - 4))
      const t = `translate3d(${lx}px, ${ly}px, 0)`
      if (!placed) {
        const ease = el.style.transition
        el.style.transition = 'none'
        el.style.transform = t
        void el.offsetWidth
        el.style.transition = ease
      }
      el.style.transform = t
      el.style.opacity = '1'
    })
    if (!placed) placed = true
  }

  function dispose(): void {
    for (const el of els) el.remove()
  }

  return { setVisible, update, dispose }
}
