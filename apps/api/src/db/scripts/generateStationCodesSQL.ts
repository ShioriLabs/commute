import * as fs from 'node:fs'
import { BOGUS_MEMBERSHIPS, TOPOLOGY, type Stop } from '../data/topology'

// Corrects the stationLines table: prunes schedule-derived rows that aren't real
// stops, then backfills stationNumber with the official per-line code from the
// topology. Apply with:
//   wrangler d1 execute commute --local --file=src/db/scripts/station-codes.sql
const OUTPUT_SQL_PATH = `${__dirname}/station-codes.sql`

const esc = (s: string): string => s.replace(/'/g, '\'\'')

const statements: string[] = []

for (const m of BOGUS_MEMBERSHIPS) {
  const stationId = `${m.operator}-${m.station}`
  statements.push(
    `DELETE FROM stationLines WHERE stationId = '${esc(stationId)}' AND lineCode = '${esc(m.lineCode)}';`
  )
}

for (const line of TOPOLOGY) {
  const stops: Stop[] = [...line.path, ...(line.branches ?? []).flatMap(b => b.path)]
  for (const stop of stops) {
    const stationId = `${line.operator}-${stop.station}`
    statements.push(
      `UPDATE stationLines SET stationNumber = '${esc(stop.pos)}', updatedAt = CURRENT_TIMESTAMP`
      + ` WHERE stationId = '${esc(stationId)}' AND lineCode = '${esc(line.lineCode)}';`
    )
  }
}

fs.writeFileSync(OUTPUT_SQL_PATH, statements.join('\n') + '\n')
console.log(`Wrote ${statements.length} statements (${BOGUS_MEMBERSHIPS.length} delete, rest update) to "${OUTPUT_SQL_PATH}".`)
