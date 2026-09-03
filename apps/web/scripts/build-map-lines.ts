/*
 * Builds app/data/map-lines.json: every line's drawn geometry, so tapping a line
 * on the map can hold it at full strength while the rest of the network fades.
 *
 * Traced at build time rather than on tap. pickLegCorridor is O(stops x corridors
 * x vertices) and matchCorridorPath rescans every corridor per adjacent pair; a
 * trunk line is tens of stations, so doing that on the main thread when a rider
 * taps is a visible hitch. Baking it also freezes the geometry into a reviewable
 * diff and lets a tracing regression fail a build instead of a phone.
 *
 * Source is the API, not the artwork: /operators for the line list and brand
 * colours, /lines/:op/:code for each line's ordered stations. The geometry it
 * matches against is already committed (map-corridors.json, map-skeleton.json,
 * points.json), so this script needs no browser and no PDF.
 *
 * ── Rail and BRT ───────────────────────────────────────────────────────────
 *
 * BRT used to be excluded for want of IDENTITY: the sheet draws ~17 BRT colours
 * for 100 TJ lines grouped by koridor family, so a colour narrows a stroke to a
 * family (`#FDCB1C` is 3, 3F and 3H) and never to one line.
 *
 * What supplies the missing identity is the line's own STATIONS. The family
 * colour is now elected from the ink under a line's stops rather than taken from
 * its brand hex (see electArtworkColour), and within that family the line's own
 * station sequence picks out its own arm. Two lines sharing a stretch of busway
 * share the stops that describe it, so they trace it identically — measured, the
 * nine pairs TJ:3 and TJ:3F share from Kalideres emit byte-identical edges — and
 * they diverge exactly where their stations do.
 *
 * Run: pnpm build:map-lines   (API_BASE_URL overrides the origin)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { traceLine, type TracePoint } from '../app/lib/map-line-trace'
import { prepareCorridors, projectOntoPolyline, type Corridor } from '../app/lib/map-corridors'
import { channelDistance, CORRIDOR_COLOUR_TOLERANCE } from '../app/lib/map-corridor-colour'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(SCRIPT_DIR, '..')
const DATA_DIR = path.join(WEB_ROOT, 'app', 'data')
const OUT_PATH = path.join(DATA_DIR, 'map-lines.json')

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000'

/*
 * Ceiling on how much traced geometry may sit on ink of the wrong colour.
 *
 * This is the only non-circular accuracy check there is, and the one the pair
 * count cannot substitute for: the count once read 136/136 while a line was
 * traced down a neighbour's stroke for a third of its length. So per traced
 * edge, ask what colour the artwork actually is underneath and compare it to the
 * colour this line was traced AS — never to the corridor it matched, which is
 * circular and reports every trace as perfect.
 *
 * Weighted by LENGTH rather than edge count, because the residue is short
 * crossings of other corridors rather than whole wrong arms, and an edge count
 * would let one long wrong stretch hide behind many short right ones.
 *
 * Measured 1.13% over the shipped network, and ALL of it is three lines whose
 * data the sheet no longer matches: TJ:4/4D (the GTFS stop sequence runs through
 * stations the artwork does not connect) and TJ:10D (a withdrawn route). Every
 * line still in service audits at 0.00%.
 *
 * That matters for reading this number: the headroom under 2% is mostly spent on
 * known-bad data, so a real regression has less room to hide than the figure
 * suggests. If those three are ever corrected or dropped, bring the ceiling back
 * down rather than banking the slack — TJ:6 alone was 16% of its own length when
 * it was drawn along koridor 4, which is the scale this exists to catch.
 */
const MAX_OFF_COLOUR_LENGTH_RATIO = 0.02

/*
 * How close an edge midpoint must be to a stroke for its ink to count as the
 * artwork underneath. Half the widest stroke, so a point on the line samples the
 * line; beyond that the edge is over blank paper and the audit abstains rather
 * than guessing.
 */
const INK_SAMPLE_MAX_DIST_WORLD = 12.5

