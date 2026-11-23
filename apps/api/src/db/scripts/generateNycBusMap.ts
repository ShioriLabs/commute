/*
 * New York's subway around Midtown West, Hell's Kitchen, Lincoln Square and Central Park through
 * Peta Bus's own pipeline (busMapBundle.ts), in bus-map.json's format: the Android map debug panel's
 * "New York" (feature/map/impl/src/debug/assets/map/bus-map-nyc.json), to see the drawing on a
 * network Transit's map is known for.
 *
 * Usage: tsx src/db/scripts/generateNycBusMap.ts <MTA subway GTFS dir> <out.json>
 * The feed: https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip, unzipped.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import {
  bundle, contractShortEdges, crossOver, easeCorners, filletCorners, placeStops, roundJunctions, strokeKeys,
  type BundleLine, type CornerTally, type OrderReport
} from './busMapBundle'
import { decodePolyline, encodePolyline, simplify, type LngLat } from '../../utils/polyline'
import { parseCSV } from './gtfs'
import { formatScore, networkScore } from './busMapStats'

async function main(): Promise<void> {
  const [feed, out] = process.argv.slice(2) as [string, string]
  const S = 40.748, N = 40.800, W = -74.010, E = -73.945
  const inBox = ([lng, lat]: LngLat): boolean => lat >= S && lat <= N && lng >= W && lng <= E

  // The bundler measures in Jakarta's metres (KX at -6.2°): NYC moved there, same shape, and back.
  const LAT0 = 40.774, LNG0 = -73.977, JLAT = -6.2
  const squeeze = Math.cos((LAT0 * Math.PI) / 180) / Math.cos((JLAT * Math.PI) / 180)
  const toJkt = ([lng, lat]: LngLat): LngLat => [LNG0 + (lng - LNG0) * squeeze, lat - LAT0 + JLAT]
  const toNyc = ([lng, lat]: LngLat): LngLat => [LNG0 + (lng - LNG0) / squeeze, lat - JLAT + LAT0]

  const read = (f: string) => parseCSV(fs.readFileSync(path.join(feed, f), 'utf8').replace(/^\uFEFF/, ''))
  const routes = new Map(read('routes.txt').map(r => [r.route_id!, r]))
  const SKIP = new Set(['6X', '7X', 'FX'])
  // Each route's most-run shape, direction 0 (1 where it has none).
  const runs = new Map<string, number>()
  const tripOf = new Map<string, string>()
  for (const t of read('trips.txt')) {
    if (!t.shape_id || SKIP.has(t.route_id!)) continue
    const key = `${t.route_id}|${t.direction_id}|${t.shape_id}`
    runs.set(key, (runs.get(key) ?? 0) + 1)
    tripOf.set(key, t.trip_id!)
  }
  const best = new Map<string, { key: string, n: number }>()
  for (const [key, n] of runs) {
    const [r, d] = key.split('|')
    const slot = `${r}|${d}`
    if (n > (best.get(slot)?.n ?? 0)) best.set(slot, { key, n })
  }
  const chosen = new Map<string, { shape: string, trip: string, both: string[] }>()
  for (const r of routes.keys()) {
    const pick = best.get(`${r}|0`) ?? best.get(`${r}|1`)
    const both = [best.get(`${r}|0`), best.get(`${r}|1`)].flatMap(b => (b ? [b.key.split('|')[2]!] : []))
    if (pick) chosen.set(r, { shape: pick.key.split('|')[2]!, trip: tripOf.get(pick.key)!, both })
  }
  const pts = new Map<string, [number, number, number][]>()
  const wanted = new Set([...chosen.values()].flatMap(c => c.both))
  for (const p of read('shapes.txt')) {
    if (!wanted.has(p.shape_id!)) continue
    const list = pts.get(p.shape_id!) ?? []
    list.push([Number(p.shape_pt_sequence), Number(p.shape_pt_lon), Number(p.shape_pt_lat)])
    pts.set(p.shape_id!, list)
  }
  /** The runs of [line] inside the box, each with the point either side so it reaches the edge. */
  function clip(line: LngLat[]): LngLat[][] {
    const out: LngLat[][] = []
    let cur: LngLat[] = []
    line.forEach((p, i) => {
      if (inBox(p)) {
        if (!cur.length && i) cur.push(line[i - 1]!)
        cur.push(p)
      } else if (cur.length) {
        cur.push(p)
        out.push(cur)
        cur = []
      }
    })
    if (cur.length) out.push(cur)
    return out.filter(r => r.length >= 2)
  }

  // Stations: parents in the box, and each line's calls there from its chosen trip.
  const stops = read('stops.txt')
  const parentOf = new Map(stops.map(s => [s.stop_id!, s.parent_station || s.stop_id!]))
  const stations = new Map(stops.filter(s => s.location_type === '1').map(s => [s.stop_id!, s]))
  const tripLine = new Map([...chosen].map(([r, c]) => [c.trip, r]))
  const calls = new Map<string, string[]>()
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(feed, 'stop_times.txt')) })
  let header: string[] | undefined
  for await (const row of rl) {
    const cells = row.replace(/^\uFEFF/, '').split(',')
    if (!header) {
      header = cells
      continue
    }
    const trip = cells[header.indexOf('trip_id')]!
    const r = tripLine.get(trip)
    if (!r) continue
    const parent = parentOf.get(cells[header.indexOf('stop_id')]!)!
    calls.set(r, [...(calls.get(r) ?? []), parent])
  }

  const code = (r: string) => `NYC:${r}`
  const lines = [...chosen].flatMap(([r, c]) => {
    const line = (shape: string) => (pts.get(shape) ?? []).sort((a, b) => a[0] - b[0]).map(([, lng, lat]) => [lng, lat] as LngLat)
    const pieces = clip(line(c.shape))
    // Drawn both ways, as a koridor's are: at street zoom lines run together only going one way.
    const drawn = c.both.flatMap(s => clip(line(s)))
    if (!pieces.length) return []
    const route = routes.get(r)!
    const color = `#${(route.route_color || '808183').toUpperCase()}`
    const here = (calls.get(r) ?? []).filter((s) => {
      const st = stations.get(s)
      return st && inBox([Number(st.stop_lon), Number(st.stop_lat)])
    })
    return [{ r, code: code(r), name: `${route.route_short_name} ${route.route_long_name}`, color, pieces, drawn, stops: [...new Set(here)] }]
  })
  console.log('lines:', lines.map(l => l.r).join(' '))

  const input: BundleLine[] = lines.map(l => ({ code: l.code, kind: 'RAIL', color: l.color, termini: [], pieces: l.pieces.map(p => p.map(toJkt)) }))
  const report: OrderReport = { local: 0, exact: 0, components: 0, fallbacks: 0 }
  // Its lines crossing at a shallow angle cross (railApart), and its knots of junctions are one.
  const edges = contractShortEdges(await bundle(input, report, undefined, { railApart: true }), KNOT_M)
  console.log(`edges: ${edges.length}, crossings cost ${report.exact} (local ${report.local})`)
  // As generateBusMap lays a rail-only edge: its own way, corners eased, junctions left, fillets.
  const strokeOf = strokeKeys(input)
  const strokes = (lines: readonly string[]) => [...new Set(lines.map(l => strokeOf.get(l) ?? l))]
  const corners: CornerTally = { eased: 0, junctions: 0, squeezed: 0, folded: 0 }
  const eased = edges.map(e => easeCorners(simplify(decodePolyline(e.shape), 4), strokes(e.lines).length, corners))
  // Its corners at nodes rounded as a koridor's are: a subway's tracks curve where they part.
  const joined = roundJunctions(eased.map((p, i) => ({ path: p, lines: strokes(edges[i]!.lines), rail: false })), corners)
  const laid = edges.map((e, i) => (joined[i]!.length < 2 ? e : { ...e, shape: encodePolyline(filletCorners(joined[i]!, strokes(e.lines).length, corners)) }))
  const crossed = crossOver(laid, strokeOf, true)
  console.log(`corners: ${JSON.stringify(corners)}, crossOver pieces +${crossed.length - laid.length}`)
  const haltes: Record<string, [string, number, number]> = {}
  for (const [id, s] of stations) {
    const p: LngLat = [Number(s.stop_lon), Number(s.stop_lat)]
    if (inBox(p)) haltes[id] = [s.stop_name!, p[0], p[1]]
  }
  const marks = placeStops(crossed, Object.entries(haltes).map(([id, [, lng, lat]]) => {
    const [x, y] = toJkt([lng, lat])
    return { code: id, lng: x, lat: y, lines: lines.filter(l => l.stops.includes(id)).map(l => l.code) }
  }), strokeOf, () => false)

  const back = (shape: string) => encodePolyline(decodePolyline(shape).map(toNyc))
  const map = {
    attribution: 'MTA New York City Transit GTFS (subway), drawn by Peta Bus\'s bundler',
    lines: lines.map(l => ({
      code: l.code, name: l.name, kind: 'RAIL', color: l.color,
      shapes: l.pieces.map(p => encodePolyline(p)),
      drawn: l.drawn.map(p => encodePolyline(p, 6)),
      stops: l.stops
    })),
    edges: crossed.map(e => ({ ...e, shape: back(e.shape) })),
    stopMarks: marks.map((m) => {
      const [lng, lat] = toNyc([m[1], m[2]])
      return [m[0], lng, lat, ...m.slice(3)]
    }),
    haltes,
    rail: []
  }
  fs.writeFileSync(out, JSON.stringify(map))
  console.log(`wrote ${out}: ${map.edges.length} edges, ${map.stopMarks.length} marks, ${Object.keys(haltes).length} stations`)
  console.log(formatScore(networkScore(map, 10), 'score'))
}

/** Edges shorter than this between nodes drawn as one node: about a bundle's width at street zoom. */
const KNOT_M = 100

main().then(() => process.exit(0), (e: unknown) => {
  console.error(e)
  process.exit(1)
})
