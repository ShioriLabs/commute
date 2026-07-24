// The API beat's response panel, anchored to Rasuna Said's roundel.
//
// This is the beat's whole argument made literal: one beat earlier the same
// station appeared as a human-readable record (overlay/station-card.ts), and
// here it's the raw JSON a caller would actually receive — hanging off the same
// dot, tracking the same camera. Every other beat demonstrates the platform
// against the map; before this the code panel was the one block that merely sat
// over it, in document flow.
import type { FrameContext } from '../gl/renderer'
import type { Vec3 } from '../scene/network-scene'
import type { StationDetail } from '../data/network-types'
import { STATION_CODE, STATION_OPERATOR } from '../data/network-api'
import { highlightJSON } from './json-highlight'
import { clamp } from './html'

type State
  = | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'ready', station: StationDetail }

export interface ApiPanel {
  setVisible(v: boolean): void
  setState(s: State): void
  update(ctx: FrameContext): void
  dispose(): void
}

// Sits clear to the anchor's right so the roundel itself stays visible with the
// connector running to it; a panel parked on top of its own anchor asserts the
// link without showing it.
const OFFSET_X = 34
const OFFSET_Y = -28

// The response the panel falls back to when the fetch fails. Keeping a real
// example here (rather than an empty plate) means a failed request degrades to
// what the page showed before this panel was anchored at all.
const FALLBACK = {
  status: 200,
  data: {
    id: 'KCI-BOO',
    name: 'Bogor',
    code: 'BOO',
    region: 'Jabodetabek',
    operator: 'KCI',
    timetableSynced: 1,
    searchable: true,
    latitude: -6.5951,
    longitude: 106.7893
  }
}

// Trim hard. This panel floats over the map anchored to a dot, so its height is
// the constraint: a full record ran past the beat and covered its own anchor.
// Lines collapse to their codes (the expanded objects cost 8 lines to say what
// the station card already shows in colour), and the tail scalars go.
function shownFields(s: StationDetail): unknown {
  return {
    status: 200,
    data: {
      id: s.id,
      name: s.formattedName || s.name,
      operator: s.operator.code,
      lines: s.lines.map(l => l.lineCode),
      amenities: s.amenities.length,
      latitude: s.latitude,
      longitude: s.longitude
    }
  }
}

const FLOAT_CLASS
  = 'absolute left-0 top-0 w-[320px] overflow-x-auto border border-line/70 '
    + 'bg-plate/95 p-4 shadow-xl shadow-black/40 backdrop-blur-sm will-change-transform'

const DOCK_CLASS
  = 'w-full overflow-x-auto border border-line bg-plate p-4'

export function createApiPanel(
  root: HTMLElement,
  /** In-flow slot used below the md: breakpoint (see `docked`). */
  dock: HTMLElement | null,
  anchorWorld: Vec3,
  reduceMotion: boolean
): ApiPanel {
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
  // See station-card.ts: the first placement must land with transitions off, or
  // the panel slides in from the overlay origin on reveal.
  let placed = false
  // Below the md: breakpoint the beat stacks full-width and there is no open
  // column to anchor into: the plate is ~560px tall and the panel would sit
  // half-hidden behind it. There the panel goes back to being an ordinary block
  // in document flow, under the copy, and the anchoring is desktop-only.
  let docked = window.innerWidth < 768

  // Moves the card between the projected overlay layer and the in-flow slot.
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
      placed = false // re-place without a transition on the next visible frame
      root.appendChild(card)
    }
  }

  function endpointHTML(path: string): string {
    return `<p class="mb-3 font-mono text-xs text-white/45">GET ${path}</p>`
  }

  function bodyHTML(): string {
    if (state.kind === 'loading') {
      return (
        endpointHTML(`/stations/${STATION_OPERATOR}/${STATION_CODE}`)
        + `<div class="flex flex-col gap-2">`
        + [0, 1, 2, 3, 4, 5]
          .map(i => `<div class="h-3 animate-pulse rounded bg-white/10" style="width:${90 - i * 9}%"></div>`)
          .join('')
        + `</div>`
      )
    }

    const value = state.kind === 'ready' ? shownFields(state.station) : FALLBACK
    const path = state.kind === 'ready'
      ? `/stations/${STATION_OPERATOR}/${STATION_CODE}`
      : '/stations/KCI/BOO'

    return (
      endpointHTML(path)
      + `<pre class="font-mono text-[12px] leading-relaxed text-white/85">`
      + highlightJSON(value)
      + `</pre>`
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
    // The renderer calls this every frame, so the breakpoint is polled here
    // rather than via a separate resize listener.
    const nowDocked = ctx.viewportW < 768 && dock !== null
    if (nowDocked !== docked) {
      docked = nowDocked
      mount(docked)
    }
    // Docked, the panel is ordinary page content: always present, scrolled with
    // the copy, no projection.
    if (docked) return

    const p = ctx.project([anchorWorld.x, anchorWorld.y, anchorWorld.z], ctx.viewportW, ctx.viewportH)
    // project() reports (0,0) for points behind the camera and reuses a stale
    // matrix before the camera is first driven; either would park the panel in
    // the viewport corner.
    const anchored = Number.isFinite(p.x) && Number.isFinite(p.y) && !(p.x === 0 && p.y === 0)
    const show = visible && p.visible && anchored && ctx.progress > 0.6
    if (!show) {
      card.style.opacity = '0'
      connector.style.opacity = '0'
      return
    }

    const x = Math.round(p.x)
    const y = Math.round(p.y)
    const w = card.offsetWidth || 320
    const h = card.offsetHeight || 240
    // Prefer the anchor's RIGHT — the mirror of station-card.ts, because the
    // plate owns the left column at this beat.
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

    // Reach from the roundel to the (possibly clamped) panel edge; hidden when
    // the panel overlaps the anchor, where a stub would just be noise.
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
