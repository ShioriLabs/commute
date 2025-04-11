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

export interface LineTimetable {
  name: string
  lineCode: string
  colorCode: `#${string}`
  timetable: {
    boundFor: string
    schedules: Schedule[]
  }[]
}

export type LineGroupedTimetable = LineTimetable[]
