/*
 * Compact grouped-timetable types, re-exported from @commute/schemas.
 *
 * These used to be hand-copied here, and they drifted: the copy still described
 * a line as `{ name, lineCode, colorCode }` long after the API switched to a
 * single `line` key, so the departures flyout was reading fields that no longer
 * existed and rendering `undefined`. Re-exporting means the next reshape breaks
 * the build here instead of the page.
 *
 * The API returns GET /stations/:OP/:CODE/timetable/grouped?compact=1 wrapped as
 * {status, data}, where data is CompactLineGroupedTimetable.
 */

export type {
  CompactSchedule,
  CompactTimetableDestination,
  CompactTimetableDirectionGroup,
  CompactLineTimetable,
  CompactLineGroupedTimetable,
  StandardResponse as APIEnvelope
} from '@commute/schemas'
