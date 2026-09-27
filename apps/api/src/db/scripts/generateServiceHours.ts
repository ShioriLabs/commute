import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import { windowFromDepartures, type ServiceWindow } from '@commute/tsundere'
import { TOPOLOGY } from '../data/topology'
import { DAY_NAMES, dayBits, type DayName } from './generateHeadways'

/*
 * Service-hours generator: WHEN a line runs, as opposed to how often.
 *
 * Companion to generateHeadways.ts, and deliberately its twin in shape — same
 * feed, same D1 shell-out, same generated-module output. The two answer
 * different halves of one question: a headway says a rider waits ~8 minutes for
 * a 9C, a service window says there is no point waiting at all at 03:00.
 *
 * The router reads this to stop planning trips onto corridors that are shut.
 * The documented case is Lippo Kuningan to JKT48 Theater at 03:05, which today
 * returns 13E + 9C — both of which stop at 22:00 — where the honest answer is
 * Koridor 1, one of the fourteen AMARI corridors that genuinely run all night.
 *
 * Two sources, matching how each half of the network records service:
 *
 *   TJ   — GTFS `frequencies.txt` `start_time`/`end_time`. Explicit and already
 *          correct; nothing is derived, the spans are simply imported.
 *   Rail — inferred from the `schedules` table, as the complement of the
 *          largest gap between consecutive departures. See windowFromDepartures
 *          in @commute/tsundere for why neither MIN/MAX nor percentiles work.
 *
 * Re-run: pnpm --filter api generate:service-hours
 */

const FEED_DIR = `${__dirname}/file_gtfs`
const OUT_PATH = `${__dirname}/../data/service-hours.ts`

/*
 * TJ route scope and stale calendar services, matching generateHeadways.ts.
 * Kept in step with that file deliberately: a line scoped into one generator
 * and out of the other would carry a headway with no window, or the reverse.
 */
const SCOPE_DESC = new Set(['BRT', 'Angkutan Umum Integrasi'])
const STALE_SERVICES = new Set(['HJ', 'X'])

const DAY_S = 86400

// ── minimal CSV parser (matches generateHeadways.ts) ─────────────────────────
function parseCSV(text: string): Record<string, string>[] {
  const rows: Record<string, string>[] = []
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n')
  const header = lines[0]!.split(',')
  for (const line of lines.slice(1)) {
    const cells = line.split(',')
    const row: Record<string, string> = {}
    header.forEach((key, i) => {
      row[key] = cells[i] ?? ''
    })
    rows.push(row)
  }
  return rows
}

const load = (file: string) => parseCSV(fs.readFileSync(`${FEED_DIR}/${file}`, 'utf-8'))

/*
 * GTFS times may exceed 24:00:00 to express a trip that runs past midnight
 * (this feed tops out at 23:59:59, but the format allows it), so the result is
 * reduced mod a day. A span that wraps then reads as `endS < startS`, which is
 * exactly what inWindow expects.
 */
const toSeconds = (hhmmss: string): number => {
  const [h, m, s] = hhmmss.split(':').map(Number)
  return (((h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0)) % DAY_S + DAY_S) % DAY_S
}

/** Lines with topology, i.e. the ones the router can actually use. */
const routableLines = () => new Set(TOPOLOGY.map(t => t.lineCode))

/*
 * TJ: the service span per (line, day), straight from frequencies.txt.
 *
 * A route's variants share a corridor, so the line is in service from the
 * earliest start of any of them to the latest end. The 88 rows spanning
 * 00:00:00-23:59:59 are the AMARI night corridors and come through as a
 * full-day window rather than as missing data — "runs all night" is a fact
 * worth stating, not an absence.
 */
