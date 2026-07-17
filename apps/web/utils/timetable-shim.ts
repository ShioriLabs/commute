import type {
  CompactLineGroupedTimetable,
  CompactSchedule,
  LegacyTimetableEntry,
  LineGroupedTimetable
} from 'models/schedules'

// Old service-worker-cached responses encoded each compact departure as
// { id, estimatedDeparture: "HH:MM:SS" }; the current wire format is the
// [tripNumber, minute] tuple. Upgrade any stale object entry so components only
// ever handle tuples (tripNumber is unknown in the old shape -> null). Full-mode
// Schedule rows, identified by lineCode, pass through untouched.
function upgradeSchedule(schedule: unknown): unknown {
  if (Array.isArray(schedule)) return schedule
  const record = schedule as Record<string, unknown>
  if (typeof record.estimatedDeparture !== 'string' || 'lineCode' in record) return schedule
  const [hours, minutes] = record.estimatedDeparture.split(':')
  return [null, Number(hours) * 60 + Number(minutes)] satisfies CompactSchedule
}

function wrapLegacyEntry(legacy: LegacyTimetableEntry) {
  return {
    key: `SYN:${legacy.boundFor}:${legacy.via ?? ''}`,
    label: [legacy.boundFor],
    platformCode: null,
    destinations: [legacy]
  }
}

// The service worker serves stale-while-revalidate API responses, so right after
// a deploy the new bundle can receive a cached pre-direction-group payload, or
// departures in the old object shape. Wrap each legacy { boundFor, via, schedules }
// entry as a single-destination group (rendered without a direction header), and
// upgrade any old-shape departures to [tripNumber, minute] tuples.
export function normalizeGroupedTimetable<T extends LineGroupedTimetable | CompactLineGroupedTimetable>(
  data: T | undefined
): T | undefined {
  if (!data) return data
  return data.map(line => ({
    ...line,
    timetable: line.timetable.map((entry) => {
      const group = 'boundFor' in entry
        ? wrapLegacyEntry(entry as unknown as LegacyTimetableEntry)
        : entry
      return {
        ...group,
        destinations: group.destinations.map(destination => ({
          ...destination,
          schedules: destination.schedules.map(upgradeSchedule)
        }))
      }
    })
  })) as T
}
