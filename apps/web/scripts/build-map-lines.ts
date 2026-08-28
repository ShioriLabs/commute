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
 * ── Rail only, for now ─────────────────────────────────────────────────────
 *
 * BUS lines are skipped. Not because tracing them fails outright, but because
 * the colour discriminator that makes tracing trustworthy is rail-only: it comes
 * from map-skeleton.json, which carries just the width-25 strokes. See
 * app/lib/map-corridor-colour.ts. Without it, a BRT line traces onto whichever
 * of several stacked parallel strokes happens to be a world unit nearer, which
 * is a confirmed bug rather than a theoretical one.
 *
 * Extending to BRT means adding `c` to CorridorEntry in build-map-skeleton.ts —
 * the value is already on ExtractedStroke there, just dropped on the way out —
 * and regenerating. Then drop the BUS filter here.
 *
 * Run: pnpm build:map-lines   (API_BASE_URL overrides the origin)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { corridorColours } from '../app/lib/map-corridor-colour'
import { traceLine, type TracePoint } from '../app/lib/map-line-trace'
import type { Corridor } from '../app/lib/map-corridors'
import type { SkeletonStroke } from '../utils/map-skeleton-order'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(SCRIPT_DIR, '..')
const DATA_DIR = path.join(WEB_ROOT, 'app', 'data')
const OUT_PATH = path.join(DATA_DIR, 'map-lines.json')

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000'

/*
 * Floors, so a regeneration that quietly stops tracing fails the build.
 *
 * Measured today: 10 lines, 128 of 132 adjacent pairs traced (97%). The four it
 * gives up are deliberate refusals where the only candidate was a stroke of a
 * grossly different colour — see the note in map-line-trace.ts. These sit below
 * that with room for the artwork to shift a little, and are meant to catch a
 * collapse, not to police the last pair.
 */
const MIN_LINES = 8
const MIN_MATCH_RATIO = 0.85
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
  const skeleton = readData<{ strokes: SkeletonStroke[] }>('map-skeleton.json')
  const pointsManifest = readData<{ version: string, points: TracePoint[] }>('points.json')

  const colours = corridorColours(corridorsManifest.corridors, skeleton.strokes)
  const coloured = colours.filter(c => c !== null).length
  log(`${corridorsManifest.corridors.length} corridors, ${coloured} with a joined artwork colour`)

  const operators = await getJson<ApiOperator[]>(`${API_BASE_URL}/operators`)
  const wanted: Array<{ key: string, operator: string, code: string, name: string, color: string }> = []
  for (const operator of operators) {
    for (const line of operator.lines ?? []) {
      // Mode lives on the line when it differs from its operator's, which is
      // exactly the case the operator-level field cannot express.
      const mode = line.mode ?? operator.mode
      if (mode === 'BUS') continue
      wanted.push({
        key: `${operator.code}:${line.lineCode}`,
        operator: operator.code,
        code: line.lineCode,
        name: line.name,
        color: line.colorCode
      })
    }
  }
  log(`${wanted.length} non-BUS lines to trace`)

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
  for (const line of wanted) {
    detailByKey.set(line.key, await getJson(`${API_BASE_URL}/lines/${line.operator}/${line.code}`))
  }
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

  for (const line of wanted) {
    const detail = detailByKey.get(line.key)!
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
    const traced = traceLine(detail, pointsManifest.points, corridorsManifest.corridors, colours, line.color, sharedTrack)
    totalMatched += traced.matchedPairs
    totalPairs += traced.totalPairs

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
    log(`  ${line.key.padEnd(11)} ${String(pct).padStart(3)}%  ${segments.length} segment(s)${flag}`)

    out.push({
      key: line.key,
      operator: line.operator,
      code: line.code,
      name: line.name,
      color: line.color,
      // Half-width in world units. The artwork draws rail corridors 25 wide, and
      // the cutout has to cover the stroke it is revealing.
      r: 12.5,
      segments,
      bbox: [minX, minY, maxX, maxY],
      matchedPairs: traced.matchedPairs,
      totalPairs: traced.totalPairs
    })
  }

  const ratio = totalPairs > 0 ? totalMatched / totalPairs : 0
  log(`traced ${totalMatched}/${totalPairs} pairs (${Math.round(100 * ratio)}%) across ${out.length} lines`)

  if (out.length < MIN_LINES) {
    throw new Error(`only ${out.length} lines traced (min ${MIN_LINES}) — the API shape or the mode filter probably changed`)
  }
  if (ratio < MIN_MATCH_RATIO) {
    throw new Error(`only ${Math.round(100 * ratio)}% of pairs traced (min ${Math.round(100 * MIN_MATCH_RATIO)}%) — corridors and points may have been regenerated apart`)
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
