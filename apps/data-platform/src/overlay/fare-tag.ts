// The fare tag for the tarif beat. A sibling of the PIDS departures flyout
// (overlay/departures.ts) — same square plate, same per-frame anchoring against
// the renderer's own camera matrix — but a different instrument: a price tag on
// one corridor rather than a departure board. Anchored to Bundaran HI, the
// destination end of the highlighted MRT run.
import type { FrameContext } from '../gl/renderer'
import type { Vec3 } from '../scene/network-scene'
import type { FareResult } from '../data/network-types'
import { clamp } from './html'

type State
  = | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'ready', fare: FareResult }

export interface FareTag {
  setVisible(v: boolean): void
  setState(s: State): void
  update(ctx: FrameContext): void
  dispose(): void
}

// Anchored at the corridor's midpoint, so the tag centres on the line rather
// than hanging off an endpoint. Sits just below the anchor line so it doesn't
// crowd the roundels above it.
const OFFSET_X = 18
const OFFSET_Y = 14

const MRT_COLOR = '#ca2a51'

function rupiah(n: number): string {
  return `Rp${n.toLocaleString('id-ID')}`
}

// "Lebak Bulus Bank Syariah Indonesia" -> "Lebak Bulus". Station names carry
// sponsor suffixes; the tag is narrow and the sponsor isn't the point.
function shortName(name: string): string {
  return name
    .replace(/\s+(Bank\s+\w+|BNI|BCA|Mandiri|Indomaret|Mastercard|TUKU|Astra|Bank Syariah Indonesia|Bank DKI)\b.*$/i, '')
    .trim()
}

export function createFareTag(
  root: HTMLElement,
  anchorWorld: Vec3,
  reduceMotion: boolean
): FareTag {
  const card = document.createElement('div')
  card.className
    = 'absolute left-0 top-0 w-[200px] overflow-hidden border border-line/70 '
      + 'bg-plate/95 shadow-xl shadow-black/40 backdrop-blur-sm will-change-transform'
  card.style.borderLeft = `3px solid ${MRT_COLOR}`
  card.style.opacity = '0'
  card.style.transition = reduceMotion ? 'none' : 'opacity 220ms ease, transform 220ms ease'

  const connector = document.createElement('div')
  connector.className = 'absolute left-0 top-0 h-px origin-left bg-white/25'
  connector.style.opacity = '0'

  root.appendChild(connector)
  root.appendChild(card)

  let visible = false
  let state: State = { kind: 'loading' }
  // See departures.ts: the first placement must land with transitions off, or
  // the card visibly slides in from the overlay origin at (0,0).
  let placed = false

  function bodyHTML(): string {
    if (state.kind === 'loading') {
      return (
        `<div class="px-3.5 py-3">`
        + `<div class="mb-2 h-2.5 w-24 animate-pulse rounded bg-white/10"></div>`
        + `<div class="h-7 w-28 animate-pulse rounded bg-white/15"></div>`
        + `</div>`
      )
    }
    if (state.kind === 'error') {
      return `<div class="px-3.5 py-4 text-[12px] text-white/50">Gagal muat tarif.</div>`
    }

    const f = state.fare
    const from = shortName(f.from.name)
    const to = shortName(f.to.name)

    return (
      `<div class="px-3.5 py-3">`
      + `<p class="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-white/45">`
      + `${from} <span class="text-white/30">&rarr;</span> ${to}`
      + `</p>`
      + `<p class="text-[26px] font-extrabold leading-none tracking-tight text-white">`
      + rupiah(f.totalFare)
      + `</p>`
      + `</div>`
    )
  }

  function render(): void {
    card.innerHTML = bodyHTML()
  }
  render()

  function setVisible(v: boolean): void {
    visible = v
  }

  function setState(s: State): void {
    state = s
    render()
  }

  function update(ctx: FrameContext): void {
    const p = ctx.project([anchorWorld.x, anchorWorld.y, anchorWorld.z], ctx.viewportW, ctx.viewportH)
    // project() reports (0,0) for points behind the camera and reuses a stale
    // matrix before the camera is first driven; either would park the tag in the
    // viewport corner. Require a real projected position, not just p.visible.
    const anchored = Number.isFinite(p.x) && Number.isFinite(p.y) && !(p.x === 0 && p.y === 0)
    const show = visible && p.visible && anchored && ctx.progress > 0.6
    if (!show) {
      card.style.opacity = '0'
      connector.style.opacity = '0'
      return
    }

    const x = Math.round(p.x)
    const y = Math.round(p.y)
    // Prefer sitting to the anchor's upper-right, but clamp into the viewport.
    // A plain left/right flip isn't enough: on a narrow screen the tag is wide
    // relative to the viewport, so neither side clears the edge and it has to
    // slide rather than jump.
    const w = card.offsetWidth || 200
    const h = card.offsetHeight || 64
    const cardX = clamp(x + OFFSET_X, 8, ctx.viewportW - w - 8)
    const cardY = clamp(y + OFFSET_Y, 8, ctx.viewportH - h - 8)
    const cardTransform = `translate3d(${cardX}px, ${cardY}px, 0)`
    const connectorTransform = `translate3d(${x}px, ${y}px, 0)`

    if (!placed) {
      const ease = card.style.transition
      card.style.transition = 'none'
      card.style.transform = cardTransform
      connector.style.transform = connectorTransform
      void card.offsetWidth // flush before re-arming the transition
      card.style.transition = ease
      placed = true
    }

    card.style.opacity = '1'
    card.style.transform = cardTransform

    // Reach from the roundel to wherever the (possibly clamped) card landed.
    // Hidden when the card overlaps the anchor, where a stub would just be noise.
    const reach = cardX - x
    if (reach > 6) {
      connector.style.opacity = '0.5'
      connector.style.width = `${reach}px`
      connector.style.transform = connectorTransform
    } else {
      connector.style.opacity = '0'
    }
  }

  function dispose(): void {
    card.remove()
    connector.remove()
  }

  return { setVisible, setState, update, dispose }
}
