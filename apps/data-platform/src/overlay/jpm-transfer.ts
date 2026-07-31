// The jpm beat's overlay: endpoint plates on the structure's two ends, plus the
// TRANSFER leg the API would return for crossing between them.
//
// This is the beat's argument made literal, the same way overlay/api-panel.ts is
// the api beat's. The copy claims a transfer can carry its own price and that
// the price depends on the preceding leg; the panel shows the actual leg shape
// with `fare` and `corridorLabel` on it, hanging off the structure it describes.
//
// The two plates exist because the structure, unfolded, no longer looks like the
// corridor it came from: once the dots leave the lattice, nothing on screen says
// which end is which station. They are the same code plates the topology beat
// uses (overlay/chain-labels.ts), scoped just as hard — two of them, only while
// this beat holds.
import type { FrameContext } from '../gl/renderer'
import type { Vec3 } from '../scene/network-scene'
import { highlightJSON } from './json-highlight'
import { clamp } from './html'

export interface JpmTransfer {
  setVisible(v: boolean): void
  update(ctx: FrameContext): void
  dispose(): void
}

// The leg exactly as routes/fares.ts assembles it for this corridor: a TRANSFER
// with `fare` + `corridorLabel`, which no other transfer on the network carries.
// Hard-coded rather than fetched — /fares needs a full journey to produce one
// leg, and this beat's subject is the SHAPE, not a live figure. `distanceM` and
// the label track SURCHARGED_CORRIDORS[0]; keep them in step.
const LEG = {
  type: 'TRANSFER',
  from: { id: 'KCI-SUD', name: 'Sudirman' },
  to: { id: 'LRTJBDB-DKA', name: 'Dukuh Atas' },
  distanceM: 140,
  fare: 1,
  corridorLabel: 'Transit berbayar via Peron Sudirman'
}

// The panel floats over the MIDDLE OF THE SPAN (jpmScene.span), not off one end.
//
// It hung off the gate first, and that put it at the structure's low corner
// where it had to dodge the KCI-SUD label and kept getting clamped into the
// frame edge. The midpoint is the better anchor for a leg that describes the
// whole crossing: it sits between the two endpoint plates it relates, so the
// three read as one diagram — SUD at one end, DKA at the other, the leg over
// the water between them.
//
// Horizontally centred on the anchor, since the point is that it belongs to the
// span rather than to either station — but lifted above it, because a panel
// centred on both axes covers the arm it is describing.
const SPAN_LIFT = 18

// Endpoint plates centre above their dot. Below the dot for the KCI end, whose
// anchor sits low in frame at this pose and would otherwise clip the viewport.
const LABEL_ABOVE = -20
const LABEL_BELOW = 12
// Sticky-header keep-out, same value and reasoning as chain-labels.ts.
const TOP_GUTTER = 64

// #overlay-root is z-[1] and the beat sections are z-10, so anything projected
// into the copy column paints UNDERNEATH the sign plate. The topology beat never
// hits this because its chain runs through the map's open half; the LRT end of
// this structure does not — it lands squarely behind the headline. So the plate
// is pushed clear of the copy column rather than raised above it: the z-order is
// deliberate (the map is a background, the copy is the page) and lifting one
// overlay out of it would put a floating label over the prose.
const COPY_COL_PAD = 16

const PANEL_CLASS
  = 'absolute left-0 top-0 w-[21rem] overflow-hidden border border-line '
    + 'bg-plate/95 font-mono text-[11px] leading-relaxed backdrop-blur-sm '
    + 'will-change-transform'

// Stronger than the topology beat's chain codes on purpose: those sit on a
// sparse lattice, these sit on ~4k structure dots, and at chain-labels' contrast
// they disappear into it.
const LABEL_CLASS
  = 'absolute left-0 top-0 border border-line bg-plate px-1.5 py-0.5 '
    + 'font-mono text-[10px] font-medium uppercase tracking-wider text-white/90 '
    + 'will-change-transform'

