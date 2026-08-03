import { MRTJ_STATIONS_BY_SLUG } from '@commute/constants'
import { NewSchedule } from 'db/schemas/schedules'

/*
 * Parsing helpers for the MRT Jakarta middleware "datum" feed
 * (https://beweb-dev.jakartamrt.co.id/middleware/api/datum), which replaced
 * the old jakartamrt.co.id/val/stasiuns JSON in 2026. The feed mixes station
 * rows with news/tender rows; station rows carry an object.schedule dict with
 * per-direction departure lists as "HH:MM:SS; HH:MM:SS; ..." strings.
 * "Start" fields are southbound (towards Lebak Bulus), "End" fields are
 * northbound (towards Bundaran HI); termini only carry the direction that
 * departs from them.
 */

export interface MRTJDatumSchedule {
  start?: string
  end?: string
  weekdaysStart?: string
  weekdaysEnd?: string
  weekendsStart?: string
  weekendsEnd?: string
}

export interface MRTJDatumRow {
  id: number
  name: string
  slug: string
  object?: {
    schedule?: MRTJDatumSchedule | unknown
  } | null
}

export interface TerminusNames {
  southbound: string
  northbound: string
}

export function isStationRow(row: MRTJDatumRow): boolean {
  const schedule = row.object?.schedule
  return typeof schedule === 'object' && schedule !== null && !Array.isArray(schedule)
}

// Names arrive as " Stasiun MRT Lebak Bulus Bank Syariah Indonesia" — stray
// whitespace, an optional "Stasiun (MRT)" prefix, and a sponsor suffix that we
// deliberately keep (it is the display name).
export function cleanDisplayName(raw: string): string {
  return raw
    .trim()
    .replace(/^Stasiun\s+(MRT\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseDepartureTimes(raw: string | undefined): string[] {
  if (!raw) return []

  const times: string[] = []
  for (const token of raw.split(/;\s*/)) {
    const time = token.trim()
    const match = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
    if (!match?.[1] || !match[2]) continue
    times.push(`${match[1].padStart(2, '0')}:${match[2]}:${match[3] ?? '00'}`)
  }

  return times
}

// boundFor uses the termini's sponsored display names so labels track sponsor
// changes automatically. syncStations writes these exact strings to the
// termini's formattedName, which is what resolveBoundForCode matches against —
// resync stations before timetables after a sponsor change.
export function resolveTerminusNames(stationRows: MRTJDatumRow[]): TerminusNames {
  const nameForCode = (code: string) => {
    const row = stationRows.find(row => MRTJ_STATIONS_BY_SLUG[row.slug]?.code === code)
    return row ? cleanDisplayName(row.name) : undefined
  }

  return {
    southbound: nameForCode('LBB') ?? 'Lebak Bulus',
    northbound: nameForCode('BHI') ?? 'Bundaran HI'
  }
}

// TODO: Handle day-off schedules (weekends* fields exist in the feed, but the
// schedules table has no day-type column yet)
export function buildStationTimetable(row: MRTJDatumRow, stationId: string, terminusNames: TerminusNames): NewSchedule[] {
  const schedule = isStationRow(row) ? row.object?.schedule as MRTJDatumSchedule : undefined
  if (!schedule) return []

  const timetable: NewSchedule[] = []

  const directions = [
    { times: parseDepartureTimes(schedule.weekdaysStart), suffix: 'SOUTHBOUND', boundFor: terminusNames.southbound },
    { times: parseDepartureTimes(schedule.weekdaysEnd), suffix: 'NORTHBOUND', boundFor: terminusNames.northbound }
  ]

  for (const direction of directions) {
    for (const time of direction.times) {
      timetable.push({
        id: `${stationId}-${time}-${direction.suffix}`,
        stationId,
        tripNumber: `${stationId}-${time}-${direction.suffix}`,
        estimatedDeparture: time,
        estimatedArrival: time,
        boundFor: direction.boundFor,
        lineCode: 'M'
      })
    }
  }

  return timetable
}
