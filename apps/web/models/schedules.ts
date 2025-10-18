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

export interface LineTimetable extends Line {
  timetable: {
    boundFor: string
    via: string | null
    schedules: Schedule[]
  }[]
}

export type LineGroupedTimetable = LineTimetable[]
