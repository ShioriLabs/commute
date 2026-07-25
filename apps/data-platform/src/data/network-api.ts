// Fetches for the fare, station-detail, and API beats. Same contract as
// departures-api.ts (module-level TTL cache + in-flight dedupe + envelope
// unwrap), factored into one helper because there are now several endpoints
// rather than one.
//
// Payloads here are static reference data, so the TTL is generous — re-entering
// a beat on the same visit never refetches.
import { API_BASE_URL } from '../env'
import type { ApiEnvelope } from './schedules-types'
import type { FareResult, OperatorSummary, StationDetail, StationTransfer } from './network-types'

const TTL_MS = 5 * 60_000

const cache = new Map<string, { at: number, data: unknown }>()
const inflight = new Map<string, Promise<unknown>>()

function getJSON<T>(path: string): Promise<T> {
  const hit = cache.get(path)
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.data as T)

  const pending = inflight.get(path)
  if (pending) return pending as Promise<T>

  const url = new URL(path, API_BASE_URL).href
  const req = fetch(url, { headers: { accept: 'application/json' } })
    .then(async (res) => {
      if (!res.ok) throw new Error(`${path} HTTP ${res.status}`)
      const body = (await res.json()) as ApiEnvelope<T>
      if (body.status !== 200 || body.data === undefined) {
        throw new Error(body.error?.message ?? `${path} unavailable`)
      }
      cache.set(path, { at: Date.now(), data: body.data })
      return body.data
    })
    .finally(() => {
      inflight.delete(path)
    })

  inflight.set(path, req)
  return req
}

// The tarif beat: Blok M -> Dukuh Atas on the MRT, the corridor the map
// highlights at that beat. A short central run rather than the full line — it
// stays legible on a portrait viewport, where the whole Lebak Bulus -> Bundaran
// HI diagonal had to shrink until the plate covered most of it.
export const FARE_FROM = 'MRTJ-BLM'
export const FARE_TO = 'MRTJ-DKA'

export function fetchCorridorFare(): Promise<FareResult> {
  return getJSON<FareResult>(`/fares/${FARE_FROM}/${FARE_TO}`)
}

// The info-stasiun + API beats: Rasuna Said. Operator and code are UPPERCASE in
// the path (lowercase 404s).
export const STATION_OPERATOR = 'LRTJBDB'
export const STATION_CODE = 'RAS'

export function fetchStationDetail(): Promise<StationDetail> {
  return getJSON<StationDetail>(`/stations/${STATION_OPERATOR}/${STATION_CODE}`)
}

export function fetchStationTransfers(): Promise<StationTransfer[]> {
  return getJSON<StationTransfer[]>(
    `/stations/${STATION_OPERATOR}/${STATION_CODE}/transfers`
  )
}

// The rute beat: Pancoran -> Pasar Minggu, a real cross-operator journey the
// router solves as LRT Jabodebek -> a 600 m walk at Cikoko -> KRL Lin Bogor.
// Chosen over a longer pair (Lebak Bulus -> Bekasi also routes across operators)
// because it spans only ~7 km, so the camera can sit close enough for both legs
// and their two line colours to stay distinct.
//
// The station chain is mirrored as a highlight set in network-scene.ts; keep the
// two in step. The fetch supplies the numbers, so fares and distances can never
// drift from the API even though the geometry is baked.
export const ROUTE_FROM = 'LRTJBDB-PAN'
export const ROUTE_TO = 'KCI-PSM'

export function fetchJourney(): Promise<FareResult> {
  return getJSON<FareResult>(`/fares/${ROUTE_FROM}/${ROUTE_TO}`)
}

// The cakupan beat: every operator with its lines. Returns all five, including
// TransJakarta, which the rail-only map does not draw — the roster filters it
// out (toRailRoster in overlay/coverage-panel.ts) rather than the API.
export function fetchOperators(): Promise<OperatorSummary[]> {
  return getJSON<OperatorSummary[]>('/operators')
}