/*
 * Floors, so a regeneration that quietly stops tracing fails the build.
 *
 * Measured today: 41 lines (10 rail + 31 BRT), 636 of 655 adjacent pairs traced
 * (97%). The ones given up are deliberate refusals where no candidate stroke
 * was this line's — see the note in map-line-trace.ts.
 *
 * MIN_LINES is 32 rather than a hair under 41 because the dormant TJ feeders can
 * legitimately come and go as topology lands; what it must catch is a collapse
 * back to rail-only, which would be 10. MIN_MATCH_RATIO rises to 0.93 for a
 * related reason: with BRT included, rail alone very nearly clears the old 0.85,
 * so that floor would no longer notice BRT tracing failing wholesale.
 */
const MIN_LINES = 32
const MIN_MATCH_RATIO = 0.93
// The artifact ships to every rider. Comparable to label-points.json (~90 KB).
const MAX_BYTES = 256 * 1024

function log(msg: string): void {
  console.log(`[build-map-lines] ${msg}`)
}

interface ApiLine {
  lineCode: string
  name: string
  colorCode: string
  mode?: string
}

interface ApiOperator {
  code: string
  mode?: string
  lines?: ApiLine[]
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`)
  const body = await response.json() as { data?: T }
  // The API wraps payloads in StandardResponse; tolerate both shapes so this
  // works against a raw fixture too.
  return (body.data ?? body) as T
}

function readData<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(DATA_DIR, name), 'utf8')) as T
}

async function main(): Promise<void> {
  const corridorsManifest = readData<{ version: string, corridors: Corridor[] }>('map-corridors.json')
  const pointsManifest = readData<{ version: string, points: TracePoint[] }>('points.json')

  /*
   * The artwork colour now rides on each corridor, straight from the SVG stroke it
   * was extracted from. This used to be recovered by joining corridors to the
   * skeleton on their endpoints, which only ever worked for rail — the skeleton has
   * no BRT strokes — and needed the two files to stay in lockstep.
   */
  const coloured = corridorsManifest.corridors.filter(c => c.c).length
  log(`${corridorsManifest.corridors.length} corridors, ${coloured} carrying an artwork colour`)

  const operators = await getJson<ApiOperator[]>(`${API_BASE_URL}/operators`)
  // `mode` is optional on both the line and its operator, so it stays optional
  // here: an absent mode is "not known to be BUS", which is what the trace gate
  // below treats it as.
  const wanted: Array<{ key: string, operator: string, code: string, name: string, color: string, mode?: string }> = []
  for (const operator of operators) {
    for (const line of operator.lines ?? []) {
      // Mode lives on the line when it differs from its operator's, which is
      // exactly the case the operator-level field cannot express.
      const mode = line.mode ?? operator.mode
      wanted.push({
        key: `${operator.code}:${line.lineCode}`,
        operator: operator.code,
        code: line.lineCode,
        name: line.name,
        color: line.colorCode,
        mode
      })
    }
  }
  log(`${wanted.length} lines to trace`)

  /*
   * Every line's station set, so tracing can tell shared track from a parallel
   * stroke that merely runs nearby.
   *
   * The sheet draws shared track once, in one line's colour — LRT Jabodebek's
   * two lines share Dukuh Atas to Cawang, Cikarang shares Manggarai to Sudirman
   * with Soekarno-Hatta — so a strict colour gate leaves a hole in the middle of
   * the line that is being isolated. Fetched up front because the lookup has to
   * answer for every line while tracing any one of them.
   */
  const detailByKey = new Map<string, { segments: Array<{ kind: string, joinsAtCode?: string | null, stations: Array<{ id: string }> }> }>()
  const missing: string[] = []
  for (const line of wanted) {
    /*
     * A dormant line 404s rather than returning an empty body. 69 of the 100 TJ
     * lines are feeders and Mikrotrans sitting at searchable=0 with no topology
     * behind them, so this is the normal shape of the network today, not a fault
     * — but it is counted and reported, because the same 404 is what a genuinely
     * broken line would produce and that should not pass unremarked.
     */
    const detail = await getJson<{ segments: Array<{ kind: string, joinsAtCode?: string | null, stations: Array<{ id: string }> }> } | null>(
      `${API_BASE_URL}/lines/${line.operator}/${line.code}`
    ).catch(() => null)
    if (!detail?.segments) {
      missing.push(line.key)
      continue
    }
    detailByKey.set(line.key, detail)
  }
  if (missing.length > 0) log(`${missing.length} line(s) have no detail and were skipped (dormant feeders)`)
  /*
   * Drop lines the API has no stations for.
   *
   * 69 of the 100 TJ lines are the dormant feeders and Mikrotrans sitting at
   * searchable=0: they exist in the operator list but carry no topology, so
   * there is nothing to ground a trace on. Skipping them here rather than
   * letting each log a SKIPPED line keeps the build output about the lines that
   * were actually attempted — and the count is reported, so a line silently
   * losing its stations is still visible.
   */
  const dormant: string[] = []
  for (const [key, detail] of [...detailByKey]) {
    if (!detail.segments.some(segment => segment.stations.length > 0)) {
      detailByKey.delete(key)
      dormant.push(key)
    }
  }
  if (dormant.length > 0) log(`${dormant.length} line(s) have no stations and were skipped (dormant feeders)`)

  const servedByKey = new Map<string, Set<string>>()
  for (const [key, detail] of detailByKey) {
    const served = new Set<string>()
    for (const segment of detail.segments) {
      for (const station of segment.stations) served.add(station.id)
    }
    servedByKey.set(key, served)
  }

  const out: unknown[] = []
  let totalMatched = 0
  let totalPairs = 0
  let onColourLength = 0
  let offColourLength = 0
  const preparedCorridors = prepareCorridors(corridorsManifest.corridors)

  for (const line of wanted) {
    const detail = detailByKey.get(line.key)
    if (!detail) continue
    /*
     * The colours of other lines that serve BOTH stops of a pair. A stroke drawn
     * in one of those is this line's track too, just painted as its neighbour.
     * Anything else stays refused, which is what the gate is for.
     */
    const sharedTrack = (fromId: string, toId: string): string[] => {
      const shared: string[] = []
      for (const other of wanted) {
        if (other.key === line.key) continue
        const served = servedByKey.get(other.key)
        if (served && served.has(fromId) && served.has(toId)) shared.push(other.color)
      }
      return shared
    }
    /*
     * BUS lines are filtered out above, so today this is always false and the
     * gate only ever keeps rail off the BRT strokes. It is derived from the mode
     * rather than hard-coded so that re-enabling BRT tracing — the dormant
     * feeder work — gates itself correctly instead of silently matching rail.
     */
    const isBrt = line.mode === 'BUS'
    const traced = traceLine(detail, pointsManifest.points, corridorsManifest.corridors, undefined, line.color, sharedTrack, isBrt)
    totalMatched += traced.matchedPairs
    totalPairs += traced.totalPairs

    /*
     * Ink audit, per traced edge: what colour IS the artwork here, and is it the
     * colour this line was traced as? Sampled at the edge midpoint against the
     * nearest stroke, ignoring edges that sit on no ink at all — station discs
     * and label text are drawn over the centreline, so an edge legitimately
     * crosses blank paper.
     */
    const want = traced.tracedColour ?? line.color
    for (const segment of traced.segments) {
      for (const [ax, ay, bx, by] of segment.edges) {
        const mx = (ax + bx) / 2
        const my = (ay + by) / 2
        let nearest = Infinity
        let ink: string | null = null
        for (const corridor of preparedCorridors) {
          const { dist } = projectOntoPolyline(mx, my, corridor)
          if (dist < nearest) {
            nearest = dist
            ink = corridor.c
          }
        }
        if (!ink || nearest > INK_SAMPLE_MAX_DIST_WORLD) continue
        const length = Math.hypot(bx - ax, by - ay)
        if (channelDistance(ink, want) > CORRIDOR_COLOUR_TOLERANCE) offColourLength += length
        else onColourLength += length
      }
    }

    const segments = traced.segments
      // A segment that traced nothing carries no geometry to isolate. Its
      // stations are still on the line, but per the design an unmatched stretch
      // stays faded rather than being represented by dots alone.
      .filter(segment => segment.edges.length > 0)
      .map(segment => ({ kind: segment.kind, edges: segment.edges, markers: segment.markers }))

    if (segments.length === 0) {
      log(`  ${line.key.padEnd(11)} SKIPPED, nothing traced`)
      continue
    }

    // Bounding box over the traced geometry, for the camera fit on isolate.
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const segment of segments) {
      for (const [ax, ay, bx, by] of segment.edges) {
        minX = Math.min(minX, ax, bx)
        maxX = Math.max(maxX, ax, bx)
        minY = Math.min(minY, ay, by)
        maxY = Math.max(maxY, ay, by)
      }
    }

    const pct = traced.totalPairs > 0 ? Math.round(100 * traced.matchedPairs / traced.totalPairs) : 0
    const flag = traced.matchedPairs < traced.totalPairs ? `  (${traced.totalPairs - traced.matchedPairs} pair(s) left faded)` : ''
    /*
     * Name the elected ink whenever it is not the brand colour. An election that
     * goes wrong is otherwise completely silent, and this is the line in the
     * build output a reviewer can check against the artwork.
     */
    /*
     * Name the ink only when it CONTRADICTS the brand. Nearly every election
     * merely respells the brand in the artwork's own hex, which is noise here;
     * what a reviewer needs to see is a line drawn in a colour its brand never
     * names.
     */
    const elected = traced.tracedColour
      && channelDistance(traced.tracedColour, line.color) > CORRIDOR_COLOUR_TOLERANCE
      ? `  drawn in ${traced.tracedColour}, not its brand ${line.color}`
      : ''
    log(`  ${line.key.padEnd(11)} ${String(pct).padStart(3)}%  ${segments.length} segment(s)${flag}${elected}`)

    out.push({
      key: line.key,
      operator: line.operator,
      code: line.code,
      name: line.name,
      color: line.color,
      /*
       * The artwork ink this line was traced against, when the sheet draws it in
       * a colour its brand does not name (TJ:7, TJ:7F, TJ:14). Omitted otherwise,
       * so the field stays a note about the three exceptions rather than a second
       * colour on every line. Nothing at runtime reads it — the overlay draws the
       * brand colour — but the shipped-data audit needs to know what the trace was
       * actually judged against, and a reviewer needs to see it at all.
       */
      ...(traced.tracedColour
        && channelDistance(traced.tracedColour, line.color) > CORRIDOR_COLOUR_TOLERANCE
        ? { inkColor: traced.tracedColour }
        : {}),
      /*
       * Half-width in world units: the cutout has to cover the stroke it
       * reveals. The artwork draws rail 25 wide and BRT 15, so a BRT line
       * shipped at rail's 12.5 would punch a hole 66% wider than its own stroke
       * and, on the interlined bands, cut out the neighbouring koridor too.
       */
      r: isBrt ? 7.5 : 12.5,
      segments,
      bbox: [minX, minY, maxX, maxY],
      matchedPairs: traced.matchedPairs,
      totalPairs: traced.totalPairs
    })
  }

  const ratio = totalPairs > 0 ? totalMatched / totalPairs : 0
  log(`traced ${totalMatched}/${totalPairs} pairs (${Math.round(100 * ratio)}%) across ${out.length} lines`)

  const inkTotal = onColourLength + offColourLength
  const offRatio = inkTotal > 0 ? offColourLength / inkTotal : 0
  log(`ink audit: ${(100 * offRatio).toFixed(2)}% of traced length on off-colour artwork`)

  if (out.length < MIN_LINES) {
    throw new Error(`only ${out.length} lines traced (min ${MIN_LINES}) — the API shape or the mode filter probably changed`)
  }
  if (ratio < MIN_MATCH_RATIO) {
    throw new Error(`only ${Math.round(100 * ratio)}% of pairs traced (min ${Math.round(100 * MIN_MATCH_RATIO)}%) — corridors and points may have been regenerated apart`)
  }
  if (offRatio > MAX_OFF_COLOUR_LENGTH_RATIO) {
    throw new Error(`${(100 * offRatio).toFixed(2)}% of traced length sits on off-colour artwork (max ${100 * MAX_OFF_COLOUR_LENGTH_RATIO}%) — a line is probably riding a neighbour's stroke`)
  }

  const json = JSON.stringify({
    // Both inputs are versioned, and geometry baked from mismatched ones is
    // silently wrong rather than broken. Carrying both lets the shipped-data
    // test catch a drift that nothing else would.
    version: corridorsManifest.version,
    pointsVersion: pointsManifest.version,
    lines: out
  })

  if (json.length > MAX_BYTES) {
    throw new Error(`map-lines.json is ${Math.round(json.length / 1024)} KB (max ${MAX_BYTES / 1024} KB)`)
  }

  writeFileSync(OUT_PATH, `${json}\n`)
  log(`wrote ${path.relative(WEB_ROOT, OUT_PATH)} (${Math.round(json.length / 1024)} KB)`)
}

main().catch((error: unknown) => {
  console.error(`[build-map-lines] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
