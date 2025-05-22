import { LRTJ_STATION_CODES, OPERATORS, REGIONS } from '@commute/constants'
import { StationRepository } from 'db/repositories/stations'
import { NewStation } from 'db/schemas/stations'
import { chunkArray } from 'utils/chunk'
import { parseHTML } from 'linkedom'

export async function syncStations(d1: D1Database) {
  const response = await fetch('https://www.lrtjakarta.co.id/jadwal.html')
  if (!response.ok || response.status !== 200) {
    return []
  }

  const rawText = await response.text()
  const { document } = parseHTML(rawText)

  const stations: NewStation[] = []


  document.querySelectorAll<HTMLOptionElement>('.select-stasiun[name="stasiun_awal"] option').forEach((option => {
    const value = option.value
    if (!value || value === "0") return

    const stationCode = LRTJ_STATION_CODES[Number.parseInt(value)]
    if (!stationCode) return

    stations.push({
      id: `LRTJ-${stationCode}`,
      code: stationCode,
      name: option.textContent ?? '',
      formattedName: option.textContent?.replace('Stasiun ', '') ?? '',
      operator: OPERATORS.LRTJ.code,
      region: REGIONS.CGK.name,
      regionCode: REGIONS.CGK.code,
      timetableSynced: 0
    })
  }))

  // Save to database
  for (const chunk of chunkArray(stations, 10)) {
    await new StationRepository(d1).insertMany(chunk)
  }

  return stations
}
