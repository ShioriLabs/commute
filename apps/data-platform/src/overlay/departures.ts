// The JR-East-style PIDS departures flyout for the schedule beat. An HTML card
// anchored each frame to the projected Manggarai roundel (via the renderer's
// onFrame `project` hook — same camera matrix as the map, no drift). Shows the
// next few real departures fetched from the API; has loading / error / empty /
// ready states. Only visible while the schedule beat is active.
import type { FrameContext } from '../gl/renderer'
import type { Vec3 } from '../scene/network-scene'
import type { DepartureRow } from '../data/next-departures'

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

export function createDeparturesFlyout(
  root: HTMLElement,
  anchorWorld: Vec3,
  reduceMotion: boolean
): DeparturesFlyout {
  const card = document.createElement('div')
  card.className
    = 'absolute left-0 top-0 w-[248px] overflow-hidden rounded-xl border border-line/70 '
      + 'bg-[#0a0c11]/95 shadow-xl shadow-black/40 backdrop-blur-sm will-change-transform'
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

  function headerHTML(): string {
    return (
      `<div class="flex items-center gap-2 bg-[#0a0c11] px-3.5 py-2.5 text-white">`
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
      ? `<span class="ml-2 shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/60">${r.platformCode}</span>`
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
    const show = visible && p.visible && ctx.progress > 0.6
    if (!show) {
      card.style.opacity = '0'
      connector.style.opacity = '0'
      return
    }
    const x = Math.round(p.x)
    const y = Math.round(p.y)
    card.style.opacity = '1'
    card.style.transform = `translate3d(${x + OFFSET_X}px, ${y + OFFSET_Y}px, 0)`

    // Connector: from the roundel to the card's top-left corner.
    const len = Math.max(OFFSET_X, 4)
    connector.style.opacity = '0.5'
    connector.style.width = `${len}px`
    connector.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }

  function dispose(): void {
    card.remove()
    connector.remove()
  }

  return { setVisible, setState, update, dispose }
}
