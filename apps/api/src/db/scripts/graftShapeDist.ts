import * as fs from 'node:fs'

/*
 * Backfill `shape_dist_traveled` into the current GTFS feed from the previous one.
 *
 * Why this exists: the 2026-07-24 TransJakarta export ships `stop_times.txt` with
 * `shape_dist_traveled` EMPTY on all 26,427 rows. The 2026-06-29 export had it on
 * 100% of rows. That column is the only source of true along-the-route distance
 * we have — `generateEdgesSQL.ts` uses it (as `cumM`) when both ends of an
 * adjacency carry it, and falls back to straight-line haversine when they do not.
 *
 * Losing it is not cosmetic. Buses follow roads; haversine cuts through blocks.
 * Regenerating straight off the July feed moved 330 edges shorter, several by
 * more than 70% (corridor 11 Kampung Melayu: 3226m -> 883m), which would price
 * those legs far below what a rider actually travels.
 *
 * The graft is keyed on (trip_id, stop_sequence, stop_id): a distance is copied
 * only when the exact same stop sits at the exact same position of the exact same
 * trip in both feeds. A trip that was rerouted therefore matches nothing and
 * correctly keeps no distance rather than inheriting a stale one — corridors 1 and
 * 6A, the two genuinely rerouted lines, are exactly the 80 unmatched BRT rows.
 *
 * Coverage on the current pair of feeds: 97.8% of BRT-corridor rows, 91.2% overall
 * (the remainder is mostly Mikrotrans/feeder routes that have no topology anyway).
 *
 * DELETE THIS SCRIPT once an upstream export ships the column again. It is a
 * bridge over one bad feed, not a permanent part of the pipeline.
 *
 * Run before the topology/edge generators:
 *   pnpm --filter api graft:shape-dist
 */

const FEED = `${__dirname}/file_gtfs/stop_times.txt`
const PREV = `${__dirname}/file_gtfs.prev/stop_times.txt`

function splitCSV(text: string): { header: string[], rows: string[][] } {
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n')
  return {
    header: lines[0]!.split(','),
    rows: lines.slice(1).map(l => l.split(','))
  }
}

if (!fs.existsSync(PREV)) {
  console.error(`No previous feed at ${PREV} — nothing to graft from.`)
  process.exit(1)
}

const prev = splitCSV(fs.readFileSync(PREV, 'utf-8'))
const pIdx = {
  trip: prev.header.indexOf('trip_id'),
  seq: prev.header.indexOf('stop_sequence'),
  stop: prev.header.indexOf('stop_id'),
  dist: prev.header.indexOf('shape_dist_traveled')
}

const known = new Map<string, string>()
for (const r of prev.rows) {
  const d = (r[pIdx.dist] ?? '').trim()
  if (d !== '') known.set(`${r[pIdx.trip]}\t${r[pIdx.seq]}\t${r[pIdx.stop]}`, d)
}

const feed = splitCSV(fs.readFileSync(FEED, 'utf-8'))
const fIdx = {
  trip: feed.header.indexOf('trip_id'),
  seq: feed.header.indexOf('stop_sequence'),
  stop: feed.header.indexOf('stop_id'),
  dist: feed.header.indexOf('shape_dist_traveled')
}
if (Object.values(fIdx).some(i => i < 0)) throw new Error('current feed is missing an expected column')

// Already populated? Then the upstream export is fixed and this script is obsolete.
const alreadyFilled = feed.rows.filter(r => (r[fIdx.dist] ?? '').trim() !== '').length
if (alreadyFilled > 0) {
  console.log(`shape_dist_traveled already populated on ${alreadyFilled} rows — leaving the feed untouched.`)
  console.log('If upstream has fixed the column, delete this script and its package.json entry.')
  process.exit(0)
}

let grafted = 0
for (const r of feed.rows) {
  const d = known.get(`${r[fIdx.trip]}\t${r[fIdx.seq]}\t${r[fIdx.stop]}`)
  if (d !== undefined) {
    r[fIdx.dist] = d
    grafted++
  }
}

fs.writeFileSync(FEED, `${feed.header.join(',')}\n${feed.rows.map(r => r.join(',')).join('\n')}\n`)

const pct = (100 * grafted / feed.rows.length).toFixed(1)
console.log(`Grafted shape_dist_traveled onto ${grafted}/${feed.rows.length} rows (${pct}%).`)
console.log(`  ${feed.rows.length - grafted} rows left empty — rerouted or new trips, which fall back to haversine.`)
