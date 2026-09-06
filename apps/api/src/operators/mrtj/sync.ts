import { MRTJ_STATIONS_BY_SLUG, OPERATORS, REGIONS } from '@commute/constants'
import { StationRepository } from 'db/repositories/stations'
import { DAY_MASK, DAY_MASK_WEEKEND } from 'db/schemas/schedules'
import { NewStation } from 'db/schemas/stations'
import { MRTJDatumRow, buildStationTimetable, cleanDisplayName, isStationRow, resolveTerminusNames, synthesizeTripNumbers } from 'operators/mrtj/datum'
import { chunkArray } from 'utils/chunk'

// NOTE: dev-looking host, but it is what the production jakartamrt.co.id
// bundle calls (the old /val/stasiuns endpoint now serves an SPA shell).
// Expect URL rotation, same maintenance model as the KCI feed. limit=100
// covers the ~24 datum rows today; add paging if meta.pagination.total ever
// exceeds it.
const DATUM_URL = 'https://beweb-dev.jakartamrt.co.id/middleware/api/datum?pagination[limit]=100'

async function fetchStationRows(): Promise<MRTJDatumRow[] | null> {
  const response = await fetch(DATUM_URL)
  if (!response.ok) {
    return null
  }

  const json = await response.json<{ data: MRTJDatumRow[] }>()
  return json.data.filter(isStationRow)
}

export async function syncStations(d1: D1Database) {
  const rows = await fetchStationRows()
  if (!rows) return []

  const stations: NewStation[] = []

  for (const row of rows) {
    // Unknown slugs are skipped rather than inserted: the datum feed mixes
    // stations with other CMS content, and slugs move on re-sponsoring, so a
    // fallback would fabricate station rows. Update MRTJ_STATIONS_BY_SLUG
    // when a station drops out of a resync.
    const entry = MRTJ_STATIONS_BY_SLUG[row.slug]
    if (!entry) continue

    stations.push({
      id: `${OPERATORS.MRTJ.code}-${entry.code}`,
      code: entry.code,
      name: `Stasiun ${entry.name}`,
      formattedName: cleanDisplayName(row.name),
      region: REGIONS.CGK.name,
      regionCode: REGIONS.CGK.code,
      operator: OPERATORS.MRTJ.code,
      timetableSynced: 0
    })
  }

  // Save to database
  for (const chunk of chunkArray(stations, 10)) {
    await new StationRepository(d1).insertMany(chunk)
  }

  return stations
}

export async function syncTimetable(d1: D1Database, stationCode: string) {
  const rows = await fetchStationRows()
  if (!rows) return []

  const row = rows.find(row => MRTJ_STATIONS_BY_SLUG[row.slug]?.code === stationCode)
  if (!row) return []

  const stationId = `${OPERATORS.MRTJ.code}-${stationCode}`
  const terminusNames = resolveTerminusNames(rows)

  /*
   * Both boards, loaded independently.
   *
   * Two calls rather than one because each owns its own rows: the weekday load
   * clears only weekday rows and the weekend load only weekend ones, so a feed
   * that drops one board leaves the other standing rather than wiping it.
   *
   * Trip numbering runs per day type and restarts within each, which is what
   * keeps weekday numbers identical to what they were before the weekend board
   * existed.
   */
  const weekdays = await new StationRepository(d1).insertTimetable(
    stationId,
    buildStationTimetable(row, stationId, terminusNames, synthesizeTripNumbers(rows, 'WEEKDAYS'), 'WEEKDAYS'),
    DAY_MASK.WD
  )
  await new StationRepository(d1).insertTimetable(
    stationId,
    buildStationTimetable(row, stationId, terminusNames, synthesizeTripNumbers(rows, 'WEEKENDS'), 'WEEKENDS'),
    DAY_MASK_WEEKEND
  )

  return weekdays
}