export function createJpmTransfer(
  root: HTMLElement,
  /** In-flow slot used below the md: breakpoint, as api-panel.ts does. */
  dock: HTMLElement | null,
  /** Midpoint of the span, where the leg floats. */
  spanWorld: Vec3,
  ends: { lrt: Vec3, kci: Vec3 },
  reduceMotion: boolean
): JpmTransfer {
  const card = document.createElement('div')
  card.className = PANEL_CLASS
  card.innerHTML
    = '<div class="border-b border-line/70 px-3 py-1.5 text-[10px] uppercase '
      + 'tracking-wider text-white/35">Leg dari /fares</div>'
      // `whitespace-pre-wrap` rather than a plain <pre>: corridorLabel is a long
      // string and clipping it mid-word reads as broken data, which is the exact
      // opposite of what a panel showing the response shape should say.
      + `<pre class="w-0 min-w-full whitespace-pre-wrap break-words px-3 py-2">${highlightJSON(LEG)}</pre>`
  card.style.opacity = '0'
  card.style.transition = reduceMotion ? 'none' : 'opacity 220ms ease'

  // Endpoint plates. Order matters only for the collision-free placement below:
  // the LRT end sits high in frame, the KCI end low.
  const labels = (['lrt', 'kci'] as const).map((k) => {
    const el = document.createElement('div')
    el.className = LABEL_CLASS
    el.textContent = k === 'lrt' ? 'LRTJBDB-DKA' : 'KCI-SUD'
    el.style.opacity = '0'
    el.style.transition = reduceMotion ? 'none' : 'opacity 200ms ease'
    root.appendChild(el)
    return { key: k, el }
  })

  let visible = false
  // First placement must land with transitions off, or the panel slides in from
  // the overlay origin. Same guard as the departures flyout and chain labels.
  let placed = false
  let docked = window.innerWidth < 768 && dock !== null

  // The beat's copy plate, whose box the endpoint labels and the panel must
  // dodge. Read live rather than cached: it is sticky, so it moves with scroll.
  //
  // Resolved from #jpm, NOT `dock.closest('[data-beat]')`: the dock element now
  // CARRIES data-beat="jpm" itself (the two sweep anchors have to be same-shaped
  // siblings), so closest() returns the dock and the plate is not inside it.
  // That silently returned null and disabled the dodge entirely.
  const signEl = document.querySelector<HTMLElement>('#jpm .sign')
  function signRect(): DOMRect | null {
    if (!signEl || docked) return null
    return signEl.getBoundingClientRect()
  }

  // Below md: the beat stacks full-width and there is no open column to float
  // over, so the panel becomes an ordinary block under the copy. The endpoint
  // plates stay projected either way — they label the structure itself, and the
  // structure is on screen in both layouts.
  function mount(toDock: boolean): void {
    if (toDock && dock) {
      card.className
        = 'w-full overflow-hidden border border-line bg-plate font-mono '
          + 'text-[11px] leading-relaxed'
      card.style.transform = ''
      card.style.transition = 'none'
      card.style.opacity = '1'
      dock.appendChild(card)
    } else {
      card.className = PANEL_CLASS
      card.style.transition = reduceMotion ? 'none' : 'opacity 220ms ease'
      root.appendChild(card)
      placed = false
    }
  }
  mount(docked)

  function setVisible(v: boolean): void {
    visible = v
  }

  function update(ctx: FrameContext): void {
    // Polled here rather than via a resize listener, as api-panel.ts does.
    const nowDocked = ctx.viewportW < 768 && dock !== null
    if (nowDocked !== docked) {
      docked = nowDocked
      mount(docked)
    }

    // Endpoint plates, projected in both layouts.
    for (const { key, el } of labels) {
      const w = key === 'lrt' ? ends.lrt : ends.kci
      const p = ctx.project([w.x, w.y, w.z], ctx.viewportW, ctx.viewportH)
      // project() returns (0,0) behind the camera and reuses a stale matrix
      // before the camera is driven; either parks a plate in the corner.
      const ok = Number.isFinite(p.x) && Number.isFinite(p.y) && !(p.x === 0 && p.y === 0)
      if (!visible || !p.visible || !ok || ctx.progress <= 0.6) {
        el.style.opacity = '0'
        continue
      }
      const halfW = el.offsetWidth / 2
      const h = el.offsetHeight || 18
      const dy = key === 'kci' ? LABEL_BELOW : LABEL_ABOVE
      let lx = clamp(Math.round(p.x - halfW), 4, Math.max(4, ctx.viewportW - el.offsetWidth - 4))
      const ly = clamp(Math.round(p.y) + dy, TOP_GUTTER, Math.max(TOP_GUTTER, ctx.viewportH - h - 4))
      // Push clear of the copy plate rather than let the plate swallow it (see
      // COPY_COL_PAD). Only horizontally: the structure's ends are what fix the
      // vertical, and nudging those would detach the label from its dot.
      const sign = signRect()
      if (sign && ly + h > sign.top && ly < sign.bottom && lx < sign.right) {
        lx = Math.min(
          Math.round(sign.right + COPY_COL_PAD),
          Math.max(4, ctx.viewportW - el.offsetWidth - 4)
        )
      }
      el.style.transform = `translate3d(${lx}px, ${ly}px, 0)`
      el.style.opacity = '1'
    }

    // Docked, the panel is ordinary page content: no projection.
    if (docked) return

    const p = ctx.project(
      [spanWorld.x, spanWorld.y, spanWorld.z], ctx.viewportW, ctx.viewportH
    )
    const anchored = Number.isFinite(p.x) && Number.isFinite(p.y) && !(p.x === 0 && p.y === 0)
    if (!visible || !p.visible || !anchored || ctx.progress <= 0.6) {
      card.style.opacity = '0'
      return
    }

    const w = card.offsetWidth || 336
    const h = card.offsetHeight || 200
    // Horizontally centred on the span but lifted clear ABOVE it: centring on
    // both axes buried the west arm under the panel, hiding the very span the
    // leg describes. The left clamp is the copy plate's right edge, not the
    // viewport's — the plate is opaque and would slice the JSON's first column.
    const sign = signRect()
    const leftBound = sign ? Math.round(sign.right + COPY_COL_PAD) : 8
    const cardX = clamp(
      Math.round(p.x - w / 2), leftBound, Math.max(leftBound, ctx.viewportW - w - 8)
    )
    const cardY = clamp(
      Math.round(p.y) - h - SPAN_LIFT, TOP_GUTTER, Math.max(TOP_GUTTER, ctx.viewportH - h - 8)
    )
    const t = `translate3d(${cardX}px, ${cardY}px, 0)`
    if (!placed) {
      const ease = card.style.transition
      card.style.transition = 'none'
      card.style.transform = t
      void card.offsetWidth // flush before re-arming the transition
      card.style.transition = ease
      placed = true
    }
    card.style.transform = t
    card.style.opacity = '1'
  }

  function dispose(): void {
    card.remove()
    for (const { el } of labels) el.remove()
  }

  return { setVisible, update, dispose }
}
