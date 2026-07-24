// The station factoid card for the info-stasiun beat. Anchored to Rasuna Said's
// roundel, it repeats none of the plate's prose — it's the raw record: operator,
// the lines through it, coordinates, transfer. Same square-plate family as the
// PIDS departures flyout and the fare tag.
import type { FrameContext } from '../gl/renderer'
import type { Vec3 } from '../scene/network-scene'
import type { StationDetail, StationTransfer } from '../data/network-types'
import { clamp, escapeHTML } from './html'

type State
  = | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'ready', station: StationDetail, transfers: StationTransfer[] }

export interface StationCard {
  setVisible(v: boolean): void
  setState(s: State): void
  update(ctx: FrameContext): void
  dispose(): void
}

const OFFSET_X = 20
const OFFSET_Y = -14

function row(label: string, value: string): string {
  return (
    `<div class="flex items-baseline justify-between gap-3 px-3 py-1.5">`
    + `<span class="shrink-0 font-mono text-[10px] uppercase tracking-wider text-white/35">${label}</span>`
    + `<span class="min-w-0 truncate text-right font-mono text-[11px] text-white/75">${value}</span>`
    + `</div>`
  )
}

// API amenity enums -> the words a commuter would use. Paid/unpaid variants
// collapse to one label: to a passenger a lift is a lift.
const AMENITY_LABELS: Record<string, string> = {
  TOILET: 'Toilet',
  TOILET_ACCESSIBLE: 'Toilet difabel',
  CHARGING_STATION: 'Charging',
  ESCALATOR_PAID: 'Eskalator',
  ESCALATOR_UNPAID: 'Eskalator',
  ELEVATOR_PAID: 'Lift',
  ELEVATOR_UNPAID: 'Lift',
  PRAYING_ROOM: 'Musala',
  PARKING: 'Parkir',
  WIFI: 'WiFi'
}

function amenityLabel(type: string): string {
  return AMENITY_LABELS[type] ?? type.replace(/_/g, ' ').toLowerCase()
}

export function createStationCard(
  root: HTMLElement,
  anchorWorld: Vec3,
  reduceMotion: boolean
): StationCard {
  const card = document.createElement('div')
  card.className
    = 'absolute left-0 top-0 w-[232px] overflow-hidden border border-line/70 '
      + 'bg-plate/95 shadow-xl shadow-black/40 backdrop-blur-sm will-change-transform'
  card.style.opacity = '0'
  card.style.transition = reduceMotion ? 'none' : 'opacity 220ms ease, transform 220ms ease'

  const connector = document.createElement('div')
  connector.className = 'absolute left-0 top-0 h-px origin-left bg-white/25'
  connector.style.opacity = '0'

  root.appendChild(connector)
  root.appendChild(card)

  let visible = false
  let state: State = { kind: 'loading' }
  let placed = false

  function bodyHTML(): string {
    if (state.kind === 'loading') {
      return (
        `<div class="px-3 py-3">`
        + [0, 1, 2].map(() => `<div class="mb-2 h-2.5 animate-pulse rounded bg-white/10"></div>`).join('')
        + `</div>`
      )
    }
    if (state.kind === 'error') {
      return `<div class="px-3 py-4 text-[12px] text-white/50">Gagal muat stasiun.</div>`
    }

    const s = state.station
    const t = state.transfers[0]
    const lines = s.lines
      .map(
        l =>
          `<span class="inline-flex items-center gap-1">`
          + `<span class="inline-block h-1.5 w-1.5 rounded-full" style="background:${l.colorCode}"></span>`
          + escapeHTML(l.lineCode)
          + `</span>`
      )
      .join('<span class="text-white/25"> · </span>')

    return (
      // Header carries the identity; the rows are the record.
      `<div class="flex items-center gap-2 bg-plate px-3 py-2 text-white">`
      + `<span class="font-mono text-[10px] uppercase tracking-wider text-white/45">${escapeHTML(s.code)}</span>`
      + `<span class="flex-1 truncate text-[13px] font-bold">${escapeHTML(s.formattedName || s.name)}</span>`
      + `</div>`
      + `<div class="divide-y divide-line/50">`
      + row('Operator', escapeHTML(s.operator.code))
      + row('Lin', lines)
      + row('Koordinat', `${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)}`)
      + (t ? row('Transfer', `${escapeHTML(t.toStation.operatorName)} · ${t.distance} m`) : '')
      + `</div>`
      + amenitiesHTML(s)
    )
  }

  // Chips rather than a row: it's a set, not a single value, and it wraps.
  function amenitiesHTML(s: StationDetail): string {
    const labels = [...new Set(s.amenities.map(a => amenityLabel(a.type)))]
    if (labels.length === 0) return ''
    return (
      `<div class="border-t border-line/50 px-3 py-2.5">`
      + `<p class="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-white/35">Fasilitas</p>`
      + `<div class="flex flex-wrap gap-1">`
      + labels
        .map(
          l =>
            `<span class="border border-line bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-white/60">`
            + escapeHTML(l)
            + `</span>`
        )
        .join('')
      + `</div>`
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
    const anchored = Number.isFinite(p.x) && Number.isFinite(p.y) && !(p.x === 0 && p.y === 0)
    const show = visible && p.visible && anchored && ctx.progress > 0.6
    if (!show) {
      card.style.opacity = '0'
      connector.style.opacity = '0'
      return
    }

    const x = Math.round(p.x)
    const y = Math.round(p.y)
    const w = card.offsetWidth || 232
    const h = card.offsetHeight || 120
    // Prefer the anchor's LEFT (the plate owns the right column at this beat),
    // then clamp into the viewport so a narrow screen can't push it off-edge.
    const cardX = clamp(x - OFFSET_X - w, 8, ctx.viewportW - w - 8)
    const cardY = clamp(y + OFFSET_Y, 8, ctx.viewportH - h - 8)
    const cardTransform = `translate3d(${cardX}px, ${cardY}px, 0)`
    const connectorTransform = `translate3d(${cardX + w}px, ${y}px, 0)`

    if (!placed) {
      const ease = card.style.transition
      card.style.transition = 'none'
      card.style.transform = cardTransform
      connector.style.transform = connectorTransform
      void card.offsetWidth
      card.style.transition = ease
      placed = true
    }

    card.style.opacity = '1'
    card.style.transform = cardTransform

    const reach = x - (cardX + w)
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
