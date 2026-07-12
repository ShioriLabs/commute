import type { Line } from './line'

export interface Schedule {
  id: string
  stationId: string
  tripNumber: string | null
  estimatedDeparture: string
  estimatedArrival: string
  boundFor: string
  lineCode: string
  createdAt: string
  updatedAt: string
}

export interface CompactSchedule {
  id: string
  estimatedDeparture: string
}

// One boundFor bucket — a terminus row inside a direction group.
export interface TimetableDestination {
  boundFor: string
  via: string | null
  schedules: Schedule[]
}

export interface CompactTimetableDestination {
  boundFor: string
  via: string | null
  schedules: CompactSchedule[]
}

// One physical departure direction out of the station: derived label
// (station display names, join with ' / ' to render), curated platform
// overlay, and the boundFor buckets that leave that way, farthest first.
export interface TimetableDirectionGroup {
  key: string
  label: string[]
  platformCode: string | null
  destinations: TimetableDestination[]
}

export interface CompactTimetableDirectionGroup {
  key: string
  label: string[]
  platformCode: string | null
  destinations: CompactTimetableDestination[]
}

export interface LineTimetable extends Line {
  timetable: TimetableDirectionGroup[]
}

export interface CompactLineTimetable extends Line {
  timetable: CompactTimetableDirectionGroup[]
}

export type LineGroupedTimetable = LineTimetable[]
export type CompactLineGroupedTimetable = CompactLineTimetable[]

// Pre-direction-group response entry, still seen from stale service-worker
// caches; normalizeGroupedTimetable wraps it into a direction group.
export interface LegacyTimetableEntry {
  boundFor: string
  via: string | null
  schedules: Schedule[] | CompactSchedule[]
}
