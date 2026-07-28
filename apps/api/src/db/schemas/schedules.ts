import { ColumnType, Insertable, Selectable, Updateable } from 'kysely'
import type { Line } from 'models/line'

export interface ScheduleSchema {
  id: string
  stationId: string
  tripNumber: string | null
  estimatedDeparture: ColumnType<Date, string | Date, string | Date>
  estimatedArrival: ColumnType<Date, string | Date, string | Date>
  boundFor: string
  lineCode: string
  createdAt: ColumnType<Date, string | undefined, never>
  updatedAt: ColumnType<Date, string | undefined, string | undefined>
}

export type Schedule = Selectable<ScheduleSchema>
export type NewSchedule = Insertable<ScheduleSchema>
export type UpdatingSchedule = Updateable<ScheduleSchema>

// The only schedule fields the grouped-timetable path reads: lineCode/boundFor
// for bucketing, tripNumber for interlining/proxy splits, and id +
// estimatedDeparture for the compact response. Lets the grouped query project
// just these columns while still satisfying the grouping helpers.
export type GroupingSchedule = Pick<
  Schedule,
  'id' | 'lineCode' | 'boundFor' | 'estimatedDeparture' | 'tripNumber'
>

/*
 * A departure as the API returns it. The row id, stationId and timestamps stay
 * in the database: a schedule is always read through the station and line that
 * own it.
 */
export interface PublicSchedule {
  tripNumber: string | null
  estimatedDeparture: string
  boundFor: string
  lineCode: string
}

export interface ScheduleWithLineInfo extends Schedule {
  line: Line | null
}

// One boundFor bucket — a terminus row inside a direction group.
export interface TimetableDestination {
  boundFor: string
  via: string | null
  schedules: PublicSchedule[]
}

// One physical departure direction out of the station: derived label
// (station display names, UI joins with ' / '), curated platform overlay,
// and the boundFor buckets that leave that way, farthest terminus first.
export interface TimetableDirectionGroup {
  key: string
  label: string[]
  platformCode: string | null
  destinations: TimetableDestination[]
}

export interface LineTimetable {
  /** Operator-qualified line key, e.g. `KCI:C`. */
  line: string
  timetable: TimetableDirectionGroup[]
}

export type LineGroupedTimetable = LineTimetable[]

// Wire-optimized departure: [tripNumber, minuteSinceMidnight]. tripNumber is
// null for operators without trip numbers (non-KCI); minute is integer minutes
// since local (Asia/Jakarta) midnight, 0–1439.
export type CompactSchedule = [tripNumber: string | null, minute: number]

export type CompactTimetableDestination = Omit<TimetableDestination, 'schedules'> & {
  schedules: CompactSchedule[]
}

export type CompactTimetableDirectionGroup = Omit<TimetableDirectionGroup, 'destinations'> & {
  destinations: CompactTimetableDestination[]
}

export type CompactLineTimetable = Omit<LineTimetable, 'timetable'> & {
  timetable: CompactTimetableDirectionGroup[]
}

export type CompactLineGroupedTimetable = CompactLineTimetable[]
