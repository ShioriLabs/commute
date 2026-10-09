/*
 * Google's encoded polyline format, plus the simplification run before encoding.
 *
 * Coordinates are [longitude, latitude], as in GeoJSON, which is where the
 * shapes come from. The encoding itself writes latitude first, per the format.
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */

export type LngLat = [number, number]

export function encodePolyline(coords: readonly LngLat[], precision = 5): string {
  const factor = 10 ** precision
  let out = ''
  let prevLat = 0
  let prevLng = 0
  for (const [lng, lat] of coords) {
    const iLat = Math.round(lat * factor)
    const iLng = Math.round(lng * factor)
    out += encodeSigned(iLat - prevLat) + encodeSigned(iLng - prevLng)
    prevLat = iLat
    prevLng = iLng
  }
  return out
}

function encodeSigned(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1
  let out = ''
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
    v >>= 5
  }
  return out + String.fromCharCode(v + 63)
}

export function decodePolyline(encoded: string, precision = 5): LngLat[] {
  const factor = 10 ** precision
  const out: LngLat[] = []
  let i = 0
  let lat = 0
  let lng = 0
  while (i < encoded.length) {
    const deltas: number[] = []
    for (let k = 0; k < 2; k++) {
      let shift = 0
      let result = 0
      let b: number
      do {
        b = encoded.charCodeAt(i++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20)
      deltas.push(result & 1 ? ~(result >> 1) : result >> 1)
    }
    lat += deltas[0]!
    lng += deltas[1]!
    out.push([lng / factor, lat / factor])
  }
  return out
}

/*
 * Douglas-Peucker, with the tolerance in metres on a local flat plane, which is
 * exact enough over the few kilometres between two stops. Both ends are always
 * kept.
 *
 * Not for closed rings: with first == last there is no baseline to measure
 * against, every point sits at distance 0 from it, and the ring collapses to
 * its two ends. A hop between two stops never closes on itself.
 */
export function simplify(coords: readonly LngLat[], toleranceM: number): LngLat[] {
  if (coords.length < 3) return [...coords]
  const kx = Math.cos((coords[0]![1] * Math.PI) / 180) * 111_320
  const ky = 110_574
  const xy = coords.map(([lng, lat]) => [lng * kx, lat * ky] as const)
  const keep = new Array<boolean>(coords.length).fill(false)
  keep[0] = true
  keep[coords.length - 1] = true
  const stack: [number, number][] = [[0, coords.length - 1]]
  while (stack.length > 0) {
    const [a, b] = stack.pop()!
    const [ax, ay] = xy[a]!
    const [bx, by] = xy[b]!
    const dx = bx - ax
    const dy = by - ay
    const length = Math.hypot(dx, dy)
    let worst = 0
    let worstAt = -1
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i]!
      const d = length === 0
        ? Math.hypot(px - ax, py - ay)
        : Math.abs(dy * (px - ax) - dx * (py - ay)) / length
      if (d > worst) {
        worst = d
        worstAt = i
      }
    }
    if (worst > toleranceM) {
      keep[worstAt] = true
      stack.push([a, worstAt], [worstAt, b])
    }
  }
  return coords.filter((_, i) => keep[i])
}
