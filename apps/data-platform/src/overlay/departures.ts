// The JR-East-style PIDS departures flyout for the schedule beat. An HTML card
// anchored each frame to the projected Manggarai roundel (via the renderer's
// onFrame `project` hook — same camera matrix as the map, no drift). Shows the
// next few real departures fetched from the API; has loading / error / empty /
// ready states. Only visible while the schedule beat is active.
import type { FrameContext } from '../gl/renderer'
import type { Vec3 } from '../scene/network-scene'
import type { DepartureRow } from '../data/next-departures'
import { clamp } from './html'

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty' }
  | { kind: 'ready', rows: DepartureRow[] }

export interface DeparturesFlyout {
  setVisible(v: boolean): void
  setState(s: State): void
  update(ctx: FrameContext): void
  dispose(): void
}

const OFFSET_X = 22 // px, place the card to the upper-right of the roundel
const OFFSET_Y = -12
// Bottom keep-out. Larger than the 8px used on the other three edges because the
// copy plate butts directly against the band's lower edge on mobile.
const EDGE_GAP_Y = 20

export function createDeparturesFlyout(
  root: HTMLElement,
  anchorWorld: Vec3,
  reduceMotion: boolean
): DeparturesFlyout {
  const card = document.createElement('div')
  // Square-cut to match the page's sign plates (.sign in style.css), which take
  // their cue from this card in the first place.
  card.className
    = 'absolute left-0 top-0 w-[248px] overflow-hidden border border-line/70 '
      + 'bg-plate/95 shadow-xl shadow-black/40 backdrop-blur-sm will-change-transform'
  card.style.opacity = '0'
  card.style.transition = reduceMotion ? 'none' : 'opacity 220ms ease, transform 220ms ease'

  // A short connector line from the roundel to the card.
  const connector = document.createElement('div')
  connector.className = 'absolute left-0 top-0 h-px origin-left bg-white/25'
  connector.style.opacity = '0'

  root.appendChild(connector)
  root.appendChild(card)

  let visible = false
  let state: State = { kind: 'loading' }
  // The card starts untransformed at the overlay origin. Animating transform on
  // the very first reveal would fly it in from the top-left corner, so the first
  // positioning is applied with transitions suppressed — after that the card
  // always holds a sane last position and can ease normally.
  let placed = false

  function headerHTML(): string {
    return (
      `<div class="flex items-center gap-2 bg-plate px-3.5 py-2.5 text-white">`
      + `<span class="text-[10px] font-medium uppercase tracking-wider text-white/45">Next</span>`
      + `<span class="flex-1 truncate text-sm font-bold">Manggarai</span>`
      + `<span class="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent"></span>`
      + `</div>`
    )
  }

  function rowHTML(r: DepartureRow): string {
    const timeText = r.relative ?? r.time
    const emphasize = r.relative === 'Sekarang'
    const platform = r.platformCode
      ? `<span class="ml-2 shrink-0 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/60">${r.platformCode}</span>`
      : ''
    return (
      `<div class="flex items-center gap-2.5 px-3.5 py-2.5">`
      + `<span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background:${r.color}"></span>`
      + `<span class="min-w-0 flex-1 truncate text-[13px] font-medium text-white/85">${r.boundFor}</span>`
      + platform
      + `<span class="shrink-0 font-mono text-[12px] ${emphasize ? 'text-accent' : 'text-white/70'}">${timeText}</span>`
      + `</div>`
    )
  }

  function bodyHTML(): string {
    switch (state.kind) {
      case 'loading':
        return [0, 1, 2]
          .map(
            () =>
              `<div class="flex items-center gap-2.5 px-3.5 py-2.5">`
              + `<span class="h-2.5 w-2.5 shrink-0 rounded-full bg-white/15"></span>`
              + `<span class="h-3 flex-1 animate-pulse rounded bg-white/10"></span>`
              + `<span class="h-3 w-8 animate-pulse rounded bg-white/10"></span>`
              + `</div>`
          )
          .join('')
      case 'error':
        return `<div class="px-3.5 py-4 text-[12px] text-white/50">Gagal muat jadwal.</div>`
      case 'empty':
        return `<div class="px-3.5 py-4 text-[12px] text-white/50">Layanan berakhir.</div>`
      case 'ready':
        return `<div class="divide-y divide-line/50">${state.rows.map(rowHTML).join('')}</div>`
    }
  }

  function render(): void {
    card.innerHTML = headerHTML() + bodyHTML()
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
    // project() reports (0,0) for a point behind the camera, and returns whatever
    // the last viewProj gave before the camera has been driven at least once.
    // Showing the card on such a frame parks it in the viewport's top-left corner,
    // so require a real projected position, not just p.visible.
    const anchored = Number.isFinite(p.x) && Number.isFinite(p.y) && !(p.x === 0 && p.y === 0)
    const show = visible && p.visible && anchored && ctx.progress > 0.6
    if (!show) {
      card.style.opacity = '0'
      connector.style.opacity = '0'
      return
    }
    const x = Math.round(p.x)
    const y = Math.round(p.y)
    // Prefer the roundel's upper-right, but clamp into the frame. This card is
    // 248px wide in a 390px-wide mobile band, so on a phone it does not fit
    // beside its own anchor at any offset and has to slide rather than flip —
    // same reasoning as the fare tag. Unclamped it hung ~70px off the right edge
    // and lost its header and every time.
    const w = card.offsetWidth || 248
    const h = card.offsetHeight || 140
    const cardX = clamp(x + OFFSET_X, 8, Math.max(8, ctx.viewportW - w - 8))
    // On mobile the frame IS the map band and the copy plate begins immediately
    // under it, so a card resting on the bottom edge gets its last rows clipped
    // by the plate. Hold it clear of that edge.
    const cardY = clamp(y + OFFSET_Y, 8, Math.max(8, ctx.viewportH - h - EDGE_GAP_Y))
    const cardTransform = `translate3d(${cardX}px, ${cardY}px, 0)`
    const connectorTransform = `translate3d(${x}px, ${y}px, 0)`

    if (!placed) {
      // Jump to the anchor with transitions off, flush it, then restore them so
      // the reveal below is a fade in place rather than a slide from (0,0).
      const cardEase = card.style.transition
      card.style.transition = 'none'
      card.style.transform = cardTransform
      connector.style.transform = connectorTransform
      void card.offsetWidth // force style flush before re-arming the transition
      card.style.transition = cardEase
      placed = true
    }

    card.style.opacity = '1'
    card.style.transform = cardTransform

    // Connector: from the roundel to wherever the (possibly clamped) card landed.
    // Hidden when the card overlaps its anchor, where a stub is just noise.
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
