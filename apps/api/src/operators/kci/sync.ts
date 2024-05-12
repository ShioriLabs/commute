import { OPERATORS, REGIONS } from 'constant'
import { StationRepository } from 'db/repositories/stations'
import { NewStation } from 'db/schemas/stations'

const STATION_REGION_LOOKUP: Record<number, typeof REGIONS[keyof typeof REGIONS]> = {
  0: REGIONS.CGK,
  2: REGIONS.BDO,
  6: REGIONS.YIA,
} as const

export async function syncStations() {
  const response = await fetch('https://api-partner.krl.co.id/krlweb/v1/krl-station')
  const json = await response.json()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stations: NewStation[] = [];

  for (const station of json.data) {
    if (station.fg_enable === 0) continue;
    const region = STATION_REGION_LOOKUP[station.group_wil as number] ?? REGIONS.NUL
    const transformedStation: NewStation = {
      id: `${OPERATORS.KCI.code}-${station.sta_id}`,
      code: station.sta_id,
      name: station.sta_name,
      region: region.name,
      regionCode: region.code,
      operator: OPERATORS.KCI.code
    }

    stations.push(transformedStation)

  }

  // Save to database
  await StationRepository.insertMany(stations)
  return stations
}
