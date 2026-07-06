import type { Operator, OPERATORS } from '@commute/constants'
import { TOPOLOGY, type Branch, type LineTopology, type Stop } from 'db/data/topology'
import type { Line, LineDetail, LineDetailSegment, LineDetailStation, LineSegmentKind } from 'models/line'

export function findTopology(operator: Operator, lineCode: string): LineTopology | null {
  return TOPOLOGY.find(t => t.operator === operator && t.lineCode === lineCode) ?? null
}

// Every stop on the line (trunk + branches) as DB station ids.
export function collectStationIds(topology: LineTopology): string[] {
  const ids = topology.path.map(stop => `${topology.operator}-${stop.station}`)
  for (const branch of topology.branches ?? []) {
    ids.push(...branch.path.map(stop => `${topology.operator}-${stop.station}`))
  }
  return ids
}

// Minimal shape needed from StationRepository.getByIds results.
interface HydratedStation {
  id: string
  code: string
  name: string
  formattedName: string | null
  lines: Line[]
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
    const station = stationsById.get(`${topology.operator}-${stop.station}`)
    if (!station) {
      // Topology drift (e.g. a future stop not yet in the DB) must not take
      // the whole line page down.
      console.warn(`[lines] station ${topology.operator}-${stop.station} in topology but not in DB; skipping`)
      return null
    }
    const otherLines = station.lines.filter(l => l.lineCode !== line.lineCode)
    return {
      id: station.id,
      code: station.code,
      name: station.formattedName ?? station.name,
      stationNumber: stop.pos,
      isInterchange: otherLines.length > 0,
      otherLines,
      distanceFromOriginM: stop.cumM ?? null
    }
  }

  const mapStops = (stops: Stop[]): LineDetailStation[] =>
    stops.map(toDetailStation).filter((s): s is LineDetailStation => s !== null)

  const segments: LineDetailSegment[] = [{
    kind: 'TRUNK',
    joinsAtCode: null,
    closesAtCode: null,
    stations: mapStops(topology.path)
  }]

  let seenNonLoop = false
  for (const branch of topology.branches ?? []) {
    const kind = classifyBranch(branch, topology, !seenNonLoop)
    if (kind !== 'LOOP') seenNonLoop = true
    segments.push({
      kind,
      joinsAtCode: branch.fromStation,
      closesAtCode: branch.closeTo ?? null,
      stations: mapStops(branch.path)
    })
  }

  return {
    operator: { code: operator.code, name: operator.name },
    line,
    segments
  }
}
