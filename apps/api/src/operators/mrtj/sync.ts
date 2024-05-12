import { OPERATORS, REGIONS } from 'constant'
import { StationRepository } from 'db/repositories/stations'
import { NewSchedule } from 'db/schemas/schedules'
import { NewStation } from 'db/schemas/stations'

// All MRTJ data were contained in the same API
export async function sync() {
  const response = await fetch('https://jakartamrt.co.id/val/stasiuns')
  if (!response.ok || response.status !== 200) {
    return []
  }

  const json = await response.json()

  const stations: NewStation[] = []
  const timetables: Record<string, NewSchedule[]> = {}

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
      timetableSynced: 1
    }

    const stationTimetables: NewSchedule[] = []

    // Process northbound timetable
    // TODO: Handle day-off schedules
    // Get northbound only estimations, denoted by larger station id
    const northboundEstimations = station.estimasi.filter((estimation: { stasiun_nid: string }) => Number.parseInt(estimation.stasiun_nid) > Number.parseInt(station.nid))
    if (station.jadwal_hi_biasa) {
      const departureTimes: string[] = station.jadwal_hi_biasa.split(/, /g)
      for (const departureTime of departureTimes) {
        const [departHour, departMinute] = departureTime.split(':').map((unit: string) => Number.parseInt(unit))
        const departureTimeMinute = ((departHour ?? 0) * 60) + (departMinute ?? 0)
        for (const estimation of northboundEstimations) {
          const arrivalTimeMinute = departureTimeMinute + Number.parseInt(estimation.waktu)
          const arrivalHour = Math.floor(arrivalTimeMinute / 60)
          const arrivalMinute = arrivalTimeMinute % 60

          const schedule: NewSchedule = {
            id: `${OPERATORS.MRTJ.code}-${station.nid}-${departureTime}-NORTHBOUND`,
            boundFor: 'Bundaran HI',
            estimatedDeparture: `${departureTime}:00`,
            estimatedArrival: `${arrivalHour}:${arrivalMinute}:00`,
            stationId: stationId,
            tripNumber: `${station.nid}-${departureTime}-NORTHBOUND`
          }

          stationTimetables.push(schedule)
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
        const [departHour, departMinute] = departureTime.split(':').map((unit: string) => Number.parseInt(unit))
        const departureTimeMinute = ((departHour ?? 0) * 60) + (departMinute ?? 0)
        for (const estimation of southboundEstimations) {
          const arrivalTimeMinute = departureTimeMinute + Number.parseInt(estimation.waktu)
          const arrivalHour = Math.floor(arrivalTimeMinute / 60)
          const arrivalMinute = arrivalTimeMinute % 60

          const schedule: NewSchedule = {
            id: `${OPERATORS.MRTJ.code}-${station.nid}-${departureTime}-SOUTHBOUND`,
            boundFor: 'Lebak Bulus Grab',
            estimatedDeparture: `${departureTime}:00`,
            estimatedArrival: `${arrivalHour}:${arrivalMinute}:00`,
            stationId: stationId,
            tripNumber: `${station.nid}-${departureTime}-SOUTHBOUND`
          }

          stationTimetables.push(schedule)
        }
      }
    }


    stations.push(transformedStation)
    timetables[stationId] = stationTimetables
  }

  // Save to database
  await StationRepository.insertMany(stations)
  for (const [stationId, timetable] of Object.entries(timetables)) {
    await StationRepository.insertTimetable(stationId, timetable)
  }

  return stations
}
