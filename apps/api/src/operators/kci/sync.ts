import { OPERATORS, REGIONS } from 'constant'
import { StationRepository } from 'db/repositories/stations'
import { NewStation } from 'db/schemas/stations'
import { tryGetFormattedName } from './stationNameFormatter'
import { NewSchedule } from 'db/schemas/schedules'

const STATION_REGION_LOOKUP: Record<number, typeof REGIONS[keyof typeof REGIONS]> = {
  0: REGIONS.CGK,
  2: REGIONS.BDO,
  6: REGIONS.YIA,
} as const

export async function syncStations() {
  const response = await fetch('https://api-partner.krl.co.id/krlweb/v1/krl-station')
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

export async function syncTimetable(stationCode: string) {
  const response = await fetch(`https://api-partner.krl.co.id/krlweb/v1/schedule?stationid=${stationCode}&timefrom=00:00&timeto=23:59`)
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
      id: `${OPERATORS.KCI.code}-${schedule.train_id}`,
      stationId: `${OPERATORS.KCI.code}-${stationCode}`,
      tripNumber: schedule.train_id,
      boundFor: tryGetFormattedName("NUL", schedule.dest),
      estimatedDeparture: schedule.time_est,
      estimatedArrival: schedule.dest_time,
    }

    timetable.push(transformedSchedule)
  }

  // Save to database
  return await StationRepository.insertTimetable(`${OPERATORS.KCI.code}-${stationCode}`, timetable)
}
