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

// South → north; the walk order trip synthesis follows. BHI (northbound) and
// LBB (southbound) contribute no departures in their arriving direction, so
// each direction's walk covers 12 departure boards.
const MRTJ_STATION_ORDER = ['LBB', 'FTM', 'CPR', 'HJN', 'BLA', 'BLM', 'SSM', 'SNY', 'IST', 'BNH', 'STB', 'DKA', 'BHI']

// Matching constants for trip synthesis. Adjacent-station runtimes on the M
// line are 1.5-4 minutes and headways are >= 5, so a learned nominal hop
// runtime with a +/-75s window separates "same train, next station" from
// "next train" cleanly.
const HOP_MIN_SECONDS = 60
const HOP_MAX_SECONDS = 420
const HOP_FALLBACK_SECONDS = 180
const MATCH_TOLERANCE_SECONDS = 75

interface SynthesizedTrip {
  originIndex: number
  stops: { code: string, time: string, seconds: number }[]
}

function toSeconds(time: string): number {
  const [hour, minute, second] = time.split(':').map(unit => Number.parseInt(unit))
  return (hour ?? 0) * 3600 + (minute ?? 0) * 60 + (second ?? 0)
}

// Greedy monotone alignment of one direction's departure boards into trips.
// Walking station by station, each active trip (last departure t) matches the
// next unmatched departure within [t + R - 75s, t + R + 75s], where R is the
// median plausible hop runtime learned from the boards themselves. Departures
// matching no active trip start a new trip (a train entering service
// mid-line, e.g. the 05:00 Blok M northbound starter); active trips whose
// window passes unmatched are terminated (short-workings, e.g. the last
// northbound stabling at Blok M).
function alignTrips(boards: { code: string, times: string[] }[]): SynthesizedTrip[] {
  const trips: SynthesizedTrip[] = []
  let active: SynthesizedTrip[] = []

  for (const [stationIndex, board] of boards.entries()) {
    const stops = board.times.map(time => ({ code: board.code, time, seconds: toSeconds(time) }))

    if (stationIndex === 0) {
      for (const stop of stops) {
        const trip: SynthesizedTrip = { originIndex: stationIndex, stops: [stop] }
        trips.push(trip)
        active.push(trip)
      }
      continue
    }

    const hopCandidates: number[] = []
    for (const trip of active) {
      const lastSeconds = trip.stops[trip.stops.length - 1]!.seconds
      const hop = stops
        .map(stop => stop.seconds - lastSeconds)
        .find(diff => diff >= HOP_MIN_SECONDS && diff <= HOP_MAX_SECONDS)
      if (hop !== undefined) hopCandidates.push(hop)
    }
    const sortedHops = hopCandidates.sort((a, b) => a - b)
    const nominalHop = sortedHops[Math.floor(sortedHops.length / 2)] ?? HOP_FALLBACK_SECONDS

    const nextActive: SynthesizedTrip[] = []
    let activeIndex = 0
    for (const stop of stops) {
      while (
        activeIndex < active.length
        && stop.seconds - active[activeIndex]!.stops[active[activeIndex]!.stops.length - 1]!.seconds > nominalHop + MATCH_TOLERANCE_SECONDS
      ) {
        activeIndex++
      }
      const candidate = active[activeIndex]
      const gap = candidate ? stop.seconds - candidate.stops[candidate.stops.length - 1]!.seconds : Number.NEGATIVE_INFINITY
      if (candidate && gap >= nominalHop - MATCH_TOLERANCE_SECONDS && gap <= nominalHop + MATCH_TOLERANCE_SECONDS) {
        candidate.stops.push(stop)
        nextActive.push(candidate)
        activeIndex++
      } else {
        const trip: SynthesizedTrip = { originIndex: stationIndex, stops: [stop] }
        trips.push(trip)
        nextActive.push(trip)
      }
    }
    active = nextActive
  }

  return trips
}

/**
 * Correlates the per-station departure boards into network-wide trips and
 * numbers them KCI-style: northbound (towards Bundaran HI) even from
 * MRTJ-1000, southbound odd from MRTJ-1001, each direction ordered by origin
 * departure time (ties broken upstream-first, so the 05:00 Lebak Bulus
 * starter outranks the 05:00 Blok M one). Returned lookup is keyed
 * `${stationCode}:${direction}:${HH:MM:SS}`.
 *
 * Numbers are positional per feed snapshot: deterministic for identical feed
 * content (which keeps the 13 per-station sync calls consistent), but a feed
 * change that adds or removes early trips shifts later numbers — inherent to
 * synthesizing identity the feed doesn't carry.
 */
export function synthesizeTripNumbers(stationRows: MRTJDatumRow[]): Map<string, string> {
  const scheduleByCode = new Map<string, MRTJDatumSchedule>()
  for (const row of stationRows) {
    const entry = MRTJ_STATIONS_BY_SLUG[row.slug]
    if (entry && isStationRow(row)) {
      scheduleByCode.set(entry.code, row.object?.schedule as MRTJDatumSchedule)
    }
  }

  const boardsFor = (order: string[], field: 'weekdaysStart' | 'weekdaysEnd') => order
    .map(code => ({ code, times: parseDepartureTimes(scheduleByCode.get(code)?.[field]) }))
    .filter(board => board.times.length > 0)

  const directions = [
    { suffix: 'NORTHBOUND', firstNumber: 1000, boards: boardsFor(MRTJ_STATION_ORDER, 'weekdaysEnd') },
    { suffix: 'SOUTHBOUND', firstNumber: 1001, boards: boardsFor([...MRTJ_STATION_ORDER].reverse(), 'weekdaysStart') }
  ]

  const tripNumbers = new Map<string, string>()
  for (const direction of directions) {
    const trips = alignTrips(direction.boards)
    trips.sort((a, b) => a.stops[0]!.seconds - b.stops[0]!.seconds || a.originIndex - b.originIndex)
    for (const [tripIndex, trip] of trips.entries()) {
      const tripNumber = `MRTJ-${direction.firstNumber + tripIndex * 2}`
      for (const stop of trip.stops) {
        tripNumbers.set(`${stop.code}:${direction.suffix}:${stop.time}`, tripNumber)
      }
    }
  }

  return tripNumbers
}

// TODO: Handle day-off schedules (weekends* fields exist in the feed, but the
// schedules table has no day-type column yet)
export function buildStationTimetable(row: MRTJDatumRow, stationId: string, terminusNames: TerminusNames, tripNumbers: Map<string, string>): NewSchedule[] {
  const schedule = isStationRow(row) ? row.object?.schedule as MRTJDatumSchedule : undefined
  if (!schedule) return []

  const stationCode = MRTJ_STATIONS_BY_SLUG[row.slug]?.code
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
        tripNumber: tripNumbers.get(`${stationCode}:${direction.suffix}:${time}`) ?? `${stationId}-${time}-${direction.suffix}`,
        estimatedDeparture: time,
        estimatedArrival: time,
        boundFor: direction.boundFor,
        lineCode: 'M'
      })
    }
  }

  return timetable
}
