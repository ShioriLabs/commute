import { OPERATORS, REGIONS } from '@commute/constants'
import { StationRepository } from 'db/repositories/stations'
import { DAY_MASK_ALL } from 'db/schemas/schedules'
import { NewStation } from 'db/schemas/stations'
import { getLineInfoFromAPIName, toFeedStationCode, tryGetFormattedName } from './formatters'
import { NewSchedule } from 'db/schemas/schedules'
import { chunkArray } from 'utils/chunk'

const STATION_REGION_LOOKUP: Record<number, typeof REGIONS[keyof typeof REGIONS]> = {
  0: REGIONS.CGK,
  2: REGIONS.BDO,
  6: REGIONS.YIA
} as const

export async function syncStations(d1: D1Database, token?: string) {
  const response = await fetch(
    'https://kci.id/api/krl/stations',
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  )

  if (!response.ok) {
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = await response.json<any>()

  if (json.status !== 200) {
    return []
  }

  const stations: NewStation[] = []

  for (const station of json.data) {
    if (station.fg_enable === 0) continue
    const region = STATION_REGION_LOOKUP[station.group_wil as number] ?? REGIONS.NUL
    const transformedStation: NewStation = {
      id: `${OPERATORS.KCI.code}-${station.sta_id}`,
      code: station.sta_id,
      name: station.sta_name,
      formattedName: tryGetFormattedName(station.sta_id, station.sta_name),
      region: region.name,
      regionCode: region.code,
      operator: OPERATORS.KCI.code
    }

    stations.push(transformedStation)
  }

  // Save to database
  for (const chunk of chunkArray(stations, 10)) {
    await new StationRepository(d1).insertMany(chunk)
  }

  return stations
}

/*
 * One station's board from a KCI schedules response, or null when the response
 * is not a success.
 *
 * Split from the fetch so a saved response converts exactly as a live one does.
 * kci.id now blocks non-browser clients on its schedule paths, so a board can
 * arrive as a dump taken in a real browser (see generateTimetableFromDumpSQL)
 * as well as from /sync, and both must produce the same rows.
 *
 * `stationCode` is OURS, not the feed's: every id written stays on it so a KCI
 * rename never reaches the database. See FEED_STATION_CODES.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toTimetableRows(stationCode: string, json: any): NewSchedule[] | null {
  if (json?.status !== 200 || !Array.isArray(json.data)) return null

  const timetable: NewSchedule[] = []

  for (const schedule of json.data) {
    // The feed occasionally prefixes dest with a literal "undefined "
    // (seen on R-line Parung Panjang workings).
    const dest = String(schedule.dest ?? '').replace(/^undefined\s+/i, '')
    timetable.push({
      id: `${OPERATORS.KCI.code}-${stationCode}-${schedule.train_id}`,
      stationId: `${OPERATORS.KCI.code}-${stationCode}`,
      tripNumber: schedule.train_id,
      boundFor: tryGetFormattedName(dest, dest),
      estimatedDeparture: schedule.time_est,
      estimatedArrival: schedule.dest_time,
      lineCode: getLineInfoFromAPIName(schedule.ka_name ?? '')?.lineCode ?? 'NUL'
    })
  }

  return timetable
}

export async function syncTimetable(d1: D1Database, stationCode: string, token?: string) {
  // Ask the feed for ITS code; toTimetableRows stores against OURS.
  const feedStationCode = toFeedStationCode(stationCode)
  const response = await fetch(
    `https://kci.id/api/krl/schedules?stationid=${feedStationCode}&timefrom=00:00&timeto=23:59`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  )
  if (!response.ok) {
    return []
  }

  const timetable = toTimetableRows(stationCode, await response.json())
  if (!timetable) return []

  /*
   * Every day: the KCI feed carries no day dimension at all — it answers for
   * whichever day it is asked — so this board is the only one we hold and it is
   * what we know. Whether Commuter Line runs a distinct weekend timetable is an
   * open question that needs a GAPEKA check, not an assumption made here.
   */
  return await new StationRepository(d1)
    .insertTimetable(`${OPERATORS.KCI.code}-${stationCode}`, timetable, DAY_MASK_ALL)
}
