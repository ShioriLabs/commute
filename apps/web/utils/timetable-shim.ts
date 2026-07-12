import type {
  CompactLineGroupedTimetable,
  LegacyTimetableEntry,
  LineGroupedTimetable
} from 'models/schedules'

// The service worker serves stale-while-revalidate API responses, so right
// after a deploy the new bundle can receive a cached pre-direction-group
// payload. Wrap each legacy { boundFor, via, schedules } entry as a
// single-destination group; the UI renders those without a direction header.
export function normalizeGroupedTimetable<T extends LineGroupedTimetable | CompactLineGroupedTimetable>(
  data: T | undefined
): T | undefined {
  if (!data) return data
  return data.map(line => ({
    ...line,
    timetable: line.timetable.map((entry) => {
      if (!('boundFor' in entry)) return entry
      const legacy = entry as unknown as LegacyTimetableEntry
      return {
        key: `SYN:${legacy.boundFor}:${legacy.via ?? ''}`,
        label: [legacy.boundFor],
        platformCode: null,
        destinations: [legacy]
      }
    })
  })) as T
}