function tjWindows(): Map<string, Partial<Record<DayName, ServiceWindow>>> {
  const trips = new Map(load('trips.txt').map(t => [t.trip_id!, t]))
  const scopedRoutes = new Set(
    load('routes.txt').filter(r => SCOPE_DESC.has(r.route_desc!)).map(r => r.route_id!)
  )
  const calendar = new Map(load('calendar.txt').map(c => [c.service_id!, c]))

  const spans = new Map<string, { start: number, end: number }>()
  for (const row of load('frequencies.txt')) {
    const trip = trips.get(row.trip_id!)
    if (!trip || !scopedRoutes.has(trip.route_id!) || STALE_SERVICES.has(trip.service_id!)) continue
    if (!row.start_time || !row.end_time) continue

    const start = toSeconds(row.start_time)
    const end = toSeconds(row.end_time)
    for (const day of dayBits(calendar.get(trip.service_id!))) {
      const key = `${day}:${trip.route_id!}`
      const seen = spans.get(key)
      spans.set(key, {
        start: seen ? Math.min(seen.start, start) : start,
        end: seen ? Math.max(seen.end, end) : end
      })
    }
  }

  const byLine = new Map<string, Partial<Record<DayName, ServiceWindow>>>()
  for (const [key, span] of spans) {
    const [day, line] = [key.slice(0, key.indexOf(':')) as DayName, key.slice(key.indexOf(':') + 1)]
    const entry = byLine.get(line) ?? {}
    entry[day] = [span.start, span.end]
    byLine.set(line, entry)
  }
  return byLine
}

/*
 * Rail: inferred from the departures we hold, read through
 * `wrangler d1 execute --local` exactly as generateHeadways.ts does.
 *
 * Restricted to weekday boards with the same `(dayMask & 4)` filter
 * generateHeadways.ts uses, and for the same reason: MRTJ and LRTJBDB now carry
 * genuinely day-typed rows, so an unfiltered read derives one window from two
 * interleaved timetables. Measured 2026-09-06 the filter changes no window on
 * any line — every weekend board falls inside its weekday span — so this is
 * closing a latent hole rather than fixing a wrong number. It matters the day a
 * weekend service starts earlier or ends later than the weekday one.
 *
 * Still emitted under every day. A weekday-derived window is what we can defend
 * for all three; deriving a real per-day window needs the SAT/SUN masks read
 * separately, which is worth doing when a line's spans actually diverge.
 */
function railWindows(): Map<string, Partial<Record<DayName, ServiceWindow>>> {
  const sql = `SELECT lineCode, estimatedDeparture FROM schedules
               WHERE lineCode IS NOT NULL AND lineCode != 'NUL'
                 AND (dayMask & 4) != 0`
  const raw = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'commute', '--local', '--command', sql, '--json'],
    { cwd: `${__dirname}/../../..`, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }
  )
  const rows = JSON.parse(raw.slice(raw.indexOf('[')))[0].results as {
    lineCode: string
    estimatedDeparture: string
  }[]

  const byLine = new Map<string, number[]>()
  for (const row of rows) {
    const [h, m, s] = row.estimatedDeparture.split(':').map(Number)
    const seconds = (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0)
    byLine.set(row.lineCode, [...(byLine.get(row.lineCode) ?? []), seconds])
  }

  const windows = new Map<string, Partial<Record<DayName, ServiceWindow>>>()
  for (const [line, departures] of byLine) {
    const window = windowFromDepartures(departures)
    // Null means no break long enough to call an overnight one. Asserting a
    // window there would close a service that runs continuously.
    if (!window) continue
    windows.set(line, Object.fromEntries(DAY_NAMES.map(day => [day, window])))
  }
  return windows
}

const routable = routableLines()
const tj = tjWindows()
const rail = railWindows()

/*
 * Only lines the router can use. A window on a line with no topology would
 * never be read, and every unread row is one more thing to keep true.
 */
const merged = new Map([...tj, ...rail].filter(([line]) => routable.has(line)))

const format = ([startS, endS]: ServiceWindow) => `[${startS}, ${endS}]`
const hhmm = (x: number) =>
  `${String(Math.floor(x / 3600) % 24).padStart(2, '0')}:${String(Math.floor(x / 60) % 60).padStart(2, '0')}`

