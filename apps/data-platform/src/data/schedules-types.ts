// Compact grouped-timetable types — the subset of apps/web/models/schedules.ts
// that the departures flyout consumes. The API returns
// GET /stations/:OP/:CODE/timetable/grouped?compact=1 wrapped as {status, data}
// where data is CompactLineGroupedTimetable.

// Wire-optimized departure: [tripNumber, minuteSinceMidnight]. tripNumber is
// null for operators without trip numbers; minute is integer minutes since local
// (Asia/Jakarta) midnight, 0–1439.
export type CompactSchedule = [tripNumber: string | null, minute: number]

export interface CompactTimetableDestination {
  boundFor: string
  via: string | null
  schedules: CompactSchedule[]
}

export interface CompactTimetableDirectionGroup {
  key: string
  label: string[]
  platformCode: string | null
  destinations: CompactTimetableDestination[]
}

export interface CompactLineTimetable {
  name: string
  lineCode: string
  colorCode: string
  timetable: CompactTimetableDirectionGroup[]
}

export type CompactLineGroupedTimetable = CompactLineTimetable[]

export interface ApiEnvelope<T> {
  status: number
  data?: T
  error?: { code: string, message: string }
}
