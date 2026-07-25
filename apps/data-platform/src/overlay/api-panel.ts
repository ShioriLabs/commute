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
//
// This is Rasuna Said — the station this beat is actually anchored to — captured
// from the live endpoint and truncated exactly as shownFields() truncates it, so
// the offline case can't contradict the online one. It previously showed a Bogor
// record with a flattened `operator` string, which matched neither the anchor nor
// the real payload shape.
const FALLBACK = {
  status: 200,
  data: {
    id: 'LRTJBDB-RAS',
    name: 'Rasuna Said',
    code: 'RAS',
    region: 'Jabodetabek',
    operator: { code: 'LRTJBDB', name: 'LRT Jabodebek' },
    timetableSynced: 1,
    amenities: [
      { type: 'TOILET' },
      { type: 'TOILET_ACCESSIBLE' },
      { type: 'CHARGING_STATION' }
    ],
    latitude: -6.2215,
    longitude: 106.8321,
    lines: [
      { name: 'Lin Bekasi', colorCode: '#006838', lineCode: 'BK' },
      { name: 'Lin Cibubur', colorCode: '#21409A', lineCode: 'CB' }
    ]
  }
}

// TRUNCATE, don't reshape. This panel floats over the map anchored to a dot, so
// its height is the constraint: the full record runs past the beat and covers
// its own anchor. So fields are DROPPED, but every field that survives keeps the
// exact shape the API returns — `operator` stays the {code,name} object, `lines`
// stay objects with their colours, `amenities` stay typed entries. An earlier
// version flattened them (operator -> string, lines -> codes, amenities -> a
// count), which made the panel a lie: a caller copying it would build the wrong
// types. Showing a real prefix of the payload is the point of the beat.
//
// The panel shows a real response and lets it RUN OFF the bottom behind a fade,
// rather than trimming it to fit. That reads as "here is the payload, there is
// more of it" instead of "here is a small payload" — which is the honest claim,
// since the real record is longer than any panel this size could hold.
//
// So nothing is capped for height any more; only the genuinely unbounded keys
// are dropped (createdAt/updatedAt/score are noise, regionCode/searchable are
// tail scalars). Everything kept has the exact shape the API returns.
function shownFields(s: StationDetail): unknown {
  return {
    status: 200,
    data: {
      id: s.id,
      name: s.name,
      code: s.code,
      formattedName: s.formattedName,
      region: s.region,
      operator: { code: s.operator.code, name: s.operator.name },
      timetableSynced: 1,
      amenities: s.amenities.map(a => ({ type: a.type })),
      latitude: s.latitude,
      longitude: s.longitude,
      lines: s.lines.map(l => ({ name: l.name, colorCode: l.colorCode, lineCode: l.lineCode }))
    }
  }
}

// `overflow-hidden`, NOT `overflow-auto`: the payload is meant to run past the
// bottom edge and dissolve, so a scrollbar would both contradict the effect and
// invite scrolling inside a panel that is pinned to a moving map. Long lines are
// clipped at the right edge for the same reason (they used to force a horizontal
// scrollbar, which was the only chrome on the whole page).
// No BOTTOM border in either mode. A closed box under the fade re-caps the
// payload and the effect reads as "a panel with a gradient in it"; leaving the
// bottom open lets the text and the panel dissolve together.
const FLOAT_CLASS
  = 'absolute left-0 top-0 w-[320px] overflow-hidden border border-b-0 border-line/70 '
    + 'bg-plate/95 shadow-xl shadow-black/40 backdrop-blur-sm will-change-transform'

const DOCK_CLASS
  = 'w-full overflow-hidden border border-b-0 border-line bg-plate'

// How tall the payload is allowed to be before it fades out. Sized so a couple
// of lines are always mid-dissolve: a fade that starts after the last line just
// looks like a gradient border.
const FLOAT_BODY_H = 400
const DOCK_BODY_H = 340

// The fade itself. Sits over the clipped box in the panel's OWN background
// colour (--color-plate, #0a0c11) so the text dissolves into the plate instead
// of being covered by a differently-tinted veil. The float variant stops at 0.95
// to match `bg-plate/95`: running it to a solid 1 would make the bottom of a
// translucent panel read as more opaque than its top.
const FADE_CLASS = 'pointer-events-none absolute inset-x-0 bottom-0 h-28'
const FADE_FLOAT_STYLE
  = 'background:linear-gradient(180deg,rgba(10,12,17,0) 0%,rgba(10,12,17,0.7) 50%,rgba(10,12,17,0.95) 100%)'
const FADE_DOCK_STYLE
  = 'background:linear-gradient(180deg,rgba(10,12,17,0) 0%,rgba(10,12,17,0.75) 50%,rgba(10,12,17,1) 100%)'

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
  // Re-renders because the two modes use different payload heights, so the
  // markup depends on `docked` and not only the class name.
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
    render()
  }

  // The endpoint line stays OUTSIDE the clipped box: it's the panel's label, and
  // it would be the first thing lost if it scrolled with the payload.
  function endpointHTML(path: string): string {
    return `<p class="px-4 pb-3 pt-4 font-mono text-xs text-white/45">GET ${path}</p>`
  }

  /** Wraps the payload in the clipped, bottom-faded box. */
  function payloadHTML(inner: string, tall: boolean): string {
    const h = tall ? DOCK_BODY_H : FLOAT_BODY_H
    const fadeStyle = tall ? FADE_DOCK_STYLE : FADE_FLOAT_STYLE
    // `w-0 min-w-full` on the inner wrapper is what stops the un-wrapped <pre>
    // from widening its ancestors. overflow-hidden clips what you SEE, but the
    // element is still laid out at its widest line (558px inside a 390px
    // viewport), and docked in page flow that pushed the whole document into a
    // horizontal scroll. Pinning the width to the container instead makes the
    // long lines overflow the box rather than stretch it.
    return (
      `<div class="relative w-0 min-w-full overflow-hidden" style="height:${h}px">`
      + `<div class="px-4 pb-4">${inner}</div>`
      + `<div class="${FADE_CLASS}" style="${fadeStyle}"></div>`
      + `</div>`
    )
  }

  function bodyHTML(): string {
    if (state.kind === 'loading') {
      return (
        endpointHTML(`/stations/${STATION_OPERATOR}/${STATION_CODE}`)
        + payloadHTML(
          `<div class="flex flex-col gap-2">`
          + [0, 1, 2, 3, 4, 5]
            .map(i => `<div class="h-3 animate-pulse rounded bg-white/10" style="width:${90 - i * 9}%"></div>`)
            .join('')
            + `</div>`,
          docked
        )
      )
    }

    const value = state.kind === 'ready' ? shownFields(state.station) : FALLBACK
    const path = `/stations/${STATION_OPERATOR}/${STATION_CODE}`

    return (
      endpointHTML(path)
      // whitespace-pre (not pre-wrap): a wrapped JSON line reads as a different
      // payload shape. Long lines run past the right edge and clip, matching the
      // way the whole record runs past the bottom edge and fades.
      + payloadHTML(
        `<pre class="whitespace-pre font-mono text-[12px] leading-relaxed text-white/85">`
        + highlightJSON(value)
        + `</pre>`,
        docked
      )
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