/*
 * Collapse to one ALL entry when every day agrees, which is the common case:
 * TJ spans rarely differ by day and rail cannot differ at all yet. Emitting
 * three identical windows per line would triple the file to say one thing.
 */
const entries = [...merged].sort(([a], [b]) => a.localeCompare(b)).map(([line, byDay]) => {
  const present = DAY_NAMES.filter(day => byDay[day] !== undefined)
  const allSame = present.length === DAY_NAMES.length
    && present.every(day => format(byDay[day]!) === format(byDay[present[0]!]!))
  const window = byDay[present[0]!]!

  /*
   * The readable time goes on its own line ABOVE the entry, not trailing it:
   * the join below appends the comma, so a trailing `// 05:00-22:00` would
   * swallow it and the generated file would not parse.
   */
  if (allSame) {
    return `  // ${hhmm(window[0])}-${hhmm(window[1])}\n  '${line}': { ALL: ${format(window)} }`
  }
  const parts = present.map(day => `${day}: ${format(byDay[day]!)}`)
  const readable = present.map(day => `${day} ${hhmm(byDay[day]![0])}-${hhmm(byDay[day]![1])}`)
  return `  // ${readable.join(', ')}\n  '${line}': { ${parts.join(', ')} }`
})

const fileTS = '/*\n'
  + ' * Service windows: when each line runs, in seconds since local midnight.\n'
  + ' *\n'
  + ' * GENERATED — do not edit by hand; re-run `pnpm --filter api generate:service-hours`.\n'
  + ' *\n'
  + ' * A window is `[startS, endS]`. `endS < startS` means it crosses midnight,\n'
  + ' * which is normal for rail: KCI\'s Bogor line runs 03:50 to 01:07. Compare\n'
  + ' * with `inWindow` from @commute/tsundere rather than by hand — a plain\n'
  + ' * `t >= start && t <= end` matches nothing at all on a crossing window.\n'
  + ' *\n'
  + ' * `ALL` means the window is the same on every day. A line may instead carry\n'
  + ' * WD / SAT / SUN keys when its span genuinely differs. Read the specific day\n'
  + ' * first, then ALL, then treat a missing line as always in service — so a\n'
  + ' * line we have no window for keeps today\'s behaviour rather than closing.\n'
  + ' *\n'
  + ' * TJ spans come from GTFS frequencies.txt and are exact. Rail windows are\n'
  + ' * inferred from the schedules table as the complement of the largest gap\n'
  + ' * between departures; a line with no gap long enough to be an overnight\n'
  + ' * break is omitted, which is how the 24-hour corridors stay open.\n'
  + ' */\n\n'
  + 'import type { ServiceWindow } from \'@commute/tsundere\'\n\n'
  + '/** Day buckets a window can be keyed by, plus ALL for "every day". */\n'
  + 'export type ServiceDay = \'WD\' | \'SAT\' | \'SUN\' | \'ALL\'\n\n'
  + 'export const SERVICE_HOURS: Record<string, Partial<Record<ServiceDay, ServiceWindow>>> = {\n'
  + entries.join(',\n')
  + '\n}\n'

fs.writeFileSync(OUT_PATH, fileTS)

const tjRoutable = [...tj.keys()].filter(l => routable.has(l))
const railRoutable = [...rail.keys()].filter(l => routable.has(l))
const allDay = [...merged].filter(([, d]) => {
  const w = d.ALL ?? d.WD
  return w && w[0] === 0 && w[1] >= DAY_S - 1
})
console.log(`Wrote ${entries.length} service windows to ${OUT_PATH}`)
console.log(`  TJ   — ${tjRoutable.length} routable lines (of ${tj.size} in feed)`)
console.log(`  Rail — ${railRoutable.length} lines`)
console.log(`  Round-the-clock (AMARI): ${allDay.length} — ${allDay.map(([l]) => l).join(', ')}`)
const missing = [...routable].filter(l => !merged.has(l)).sort()
if (missing.length > 0) console.log(`  No window (treated as always open): ${missing.join(', ')}`)
