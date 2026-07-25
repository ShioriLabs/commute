// The operator roster for the cakupan beat. Unlike the other overlays this one
// is not anchored to a station: the subject is the whole network, so the panel
// sits in the open column and the map does the pointing by lighting one
// operator's lines at a time.
//
// RAIL ONLY, on purpose. The baked map excludes TransJakarta (see
// generateDataPlatformNetwork.ts), so the roster filters TJ out of the live
// /operators response rather than listing a row the map never lights.
import type { FrameContext } from '../gl/renderer'
import type { HighlightId } from '../scene/network-scene'
import type { OperatorSummary } from '../data/network-types'
import { escapeHTML } from './html'

type State
  = | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'ready', operators: OperatorSummary[] }

export interface CoveragePanel {
  setVisible(v: boolean): void
  setState(s: State): void
  /** Which operator the map is currently lighting, so the roster can mark it. */
  setActiveOperator(code: string): void
  update(ctx: FrameContext): void
  dispose(): void
}

const FLOAT_CLASS
  = 'absolute left-0 top-0 w-[280px] overflow-hidden border border-line/70 '
    + 'bg-plate/95 shadow-xl shadow-black/40 backdrop-blur-sm will-change-transform'
const DOCK_CLASS = 'w-full overflow-hidden border border-line bg-plate'

// The four rail operators the map actually draws, in the order the beat cycles
// them, paired with the highlight set each one lights. Keyed by operator code so
// the live roster can be sorted and filtered against exactly this list.
export const RAIL_OPERATOR_CYCLE: readonly { code: string, highlight: HighlightId }[] = [
  { code: 'KCI', highlight: 'rail-kci' },
  { code: 'MRTJ', highlight: 'rail-mrtj' },
  { code: 'LRTJ', highlight: 'rail-lrtj' },
  { code: 'LRTJBDB', highlight: 'rail-lrtjbdb' }
]

const RAIL_CODES = new Set(RAIL_OPERATOR_CYCLE.map(o => o.code))

/**
 * Drops everything the map doesn't draw and orders the rest to match the beat's
 * cycle.
 *
 * Two filters, not one. Dropping non-rail operators removes TransJakarta, but
 * the API also reports rail lines the map leaves out — KCI's 'A' (Soekarno-Hatta
 * airport) is excluded from the bake for being skip-stop and near-black on the
 * dark ground. Listing it would put a line in the roster that never lights, and
 * make the footer read "10 lin" under copy that says 9. `drawnLineCodes` comes
 * from the baked network, so the roster can only ever claim what is on screen.
 */
export function toRailRoster(
  operators: OperatorSummary[],
  drawnLineCodes: ReadonlySet<string>
): OperatorSummary[] {
  const order = new Map(RAIL_OPERATOR_CYCLE.map((o, i) => [o.code, i]))
  return operators
    .filter(o => RAIL_CODES.has(o.code))
    .map(o => ({ ...o, lines: o.lines.filter(l => drawnLineCodes.has(`${o.code}:${l.lineCode}`)) }))
    .filter(o => o.lines.length > 0)
    .sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0))
}

export function createCoveragePanel(
  root: HTMLElement,
  dock: HTMLElement | null,
  reduceMotion: boolean
): CoveragePanel {
  const card = document.createElement('div')
  card.className = FLOAT_CLASS
  card.style.opacity = '0'
  card.style.transition = reduceMotion ? 'none' : 'opacity 220ms ease, transform 220ms ease'

  let visible = false
  let state: State = { kind: 'loading' }
  let activeOperator = RAIL_OPERATOR_CYCLE[0]!.code
  let docked = window.innerWidth < 768 && dock !== null

  function mount(toDock: boolean): void {
    if (toDock && dock) {
      card.className = DOCK_CLASS
      card.style.transform = ''
      card.style.opacity = '1'
      card.style.transition = 'none'
      dock.appendChild(card)
    } else {
      card.className = FLOAT_CLASS
      card.style.opacity = '0'
      card.style.transition = reduceMotion ? 'none' : 'opacity 220ms ease, transform 220ms ease'
      root.appendChild(card)
    }
  }

  function operatorHTML(op: OperatorSummary): string {
    const active = op.code === activeOperator
    // The lit operator is stated by opacity, not by a badge: the map is already
    // saying which one it is, and a second marker would compete with it.
    const swatches = op.lines
      .map(l => `<span class="h-1.5 w-4 rounded-full" style="background:${escapeHTML(l.colorCode)}"></span>`)
      .join('')
    const count = `${op.lines.length} lin`
    return (
      `<li class="flex items-center justify-between gap-3 transition-opacity duration-300" style="opacity:${active ? '1' : '0.4'}">`
      + `<span class="min-w-0">`
      + `<span class="block truncate text-[12px] font-semibold leading-tight text-white/90">${escapeHTML(op.name)}</span>`
      + `<span class="mt-1 flex gap-1">${swatches}</span>`
      + `</span>`
      + `<span class="shrink-0 font-mono text-[10px] uppercase tracking-wider text-white/45">${count}</span>`
      + `</li>`
    )
  }

  function bodyHTML(): string {
    if (state.kind === 'loading') {
      return (
        `<div class="px-4 py-3.5">`
        + [0, 1, 2, 3]
          .map(() => `<div class="mb-3 h-6 animate-pulse rounded bg-white/10"></div>`)
          .join('')
        + `</div>`
      )
    }
    if (state.kind === 'error') {
      return `<div class="px-4 py-4 text-[12px] text-white/50">Gagal muat daftar operator.</div>`
    }

    const rows = state.operators.map(operatorHTML).join('')
    const lines = state.operators.reduce((n, o) => n + o.lines.length, 0)
    return (
      `<div class="px-4 py-3.5">`
      + `<p class="mb-3 font-mono text-[10px] uppercase tracking-wider text-white/45">Jaringan rel</p>`
      + `<ul class="flex flex-col gap-3">${rows}</ul>`
      + `<p class="mt-3.5 border-t border-line/70 pt-2.5 font-mono text-[10px] uppercase tracking-wider text-white/45">`
      + `${state.operators.length} operator &middot; ${lines} lin`
      + `</p>`
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

  function setActiveOperator(code: string): void {
    if (code === activeOperator) return
    activeOperator = code
    render()
  }

  function update(ctx: FrameContext): void {
    const nowDocked = ctx.viewportW < 768 && dock !== null
    if (nowDocked !== docked) {
      docked = nowDocked
      mount(docked)
    }
    if (docked) return

    // Not anchored to a station: the subject is the whole network. Park the
    // panel in the open right half, vertically centred, so it holds still while
    // the map cycles operators underneath it.
    //
    // 0.78 rather than dead-centre of the half: the network is pushed right at
    // this beat (to keep MRT Jakarta out from under the copy plate, see the
    // cakupan pose), so the panel hugs the edge to leave that half as clear as it
    // can while still sitting opposite the copy.
    const w = card.offsetWidth || 280
    const h = card.offsetHeight || 220
    const x = Math.round(ctx.viewportW * 0.78 - w / 2)
    const y = Math.round((ctx.viewportH - h) / 2)
    card.style.transform = `translate3d(${x}px, ${y}px, 0)`
    card.style.opacity = visible && ctx.progress > 0.5 ? '1' : '0'
  }

  function dispose(): void {
    card.remove()
  }

  return { setVisible, setState, setActiveOperator, update, dispose }
}
