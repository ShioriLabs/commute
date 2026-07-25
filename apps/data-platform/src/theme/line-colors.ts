// Publishes the baked network's line colours to CSS as custom properties.
//
// Line colour is DATA, not a design choice: KAI Commuter publishes Lin Cikarang
// as #25B8EB and that hex is as much a property of the line as its station
// order. It used to be duplicated across four files — generated network.ts (the
// canonical copy), five inline `--sign-accent` values in index.html, MRT_COLOR
// in overlay/fare-tag.ts, and LOGO_COLOR in gl/renderer.ts — so a plate's left
// bar could silently disagree with the line the map was highlighting beside it.
// That's a data-integrity bug wearing a CSS costume.
//
// Emits one property per line, keyed the same way the rest of the app keys
// stations and lines (`OPERATOR-CODE`):
//
//   --line-KCI-C: #25B8EB
//   --line-MRTJ-M: #ca2a51
//
// Must run on the no-WebGL path too — the static evidence plates keep their
// coloured bars there — so main.ts calls this at module scope, outside
// bootNetworkBackground().
import { NETWORK } from '../network'

/**
 * The brand accent, mirrored from `--color-accent` in style.css. Kept here
 * because the GL side needs it as floats and cannot read a CSS custom property:
 * one constant both surfaces derive from, rather than two literals that drift.
 */
export const ACCENT_HEX = '#f55875'

/** '#f55875' -> [0.961, 0.345, 0.459], the 0..1 triple the shaders want. */
export function hexToRgbFloat(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255
  ]
}

/** `--line-<operator>-<code>` for one line, e.g. `--line-LRTJBDB-BK`. */
function lineColorVar(operator: string, code: string): string {
  return `--line-${operator}-${code}`
}

export function applyLineColors(
  target: HTMLElement = document.documentElement
): void {
  for (const line of NETWORK.lines) {
    target.style.setProperty(lineColorVar(line.operator, line.code), line.color)
  }
}
