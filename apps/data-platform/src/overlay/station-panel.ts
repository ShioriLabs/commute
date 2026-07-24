// Fills the info-stasiun plate and the API beat's code panel from the live
// Rasuna Said response. Both are plain DOM inside the page (not projected
// overlays), so this is markup population rather than anchoring.
//
// Everything degrades to what's already in index.html: on a failed fetch the
// static fallback JSON and the hand-written datum stay as-is.
import type { StationDetail } from '../data/network-types'
import { STATION_CODE, STATION_OPERATOR } from '../data/network-api'

function escapeHTML(s: string): string {
  return s.replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c
  ))
}

// The plate is prose plus its eyebrow datum; every itemised fact lives on the
// roundel-anchored factoid card (overlay/station-card.ts). The datum counts raw
// amenity records because the API beat below prints that same figure — the page
// must not state two numbers for one thing.
export function renderStationFacts(station: StationDetail): void {
  const datum = document.querySelector<HTMLElement>('[data-station-datum]')
  if (datum) {
    datum.textContent
      = `${station.amenities.length} Fasilitas · ${station.lines.length} Lin`
  }
}

// Syntax-colours a JSON value with the same span classes the static fallback
// uses, so the live panel is visually identical to the hand-written one.
function highlightJSON(value: unknown, indent = 0): string {
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

export function renderApiPanel(station: StationDetail): void {
  const endpoint = document.querySelector<HTMLElement>('[data-api-endpoint]')
  const pre = document.querySelector<HTMLElement>('[data-api-response]')
  if (endpoint) {
    endpoint.textContent = `GET /stations/${STATION_OPERATOR}/${STATION_CODE}`
  }
  if (!pre) return

  // Trim to what fits the panel without scrolling past the plate: identity,
  // the lines that make this station interesting, and a couple of scalars.
  const shown = {
    status: 200,
    data: {
      id: station.id,
      name: station.formattedName || station.name,
      code: station.code,
      region: station.region,
      operator: station.operator.code,
      lines: station.lines.map(l => ({ lineCode: l.lineCode, name: l.name, colorCode: l.colorCode })),
      amenities: station.amenities.length,
      latitude: station.latitude,
      longitude: station.longitude,
      searchable: station.searchable
    }
  }
  pre.innerHTML = highlightJSON(shown)
}
