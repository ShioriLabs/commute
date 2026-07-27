import type { CompactLineGroupedTimetable, CompactTimetableDirectionGroup } from 'models/schedules'
import { departureSortKey, parseMinute } from './schedules'

// A just-departed train is still useful information — you can see you missed it
// by a minute. Same rule LineCard's getNextSchedules applies.
const DEPARTED_GRACE_MS = 60000

export interface SavedStopRow {
  key: string
  lineCode: string
  lineName: string
  colorCode: string
  boundFor: string
  platformCode: string | null
  departure: Date
}

export interface SavedStopSummary {
  rows: SavedStopRow[]
  /** Direction groups that exist but didn't fit in `rows`. */
  truncatedCount: number
}

interface Candidate {
  boundFor: string
  departure: Date
  sortKey: number
}

/**
 * Soonest still-catchable departure out of one direction group, across all the
 * boundFor buckets that leave that way.
 *
 * Falls back to the first departure of the day when everything has gone, which
 * is what LineCard does — a card showing tomorrow's first train beats a card
 * showing nothing.
 */
function nextDepartureInGroup(group: CompactTimetableDirectionGroup, now: Date): Candidate | null {
  const cutoff = now.getTime() - DEPARTED_GRACE_MS
  let upcoming: Candidate | null = null
  let earliest: Candidate | null = null

  for (const destination of group.destinations) {
    for (const schedule of destination.schedules) {
      const departure = parseMinute(schedule[1])
      const sortKey = departureSortKey(departure, now)
      const candidate: Candidate = { boundFor: destination.boundFor, departure, sortKey }

      if (earliest === null || sortKey < earliest.sortKey) earliest = candidate
      if (sortKey < cutoff) continue
      if (upcoming === null || sortKey < upcoming.sortKey) upcoming = candidate
    }
  }

  return upcoming ?? earliest
}

/**
 * Glanceable departure rows for one saved station.
 *
 * Returns **one row per direction group**, not the N soonest departures
 * overall. Two trains going the same way three minutes apart read as a bug on a
 * two-row card; two different directions are the information someone standing
 * at the station actually needs. Groups are ranked by how soon they leave, and
 * anything past `limit` is reported as `truncatedCount` rather than dropped
 * silently — tapping the card opens the full board.
 */
export function deriveSavedStopRows(
  timetable: CompactLineGroupedTimetable | undefined,
  now: Date,
  limit = 2
): SavedStopSummary {
  if (!timetable || timetable.length === 0) return { rows: [], truncatedCount: 0 }

  const candidates: SavedStopRow[] = []
  for (const line of timetable) {
    for (const group of line.timetable) {
      const next = nextDepartureInGroup(group, now)
      if (!next) continue
      candidates.push({
        key: `${line.lineCode}:${group.key}`,
        lineCode: line.lineCode,
        lineName: line.name,
        colorCode: line.colorCode,
        boundFor: next.boundFor,
        platformCode: group.platformCode,
        departure: next.departure
      })
    }
  }

  candidates.sort((a, b) => departureSortKey(a.departure, now) - departureSortKey(b.departure, now))

  return {
    rows: candidates.slice(0, limit),
    truncatedCount: Math.max(0, candidates.length - limit)
  }
}
