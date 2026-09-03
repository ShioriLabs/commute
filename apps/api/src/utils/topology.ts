import type { Operator, OPERATORS } from '@commute/constants'
import { TOPOLOGY, type Branch, type LineTopology, type Stop } from 'db/data/topology'
import type { Line, LineDetail, LineDetailSegment, LineDetailStation, LineSegmentKind } from 'models/line'

export function findTopology(operator: Operator, lineCode: string): LineTopology | null {
  return TOPOLOGY.find(t => t.operator === operator && t.lineCode === lineCode) ?? null
}

// Every stop on the line (both directions + branches) as DB station ids.
export function collectStationIds(topology: LineTopology): string[] {
  const toId = (stop: Stop) => `${topology.operator}-${stop.station}`
  return [
    ...topology.path.map(toId),
    // An asymmetric corridor serves stops in one direction only, and those are
    // real haltes the line calls at — omitting them here left them unfetched and
    // so invisible to the line detail below.
    ...(topology.pathReverse ?? []).map(toId),
    ...(topology.branches ?? []).flatMap(branch => branch.path.map(toId))
  ]
}

/*
 * The stretches only the reverse direction serves, each hanging off the trunk
 * at the stop where it leaves it.
 *
 * `path` alone under-reports an asymmetric corridor, and 24 of the 29 lines
 * carrying a `pathReverse` lose stops that way — 86 haltes across the network.
 * TJ:7F is the clearest: it reaches Juanda via Pasar Baru and returns via
 * Pecenongan, Monas and Balai Kota, so the forward path drops that whole arm.
 *
 * Reverse-only stops do NOT form one run. On 7F they fall in three groups: a
 * directional twin (Tanah Merdeka's other side), two stops the forward direction
 * skips mid-route, and the Monas loop arm. Each is emitted separately, attached
 * to the last stop both directions still share before it — treating them as one
 * span would join unrelated places.
 *
 * A stretch is a LOOP only when the reverse direction comes back to the stop it
 * left from — 7F reaches Kwitang, runs the Monas circuit, and returns through
 * Kwitang, so that junction really is visited twice and the tracer closes the
 * ring. A stretch that rejoins the trunk somewhere ELSE is a detour, not a
 * circuit: Cempaka Putih and Cempaka Mas sit between Pulo Mas Bypass and Sumur
 * Batu on a straight westward run, and closing them into a ring drew 2000 units
 * back out along koridor 2's stroke. Those are emitted as RAMP, which the
 * tracer attaches at one end only.
 */
function reverseOnlyBranches(
  topology: LineTopology
): Array<{ fromStation: string, path: Stop[], kind: LineSegmentKind }> {
  const reverse = topology.pathReverse
  if (!reverse) return []

  const forward = new Set(topology.path.map(stop => stop.station))
  const out: Array<{ fromStation: string, path: Stop[], kind: LineSegmentKind }> = []
  let run: Stop[] = []
  // The last shared stop seen, which is where the current run leaves the trunk.
  let anchor: string | null = null

  /*
   * A circuit closes across BOTH directions, not within one.
   *
   * 7F's reverse path ends at Juanda having run Kwitang -> Balai Kota -> Monas
   * -> Pecenongan; the return leg (Juanda -> Pasar Baru -> Kwitang) lives in the
   * forward path. So a stretch is a LOOP when it runs to the line's terminus and
   * the forward direction comes back through the same junction — never when it
   * simply rejoins the trunk further along, which is a detour.
   */
  const forwardOrder = topology.path.map(stop => stop.station)
  const terminus = forwardOrder[0]
  const close = (rejoin: string | null, rejoinStop: Stop | null): void => {
    if (run.length === 0 || !anchor) return
    /*
     * The run reaches the terminus, and the forward direction comes back through
     * the junction it left from: that is the circuit. On 7F the run ends at
     * Juanda (the terminus) having left from Kwitang, and the forward path runs
     * Juanda -> Pasar Baru -> Kwitang, closing the ring.
     */
    const closesRing = rejoin === terminus && forwardOrder.indexOf(anchor) > 0
    /*
     * Carry the stop the run REJOINS the trunk at, so its exit is drawn.
     *
     * `joinsAtCode` attaches a run to the trunk at the stop it LEFT from, which
     * covers the entry. The exit has no such hook: the last reverse-only stop
     * and the trunk stop after it are adjacent in the reverse direction only, so
     * that pair sits in no segment and the run is drawn stopping in mid-air.
     *
     * TJ:5C is the visible case. Its reverse path runs Juanda -> Lapangan
     * Banteng -> Pal Putih; only Lapangan Banteng is reverse-only, so the run
     * was a single stop hanging off Juanda and the leg closing the Monas circuit
     * was never drawn — the loop read as open on the map. Appending Pal Putih
     * closes it.
     *
     * Not needed for a LOOP: the tracer already prepends AND appends the
     * junction there, so the ring closes on the anchor itself.
     */
    if (!closesRing && rejoinStop) run.push(rejoinStop)
    out.push({ fromStation: anchor, path: run, kind: closesRing ? 'LOOP' : 'RAMP' })
    run = []
  }

  for (const stop of reverse) {
    if (forward.has(stop.station)) {
      close(stop.station, stop)
      anchor = stop.station
      continue
    }
    run.push(stop)
  }
  // A run that never rejoins ends at the line's own terminus, so it has no exit
  // pair to draw.
  close(null, null)

  /*
   * Track the reverse direction runs between two stops the forward path ALSO
   * has, but never next to each other.
   *
   * The loop above only sees stops the forward path lacks, so a pair whose two
   * ends are both on the trunk falls straight through it — and the trunk cannot
   * carry the pair either, because there the two are not adjacent. The stretch
   * is then expressed in no segment at all and is simply never drawn.
   *
   * This is what leaves the Kota Tua ring open. Koridor 1 runs Kali Besar ->
   * Museum Sejarah -> Kota northbound and returns Glodok -> Kali Besar, so the
   * ring's bottom edge lives only in the reverse path; 3H loses Kota -> Glodok
   * the same way. The artwork draws all four sides — measured, each koridor has
   * its own concentric ring and every stop sits on it — so the missing side was
   * never a tracing failure but a pair the line detail did not contain.
   *
   * Emitted as a two-stop RAMP anchored at the first stop, which is what the
   * pair is: a stretch of track the line runs, hanging off the trunk. Never a
   * LOOP — a circuit needs stops of its own, and this has none.
   *
   * Measured over the sheet this recovers 24 pairs across 18 lines.
   */
  const adjacentInForward = new Set<string>()
  for (let i = 0; i < topology.path.length - 1; i++) {
    adjacentInForward.add(pairKey(topology.path[i].station, topology.path[i + 1].station))
  }
  const emitted = new Set<string>()
  for (let i = 0; i < reverse.length - 1; i++) {
    const from = reverse[i]
    const to = reverse[i + 1]
    if (!forward.has(from.station) || !forward.has(to.station)) continue
    const key = pairKey(from.station, to.station)
    if (adjacentInForward.has(key) || emitted.has(key)) continue
    emitted.add(key)
    out.push({ fromStation: from.station, path: [to], kind: 'RAMP' })
  }

  return out
}

