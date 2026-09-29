import zlib from 'node:zlib'

/*
 * SSE framing and relay payload decoding. Pure, so it is tested without a
 * network.
 *
 * The upstream relay sends `data: {"type":"connected"}`
 * on join, then `data: {"type":"vehicles-gz","data":"<base64 gzip>"}` every
 * ~30s, where the gzip holds `{ vehicles: [...] }`.
 */

/** Splits a text stream into SSE event payloads (the joined `data:` lines). */
export function createFrameParser(): (chunk: string) => string[] {
  let buffer = ''
  return (chunk) => {
    buffer += chunk
    const payloads: string[] = []
    let match: RegExpExecArray | null
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      const data = frame
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /, ''))
        .join('\n')
      if (data) payloads.push(data)
    }
    return payloads
  }
}

/** One TJ vehicle as the relay emits it. */
export interface RelayVehicle {
  source?: string
  latitude: number
  longitude: number
  route_code: string
  bus_body_no: string
  next_stops: string
  heading: number
  /** The RELAY's receipt time, not TJ's GPS time. */
  last_update_at: number
}

/**
 * The stored vehicle tuple: [body, route, next, lat, lon, heading, updMs].
 * Unchanged from the headway spike so its data and analysis stay compatible.
 */
export type VehicleTuple = [string, string, string, number, number, number, number]

export type RelayEvent =
  | { kind: 'connected' }
  | { kind: 'vehicles', vehicles: RelayVehicle[], raw: string }
  | { kind: 'other', type: string }

export function decodeEvent(payload: string): RelayEvent {
  const parsed = JSON.parse(payload) as { type?: string, data?: unknown }
  if (parsed.type === 'connected') return { kind: 'connected' }
  if (parsed.type === 'vehicles-gz' && typeof parsed.data === 'string') {
    const body = JSON.parse(zlib.gunzipSync(Buffer.from(parsed.data, 'base64')).toString('utf8'))
    if (!Array.isArray(body?.vehicles)) throw new Error('vehicles-gz event without vehicles[]')
    return { kind: 'vehicles', vehicles: body.vehicles, raw: parsed.data }
  }
  return { kind: 'other', type: String(parsed.type) }
}

/** TJ vehicles only (the relay's /sse/transjakarta is TJ-only today, but cheap to guard). */
export function toTuples(vehicles: RelayVehicle[]): VehicleTuple[] {
  const out: VehicleTuple[] = []
  for (const v of vehicles) {
    if (v.source !== undefined && v.source !== 'transjakarta') continue
    out.push([v.bus_body_no, v.route_code, v.next_stops, v.latitude, v.longitude, v.heading, v.last_update_at])
  }
  return out
}
