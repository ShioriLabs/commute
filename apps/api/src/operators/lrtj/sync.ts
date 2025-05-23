import { LRTJ_STATION_CODES, OPERATORS, REGIONS } from '@commute/constants'
import { StationRepository } from 'db/repositories/stations'
import { NewStation } from 'db/schemas/stations'
import { chunkArray } from 'utils/chunk'
import { parseHTML } from 'linkedom'
import { NewSchedule } from 'db/schemas/schedules'

export async function syncStations(d1: D1Database) {
  const response = await fetch('https://www.lrtjakarta.co.id/jadwal.html')
  if (!response.ok || response.status !== 200) {
    return []
  }

  const rawText = await response.text()
  const { document } = parseHTML(rawText)

  const stations: NewStation[] = []

  document.querySelectorAll<HTMLOptionElement>('.select-stasiun[name="stasiun_awal"] option').forEach((option) => {
    const value = option.value
    if (!value || value === '0') return

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
  })

  // Save to database
  for (const chunk of chunkArray(stations, 10)) {
    await new StationRepository(d1).insertMany(chunk)
  }

  return stations
}

async function fetchTimetable(originStationId: number, direction: 'PGDBOUND' | 'VELBOUND') {
  const times: string[] = []

  let destinationStationId = ''
  if (direction === 'PGDBOUND') destinationStationId = '6'
  if (direction === 'VELBOUND') destinationStationId = '1'

  const response = await fetch('https://www.lrtjakarta.co.id/jadwal.html', {
    body: new URLSearchParams({
      stasiun_awal: originStationId.toString(),
      stasiun_akhir: destinationStationId,
      search_jadwal: ''
    }),
    method: 'POST'
  })

  if (!response.ok || response.status !== 200) {
    return []
  }

  const rawText = await response.text()
  const { document } = parseHTML(rawText)

  document.querySelectorAll('.list-time .item-time').forEach((time) => {
    const timeText = time.textContent
    if (timeText) times.push(timeText)
  })

  return times
}

export async function syncTimetable(d1: D1Database, stationCode: string) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const stationCodeObject = Object.entries(LRTJ_STATION_CODES).find(([_, value]) => value === stationCode)
  if (!stationCodeObject) return []

  const originalStationId = Number.parseInt(stationCodeObject[0])
  const timetable: NewSchedule[] = []

  const stationId = `${OPERATORS.LRTJ.code}-${stationCode}`

  if (originalStationId < 6) {
    const times = await fetchTimetable(originalStationId, 'PGDBOUND')
    for (const time of times) {
      timetable.push({
        id: `${stationId}-${time}-PGD-BOUND`,
        boundFor: 'Pegangsaan Dua',
        estimatedDeparture: `${time}:00`,
        estimatedArrival: '00:00:00', // currently unused, TODO calculate by predefined timing
        lineCode: 'S',
        stationId: stationId,
        tripNumber: `${stationId}-${time}-PGD-BOUND`
      })
    }
  }
  if (originalStationId > 1) {
    const times = await fetchTimetable(originalStationId, 'VELBOUND')
    for (const time of times) {
      timetable.push({
        id: `${stationId}-${time}-VEL-BOUND`,
        boundFor: 'Velodrome',
        estimatedDeparture: `${time}:00`,
        estimatedArrival: '00:00:00', // currently unused, TODO calculate by predefined timing
        lineCode: 'S',
        stationId: stationId,
        tripNumber: `${stationId}-${time}-PGD-BOUND`
      })
    }
  }

  // Save to database
  await new StationRepository(d1).insertTimetable(stationId, timetable)

  return timetable
}
