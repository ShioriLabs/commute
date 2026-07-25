// The journey strip for the rute beat. Where the fare tag (overlay/fare-tag.ts)
// shows what a corridor COSTS, this shows what the router DECIDED: the ordered
// legs of Pancoran -> Pasar Minggu, the walk between them, and the totals.
//
// Dual-mode like the API panel: anchored beside the map on desktop, docked into
// the page below md: where the strip is too tall to float over the copy.
import type { FrameContext } from '../gl/renderer'
import type { Vec3 } from '../scene/network-scene'
import type { FareResult, FareLeg } from '../data/network-types'
import { clamp, escapeHTML } from './html'

type State
  = | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'ready', route: FareResult }

export interface RouteStrip {
  setVisible(v: boolean): void
  setState(s: State): void
  update(ctx: FrameContext): void
  dispose(): void
}

const FLOAT_CLASS
  = 'absolute left-0 top-0 w-[260px] overflow-hidden border border-line/70 '
    + 'bg-plate/95 shadow-xl shadow-black/40 backdrop-blur-sm will-change-transform'
const DOCK_CLASS = 'w-full overflow-hidden border border-line bg-plate'

// Anchored off the transfer itself rather than an endpoint: the interchange is
// what the beat is about, and it sits mid-route so the strip doesn't hang off
// the top or bottom of the L.
//
// Unlike the other anchored overlays, this one is CENTRED IN THE OPEN HALF
// rather than hung off its anchor.
//
// The other beats can anchor because their subject is a point (a station) that
// the pose parks mid-screen, so "beside the roundel" and "centred in the open
// column" are the same place. This beat's subject is a 12-unit L, and the pose
// frames the whole shape — which puts the interchange near the TOP of frame.
// Hanging the strip off it landed the card at y=166 while every other beat's
// overlay centres around y=500-570, and that mismatch is what reads as wrong.
//
// So: centre like coverage-panel.ts, and let the connector do the pointing.
// Inboard of the right half's outer edge. 0.85 put the strip hard against the
// viewport edge, where a narrower laptop window clips it; 0.72 keeps it clear of
// the route running down the middle of that half while staying comfortably
// inside the frame at any width the beat is read at.
const HALF_CENTRE_X = 0.72
// High in the frame. The route descends diagonally through this half and its
// Cikoko corner lands around 0.49 of viewport height, so anything centred here
// covers the very roundel the leader line points at — and the camera shift can't
// fix that, because it slides the route along its own diagonal. Sitting the strip
// above the corner is what leaves it visible.
const HALF_CENTRE_Y = 0.24
const TOP_GUTTER = 64 // sticky header; don't tuck the first rows under the nav

function rupiah(n: number): string {
  return `Rp${n.toLocaleString('id-ID')}`
}

// 7263 -> "7,3 km"; 600 -> "600 m". Metres below 1 km stay metres, because the
// 600 m walk reads as a real distance and "0,6 km" reads as a rounding artefact.
function distance(m: number): string {
  if (m < 1000) return `${m} m`
  return `${(m / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`
}

// Station names carry sponsor suffixes ("Cawang", but also "Blok M BCA"). The
// strip is narrow and the sponsor is never the point. Mirrors fare-tag.ts.
function shortName(name: string): string {
  return name
    .replace(/\s+(Bank\s+\w+|BNI|BCA|Mandiri|Indomaret|Mastercard|TUKU|Astra|Bank Syariah Indonesia|Bank DKI)\b.*$/i, '')
    .trim()
}

function rideHTML(leg: Extract<FareLeg, { type: 'RIDE' }>): string {
  const stops = leg.stationCount > 0 ? `${leg.stationCount} stasiun` : ''
  return (
    `<li class="flex gap-2.5">`
    + `<span class="mt-1 h-2 w-2 shrink-0 rounded-full" style="background:${escapeHTML(leg.lineColor)}"></span>`
    + `<span class="min-w-0">`
    + `<span class="block text-[12px] font-semibold leading-tight text-white/90">${escapeHTML(shortName(leg.from.name))} <span class="text-white/30">&rarr;</span> ${escapeHTML(shortName(leg.to.name))}</span>`
    + `<span class="block font-mono text-[10px] uppercase tracking-wider text-white/45">`
    + `${escapeHTML(leg.lineName)}${stops ? ` &middot; ${stops}` : ''}`
    + `</span>`
    + `</span>`
    + `</li>`
  )
}

// The walk. Deliberately styled as a BREAK in the list rather than another line
// item: on the map Cikoko and Cawang are diagonally adjacent cells, so the two
// rides visually touch and the highlight alone cannot show that you get off and
// walk. This row is what makes the transfer legible.
function walkHTML(leg: Extract<FareLeg, { type: 'TRANSFER' }>): string {
  const paid = typeof leg.fare === 'number' && leg.fare > 0
    ? ` &middot; ${rupiah(leg.fare)}`
    : ''
  return (
    `<li class="flex gap-2.5">`
    + `<span class="mt-1 flex h-2 w-2 shrink-0 items-center justify-center">`
    + `<span class="h-2 w-px bg-white/25"></span>`
    + `</span>`
    + `<span class="min-w-0">`
    + `<span class="block font-mono text-[10px] uppercase tracking-wider text-white/55">`
    + `Jalan kaki ${distance(leg.distanceM)}${paid}`
    + `</span>`
    + `<span class="block text-[11px] leading-tight text-white/40">${escapeHTML(shortName(leg.from.name))} ke ${escapeHTML(shortName(leg.to.name))}</span>`
    + `</span>`
    + `</li>`
  )
}

