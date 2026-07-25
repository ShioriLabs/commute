// JSON syntax highlighting for the page's code panels.
import { escapeHTML } from './html'

/** One flat object rendered on a single line: `{ "type": "TOILET" }`. */
function inlineObject(
  obj: Record<string, unknown>,
  punct: (s: string) => string
): string {
  const body = Object.entries(obj)
    .map(([k, v]) =>
      `<span class="text-sky-300">"${escapeHTML(k)}"</span>`
      + punct(':') + ' ' + highlightJSON(v, 0))
    .join(punct(',') + ' ')
  return punct('{') + ' ' + body + ' ' + punct('}')
}

// Syntax-colours a JSON value with the span classes the page's code panels use.
// Used by overlay/api-panel.ts, which renders this anchored to the map (and
// docked into the page below the md: breakpoint).
export function highlightJSON(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  const padIn = '  '.repeat(indent + 1)
  const punct = (s: string): string => `<span class="text-white/35">${s}</span>`

  if (value === null) return `<span class="text-amber-200">null</span>`
  if (typeof value === 'number') return `<span class="text-amber-200">${value}</span>`
  if (typeof value === 'boolean') return `<span class="text-amber-200">${value}</span>`
  if (typeof value === 'string') {
    return `<span class="text-green-300">"${escapeHTML(value)}"</span>`
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return punct('[]')
    // Short scalar arrays stay on one line. Height is scarce in the anchored
    // panel, and ["BK", "CB"] says as much across four lines as it does across
    // one.
    const scalar = value.every(v => v === null || typeof v !== 'object')
    if (scalar && value.length <= 4) {
      return punct('[') + ' '
        + value.map(v => highlightJSON(v, indent)).join(punct(',') + ' ')
        + ' ' + punct(']')
    }
    // Arrays of SMALL objects fold one-object-per-line instead of exploding each
    // across a brace pair. `amenities` and `lines` are the whole reason the
    // anchored panel ran past the viewport: seven amenities cost 3 lines each
    // fully expanded. Still exactly the shape the API returns — same keys, same
    // nesting, just not one key per row.
    const smallObjects = value.every(
      v => v !== null && typeof v === 'object' && !Array.isArray(v)
        && Object.keys(v as object).length <= 3
        && Object.values(v as object).every(x => x === null || typeof x !== 'object')
    )
    if (smallObjects) {
      const items = value
        .map(v => padIn + inlineObject(v as Record<string, unknown>, punct))
        .join(punct(',') + '\n')
      return punct('[') + '\n' + items + '\n' + pad + punct(']')
    }
    const items = value
      .map(v => padIn + highlightJSON(v, indent + 1))
      .join(punct(',') + '\n')
    return punct('[') + '\n' + items + '\n' + pad + punct(']')
  }

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return punct('{}')
  const body = entries
    .map(
      ([k, v]) =>
        padIn
        + `<span class="text-sky-300">"${escapeHTML(k)}"</span>`
        + punct(':')
        + ' '
        + highlightJSON(v, indent + 1)
    )
    .join(punct(',') + '\n')
  return punct('{') + '\n' + body + '\n' + pad + punct('}')
}

