// Fetches Manggarai's grouped daily timetable (the compact wire format) from the
// Commute API. Lazily invoked when the schedule beat enters view; result is
// cached in-memory for a short TTL so re-entering the beat doesn't refetch. The
// payload is the FULL static daily timetable — "next N" is computed client-side
// against Jakarta time, so there's no per-request freshness concern.
import { API_BASE_URL } from '../env'
import type { ApiEnvelope, CompactLineGroupedTimetable } from './schedules-types'

// Manggarai. Operator + station codes are UPPERCASE in the path.
const OPERATOR = 'KCI'
const STATION = 'MRI'
const TTL_MS = 60_000

let cache: { at: number, data: CompactLineGroupedTimetable } | null = null
let inflight: Promise<CompactLineGroupedTimetable> | null = null

export function fetchManggaraiDepartures(): Promise<CompactLineGroupedTimetable> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return Promise.resolve(cache.data)
  }
  if (inflight) return inflight

  const url = new URL(
    `/stations/${OPERATOR}/${STATION}/timetable/grouped?compact=1`,
    API_BASE_URL
  ).href

  inflight = fetch(url, { headers: { accept: 'application/json' } })
    .then(async (res) => {
      if (!res.ok) throw new Error(`departures HTTP ${res.status}`)
      const body = (await res.json()) as ApiEnvelope<CompactLineGroupedTimetable>
      if (body.status !== 200 || !body.data) {
        throw new Error(body.error?.message ?? 'departures unavailable')
      }
      cache = { at: Date.now(), data: body.data }
      return body.data
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}