export function createRouteStrip(
  root: HTMLElement,
  dock: HTMLElement | null,
  anchorWorld: Vec3,
  reduceMotion: boolean
): RouteStrip {
  const card = document.createElement('div')
  card.className = FLOAT_CLASS
  card.style.opacity = '0'
  card.style.transition = reduceMotion ? 'none' : 'opacity 220ms ease, transform 220ms ease'

  const connector = document.createElement('div')
  connector.className = 'absolute left-0 top-0 h-px origin-left bg-white/25'
  connector.style.opacity = '0'

  root.appendChild(connector)

  let visible = false
  let state: State = { kind: 'loading' }
  // See fare-tag.ts: the first placement must land with transitions off, or the
  // strip visibly slides in from the overlay origin at (0,0).
  let placed = false
  let docked = window.innerWidth < 768 && dock !== null

  function mount(toDock: boolean): void {
    if (toDock && dock) {
      card.className = DOCK_CLASS
      card.style.transform = ''
      card.style.opacity = '1'
      card.style.transition = 'none'
      connector.style.opacity = '0'
      dock.appendChild(card)
    } else {
      card.className = FLOAT_CLASS
      card.style.opacity = '0'
      card.style.transition = reduceMotion ? 'none' : 'opacity 220ms ease, transform 220ms ease'
      placed = false
      root.appendChild(card)
    }
  }

  function bodyHTML(): string {
    if (state.kind === 'loading') {
      return (
        `<div class="px-3.5 py-3">`
        + `<div class="mb-3 h-2.5 w-28 animate-pulse rounded bg-white/10"></div>`
        + [0, 1, 2]
          .map(i => `<div class="mb-2.5 h-3 animate-pulse rounded bg-white/10" style="width:${88 - i * 14}%"></div>`)
          .join('')
        + `</div>`
      )
    }
    if (state.kind === 'error') {
      return `<div class="px-3.5 py-4 text-[12px] text-white/50">Gagal muat rute.</div>`
    }

    const r = state.route
    const legs = r.legs
      .map(leg => (leg.type === 'RIDE' ? rideHTML(leg) : walkHTML(leg)))
      .join('')

    return (
      `<div class="px-3.5 py-3">`
      + `<p class="mb-2.5 font-mono text-[10px] uppercase tracking-wider text-white/45">`
      + `${escapeHTML(shortName(r.from.name))} <span class="text-white/30">&rarr;</span> ${escapeHTML(shortName(r.to.name))}`
      + `</p>`
      + `<ul class="mb-3 flex flex-col gap-2.5">${legs}</ul>`
      + `<div class="flex items-baseline gap-2 border-t border-line/70 pt-2.5">`
      + `<span class="text-[20px] font-extrabold leading-none tracking-tight text-white">${rupiah(r.totalFare)}</span>`
      + `<span class="font-mono text-[10px] uppercase tracking-wider text-white/45">`
      + `${distance(r.totalDistanceM)} &middot; ${r.transferCount} transfer`
      + `</span>`
      + `</div>`
      + `</div>`
    )
  }

  function render(): void {
    card.innerHTML = bodyHTML()
  }
  render()
  mount(docked)

  function setVisible(v: boolean): void {
    visible = v
  }

  function setState(s: State): void {
    state = s
    render()
  }

  function update(ctx: FrameContext): void {
    const nowDocked = ctx.viewportW < 768 && dock !== null
    if (nowDocked !== docked) {
      docked = nowDocked
      mount(docked)
    }
    // Docked, the strip is ordinary page content: always present, scrolled with
    // the copy, no projection.
    if (docked) return

    const p = ctx.project([anchorWorld.x, anchorWorld.y, anchorWorld.z], ctx.viewportW, ctx.viewportH)
    // project() reports (0,0) behind the camera and reuses a stale matrix before
    // the camera is first driven; either would park the strip in the corner.
    const anchored = Number.isFinite(p.x) && Number.isFinite(p.y) && !(p.x === 0 && p.y === 0)
    const show = visible && p.visible && anchored && ctx.progress > 0.6
    if (!show) {
      card.style.opacity = '0'
      connector.style.opacity = '0'
      return
    }

    const x = Math.round(p.x)
    const y = Math.round(p.y)
    const w = card.offsetWidth || 260
    const h = card.offsetHeight || 200
    // Centred in the open half and vertically in the viewport, so the strip sits
    // where the reader's eye already is — level with the copy plate opposite it,
    // matching where every other beat's overlay lands.
    const cardX = clamp(Math.round(ctx.viewportW * HALF_CENTRE_X - w / 2), 8, ctx.viewportW - w - 8)
    const cardY = clamp(Math.round(ctx.viewportH * HALF_CENTRE_Y - h / 2), TOP_GUTTER, ctx.viewportH - h - 8)
    const cardTransform = `translate3d(${cardX}px, ${cardY}px, 0)`
    // The card no longer sits level with its anchor, so the connector has to be
    // a real leader line rather than a horizontal rule: it runs from the middle
    // of whichever vertical edge FACES the anchor, to the roundel, at whatever
    // angle that takes. Rotated about its left end (origin-left), so width = the
    // distance. Picking the near edge (rather than always the right one) is what
    // lets the strip sit on either side of its subject.
    const originX = x >= cardX + w / 2 ? cardX + w : cardX
    const originY = cardY + h / 2
    const dx = x - originX
    const dy = y - originY
    const reach = Math.hypot(dx, dy)
    const angle = Math.atan2(dy, dx)
    const connectorTransform
      = `translate3d(${originX}px, ${originY}px, 0) rotate(${angle}rad)`

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

    // Leader line from the card to the interchange roundel. Hidden only when the
    // anchor is almost touching the card, where a stub is just noise — NOT on
    // `dx > 0`, which would blank the line whenever the anchor sits to the left.
    if (reach > 12) {
      connector.style.opacity = '0.5'
      connector.style.width = `${Math.round(reach)}px`
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