// Direction-insensitive key for a pair of adjacent stops: the sheet draws one
// stroke whichever way the bus runs along it.
function pairKey(a: string, b: string): string {
  return a < b ? `${a}~${b}` : `${b}~${a}`
}

// Minimal shape needed from StationRepository.getByIds results.
interface HydratedStation {
  id: string
  code: string
  // Already the display name — the repository resolves it.
  name: string
  lines: string[]
}

// A branch that extends the trunk's end without closing reads as the mainline
// (Bogor: BJD/CLT/BOO continuing past Citayam); later branches at the same
// junction are side ramps (Nambo). This relies on TOPOLOGY listing the
// mainline branch before its sibling ramps — significant ordering.
function classifyBranch(branch: Branch, topology: LineTopology, isFirstNonLoop: boolean): LineSegmentKind {
  if (branch.closeTo) return 'LOOP'
  const trunkEnd = topology.path.at(-1)?.station
  if (isFirstNonLoop && trunkEnd !== undefined && branch.fromStation === trunkEnd) return 'CONTINUATION'
  return 'RAMP'
}

export function buildLineDetail(
  topology: LineTopology,
  line: Line,
  operator: typeof OPERATORS[Operator],
  stationsById: Map<string, HydratedStation>
): LineDetail {
  const toDetailStation = (stop: Stop): LineDetailStation | null => {
    const id = `${topology.operator}-${stop.station}`
    const station = stationsById.get(id)
    if (!station) {
      // Topology drift (e.g. a future stop not yet in the DB) must not take
      // the whole line page down.
      console.warn(`[lines] station ${id} in topology but not in DB; skipping`)
      return null
    }
    // Line keys, matching Station.lines. `distanceFromOriginM` is gone: it was
    // a v2 hook nothing ever read.
    const currentKey = `${topology.operator}:${line.lineCode}`
    const otherLines = station.lines.filter(key => key !== currentKey)
    return {
      id: station.id,
      code: station.code,
      name: station.name,
      stationNumber: stop.pos,
      isInterchange: otherLines.length > 0,
      otherLines
    }
  }

  const mapStops = (stops: Stop[]): LineDetailStation[] =>
    stops.map(toDetailStation).filter((s): s is LineDetailStation => s !== null)

  const segments: LineDetailSegment[] = [{
    kind: 'TRUNK',
    joinsAtCode: null,
    stations: mapStops(topology.path)
  }]

  for (const stretch of reverseOnlyBranches(topology)) {
    segments.push({
      kind: stretch.kind,
      joinsAtCode: stretch.fromStation,
      stations: mapStops(stretch.path)
    })
  }

  let seenNonLoop = false
  for (const branch of topology.branches ?? []) {
    const kind = classifyBranch(branch, topology, !seenNonLoop)
    if (kind !== 'LOOP') seenNonLoop = true
    segments.push({
      kind,
      joinsAtCode: branch.fromStation,
      stations: mapStops(branch.path)
    })
  }

  return {
    operator: { code: operator.code, name: operator.name },
    line,
    segments
  }
}
