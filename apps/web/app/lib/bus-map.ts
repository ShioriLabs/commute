/*
 * Peta Bus data: app/data/bus-map.json, generated from the TransJakarta GTFS
 * feed by `pnpm --filter api generate:bus-map` (apps/api/src/db/scripts/
 * generateBusMap.ts, which owns the rules for what gets drawn). The types here
 * mirror that generator's output; change both together.
 *
 * Kept free of any map library so the decoding and the halte index are plain,
 * testable functions, and so nothing here drags MapLibre into a bundle that
 * only wanted the data.
 */

export type BusMapLineKind = 'BRT' | 'AUI'

export interface BusMapLine {
  code: string
  name: string
  /** BRT koridor, or Angkutan Umum Integrasi (the non-BRT "NBRT" lines). */
  kind: BusMapLineKind
  /** `#RRGGBB`, the feed's route_color. */
  color: string
  /** Encoded polylines (Google, precision 5): the pieces that together draw the line once. */
  shapes: string[]
  /** Halte codes the line calls at. `TJ-${code}` is the API's station id. */
  stops: string[]
}

export interface BusMap {
  attribution: string
  lines: BusMapLine[]
  /** Halte code -> [name, lng, lat]. */
  haltes: Record<string, [string, number, number]>
  /** Rail stations, as dots for bearings: [station id, lng, lat]. */
  rail: [string, number, number][]
}

export type LngLat = [number, number]

/*
 * Google's encoded polyline format, precision 5, to [lng, lat] pairs (GeoJSON
 * order; the encoding itself stores latitude first). Same algorithm as the
 * API's utils/polyline.ts, which encodes it.
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string, precision = 5): LngLat[] {
  const factor = 10 ** precision
  const out: LngLat[] = []
  let i = 0
  let lat = 0
  let lng = 0
  while (i < encoded.length) {
    for (let k = 0; k < 2; k++) {
      let shift = 0
      let result = 0
      let b: number
      do {
        b = encoded.charCodeAt(i++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (k === 0) lat += delta
      else lng += delta
    }
    out.push([lng / factor, lat / factor])
  }
  return out
}

/** Halte code -> the codes of every line calling there, in the map's line order. */
export function linesByHalte(map: BusMap): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const line of map.lines) {
    for (const stop of line.stops) {
      const list = index.get(stop)
      if (list) list.push(line.code)
      else index.set(stop, [line.code])
    }
  }
  return index
}
