import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { Envelope } from './common'
import {
  CompactGroupedTimetableSchema,
  GroupedTimetableSchema,
  ScheduleSchema,
  StationSchema,
  TransferSchema
} from './station'
import { HubSchema } from './hub'
import { LineDetailSchema, OperatorWithLinesSchema } from './line'
import { FareResultSchema } from './fare'
import { SearchableIndexSchema } from './searchable'

/*
 * Validates these schemas against live production responses.
 *
 * This is the check that matters. Schemas written by reading a handler describe
 * what someone believed the API returns; only parsing a real response proves it.
 * Three divergences reached the published OpenAPI document before this test
 * existed — `Transfer.notes` documented as non-null when it is null in 13 of 15
 * rows, a flattened Transfer union, and a non-null `FareSegment.fare`.
 *
 * Network-gated: set LIVE=1 to run. Skipped by default so an offline machine or
 * a CI box without egress doesn't fail the suite.
 */

const BASE = 'https://api.commute.shiorilabs.id'
const live = process.env.LIVE === '1'

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`)
  expect(res.status, `${path} returned ${res.status}`).toBe(200)
  return res.json()
}

function check(path: string, schema: v.GenericSchema, payload: unknown) {
  const result = v.safeParse(Envelope(schema), payload)
  if (!result.success) {
    const detail = result.issues
      .map(issue => `  ${v.getDotPath(issue) ?? '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`${path} does not match its schema:\n${detail}`)
  }
}

const CASES: [string, v.GenericSchema][] = [
  ['/operators', v.array(OperatorWithLinesSchema)],
  ['/stations', v.array(StationSchema)],
  ['/stations/MRTJ', v.array(StationSchema)],
  ['/stations/KCI/AC', StationSchema],
  ['/stations/KCI/AC/timetable', v.array(ScheduleSchema)],
  ['/stations/KCI/AC/timetable/TP', v.array(ScheduleSchema)],
  ['/stations/KCI/AC/timetable/grouped', v.array(GroupedTimetableSchema)],
  ['/stations/KCI/AC/timetable/grouped?compact=1', v.array(CompactGroupedTimetableSchema)],
  ['/stations/KCI/SUD/transfers', v.array(TransferSchema)],
  ['/stations/MRTJ/DKA/transfers', v.array(TransferSchema)],
  ['/hubs', v.array(HubSchema)],
  ['/hubs/dukuh-atas', HubSchema],
  ['/lines/KCI/C', LineDetailSchema],
  ['/lines/LRTJBDB/BK', LineDetailSchema],
  ['/fares/KCI-AC/MRTJ-DKA', FareResultSchema],
  ['/fares/KCI-BOO/KCI-AC', FareResultSchema],
  // Interlined trunk — the one route that exercises `serviceLines`.
  ['/fares/LRTJBDB-DKA/LRTJBDB-CWG', FareResultSchema],
  ['/_internal/searchables', SearchableIndexSchema]
]

describe.skipIf(!live)('schemas match production', () => {
  it.each(CASES)('%s', async (path, schema) => {
    check(path, schema, await fetchJson(path))
  }, 30_000)
})

/*
 * Every station in one pass, rather than the handful the endpoint cases cover.
 * Nullability bugs hide in the long tail — `latitude` is null in only 17 of 393
 * rows, so a single sampled station would never reveal it.
 */
describe.skipIf(!live)('every station parses', () => {
  it('validates all rows from /stations', async () => {
    const payload = await fetchJson('/stations') as { data: unknown[] }
    const failures: string[] = []

    for (const station of payload.data) {
      const result = v.safeParse(StationSchema, station)
      if (!result.success) {
        const id = (station as { id?: string }).id ?? '(unknown)'
        failures.push(`${id}: ${result.issues.map(i => `${v.getDotPath(i)} ${i.message}`).join('; ')}`)
      }
    }

    expect(failures, `${failures.length} station(s) failed:\n${failures.slice(0, 10).join('\n')}`).toEqual([])
  }, 30_000)
})
