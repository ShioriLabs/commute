import { OPERATORS, REGIONS } from 'constant'
import { StationRepository } from 'db/repositories/stations'
import { NewStation } from 'db/schemas/stations'
import { getLineInfoFromAPIName, tryGetFormattedName } from './formatters'
import { NewSchedule } from 'db/schemas/schedules'

const STATION_REGION_LOOKUP: Record<number, typeof REGIONS[keyof typeof REGIONS]> = {
  0: REGIONS.CGK,
  2: REGIONS.BDO,
  6: REGIONS.YIA,
} as const

export async function syncStations(token?: string) {
  const response = await fetch(
    'https://api-partner.krl.co.id/krl-webs/v1/krl-station',
    {
      headers: {
        'Authorization': `Bearer ${token || process.env.KCI_API_TOKEN}`
      }
    }
  )

  if (!response.ok) {
    return []
  }

  const json = await response.json()

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
      operator: OPERATORS.KCI.code,
    }

    stations.push(transformedStation)
  }

  // Save to database
  await StationRepository.insertMany(stations)
  return stations
}

export async function syncTimetable(stationCode: string, token?: string) {
  const response = await fetch(
    `https://api-partner.krl.co.id/krl-webs/v1/schedule?stationid=${stationCode}&timefrom=00:00&timeto=23:59`,
    {
      headers: {
        'Authorization': `Bearer ${token || process.env.KCI_API_TOKEN}`
      }
    }
  )
  if (!response.ok) {
    return []
  }

  const json = await response.json()

  if (json.status !== 200) {
    return []
  }

  const timetable: NewSchedule[] = []

  for (const schedule of json.data) {
    const transformedSchedule: NewSchedule = {
      id: `${OPERATORS.KCI.code}-${stationCode}-${schedule.train_id}`,
      stationId: `${OPERATORS.KCI.code}-${stationCode}`,
      tripNumber: schedule.train_id,
      boundFor: tryGetFormattedName(schedule.dest, schedule.dest),
      estimatedDeparture: schedule.time_est,
      estimatedArrival: schedule.dest_time,
      lineCode: getLineInfoFromAPIName(schedule.ka_name ?? "")?.lineCode ?? "NUL"
    }

    timetable.push(transformedSchedule)
  }

  // Save to database
  return await StationRepository.insertTimetable(`${OPERATORS.KCI.code}-${stationCode}`, timetable)
}
