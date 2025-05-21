import { OPERATORS, REGIONS } from '@commute/constants'
import { StationRepository } from 'db/repositories/stations'
import { NewSchedule } from 'db/schemas/schedules'
import { NewStation } from 'db/schemas/stations'
import { chunkArray } from 'utils/chunk'

export async function syncStations(d1: D1Database) {
  const response = await fetch('https://jakartamrt.co.id/val/stasiuns')
  if (!response.ok || response.status !== 200) {
    return []
  }

  const json = await response.json<any>()

  const stations: NewStation[] = []

  for (const station of json) {
    const stationId = `${OPERATORS.MRTJ.code}-${station.nid}`
    const transformedStation: NewStation = {
      id: stationId,
      code: station.nid,
      name: station.title,
      formattedName: station.title.replace(/Stasiun/g, "").trim(),
      region: REGIONS.CGK.name,
      regionCode: REGIONS.CGK.code,
      operator: OPERATORS.MRTJ.code,
      timetableSynced: 0
    }

    stations.push(transformedStation)
  }

  // Save to database
  for (const chunk of chunkArray(stations, 10)) {
    await new StationRepository(d1).insertMany(chunk)
  }

  return stations
}

export async function syncTimetable(d1: D1Database, stationCode: string) {
  const response = await fetch('https://jakartamrt.co.id/val/stasiuns')
  if (!response.ok || response.status !== 200) {
    return []
  }

  const json = await response.json<any[]>()
  const station = json.find((station: { nid: string | number }) => station.nid.toString() === stationCode.toString())
  if (!station) return []

  const timetable: NewSchedule[] = []
  const stationId = `${OPERATORS.MRTJ.code}-${station.nid}`

  // Process northbound timetable
  // TODO: Handle day-off schedules
  // Get northbound only estimations, denoted by larger station id
  const northboundEstimations = station.estimasi.filter((estimation: { stasiun_nid: string }) => Number.parseInt(estimation.stasiun_nid) > Number.parseInt(station.nid))
  if (station.jadwal_hi_biasa) {
    const departureTimes: string[] = station.jadwal_hi_biasa.split(/, /g)
    for (const departureTime of departureTimes) {
      const [departHour, departMinute] = departureTime.trim().split(':').map((unit: string) => Number.parseInt(unit))
      const departureTimeMinute = ((departHour ?? 0) * 60) + (departMinute ?? 0)
      for (const estimation of northboundEstimations) {
        const arrivalTimeMinute = departureTimeMinute + Number.parseInt(estimation.waktu)
        const arrivalHour = Math.floor(arrivalTimeMinute / 60)
        const arrivalMinute = arrivalTimeMinute % 60

        const schedule: NewSchedule = {
          id: `${OPERATORS.MRTJ.code}-${station.nid}-${departureTime.trim()}-NORTHBOUND`,
          boundFor: 'Bundaran HI',
          estimatedDeparture: `${departureTime.trim()}:00`,
          estimatedArrival: `${arrivalHour}:${arrivalMinute}:00`,
          stationId: stationId,
          tripNumber: `${station.nid}-${departureTime}-NORTHBOUND`,
          lineCode: 'M'
        }

        timetable.push(schedule)
      }

    }
  }

  // Process southbound timetable
  // TODO: Handle day-off schedules
  // Get southbound only estimations, denoted by lower station id
  const southboundEstimations = station.estimasi.filter((estimation: { stasiun_nid: string }) => Number.parseInt(estimation.stasiun_nid) < Number.parseInt(station.nid))
  if (station.jadwal_lb_biasa) {
    const departureTimes: string[] = station.jadwal_lb_biasa.split(/, /g)
    for (const departureTime of departureTimes) {
      const [departHour, departMinute] = departureTime.trim().split(':').map((unit: string) => Number.parseInt(unit))
      const departureTimeMinute = ((departHour ?? 0) * 60) + (departMinute ?? 0)
      for (const estimation of southboundEstimations) {
        const arrivalTimeMinute = departureTimeMinute + Number.parseInt(estimation.waktu)
        const arrivalHour = Math.floor(arrivalTimeMinute / 60)
        const arrivalMinute = arrivalTimeMinute % 60

        const schedule: NewSchedule = {
          id: `${OPERATORS.MRTJ.code}-${station.nid}-${departureTime.trim()}-SOUTHBOUND`,
          boundFor: 'Lebak Bulus Grab',
          estimatedDeparture: `${departureTime.trim()}:00`,
          estimatedArrival: `${arrivalHour.toString().padStart(2, '0')}:${arrivalMinute.toString().padStart(2, '0')}:00`,
          stationId: stationId,
          tripNumber: `${station.nid}-${departureTime}-SOUTHBOUND`,
          lineCode: 'M'
        }

        timetable.push(schedule)
      }
    }
  }

  // Save to database
  await new StationRepository(d1).insertTimetable(stationId, timetable)

  return timetable
}
