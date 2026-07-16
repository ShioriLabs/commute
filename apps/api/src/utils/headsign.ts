import { Operator } from '@commute/constants'
import { LineTopology } from 'db/data/topology'
import { getLineGraph } from 'utils/directions'
import { findTopology } from 'utils/topology'

// Mid-loop service termini. Cikarang-loop trains terminate at Kampung Bandan
// (via Pasar Senen) or Angke (via Manggarai), not at a graph terminus, so the
// direction walk must stop there instead of circling out the mouth. Service
// knowledge in the spirit of LOOP_DISCRIMINATORS in utils/directions.ts.
const LOOP_SERVICE_TERMINI: Record<string, string[]> = {
  'KCI:C': ['KPB', 'AK']
}

// The loop's two sides. A leg that enters the loop through its mouth needs a
// via to tell the rider which train to board — both sides depart the same way
// at the mouth. Mirrors LOOP_DISCRIMINATORS in utils/directions.ts.
const LOOP_VIA_DISCRIMINATORS: Record<string, [string, string]> = {
  'KCI:C': ['MRI', 'PSE']
}

export interface Headsign {
  code: string
  // Set when the boarding station is outside the loop and the terminus is a
  // mid-loop one, so "Kampung Bandan" reads "Kampung Bandan via Pasar Senen".
  viaCode: string | null
}

// Trunk spine: the topology path extended by its continuation branch (the
// first non-loop branch off the trunk's end — Bogor past Citayam), mirroring
// classifyBranch in utils/topology.ts. Used to break junction forks toward
// the mainline service.
function buildTrunkSpine(topology: LineTopology): string[] {
  const spine = topology.path.map(stop => stop.station)
  const firstNonLoop = (topology.branches ?? []).find(branch => !branch.closeTo)
  if (firstNonLoop && firstNonLoop.fromStation === spine[spine.length - 1]) {
    spine.push(...firstNonLoop.path.map(stop => stop.station))
  }
  return spine
}

// The terminus a leg's train heads toward, found by extending the leg's
// travel direction along the line graph until the line ends or a mid-loop
// service terminus is reached. Null when no single direction can be resolved:
// off-topology lines, walks that close a loop, or ambiguous junction forks.
export function computeHeadsignCode(
  operator: Operator,
  lineCode: string,
  stationCodes: string[]
): Headsign | null {
  if (stationCodes.length < 2) return null
  const topology = findTopology(operator, lineCode)
  if (!topology) return null

  const graph = getLineGraph(operator, lineCode, topology)
  let prev = stationCodes[stationCodes.length - 2]!
  let current = stationCodes[stationCodes.length - 1]!
  if (!graph.adjacency.has(current)) return null

  const lineKey = `${operator}:${lineCode}`
  const serviceTermini = new Set(LOOP_SERVICE_TERMINI[lineKey] ?? [])
  const loopInterior = new Set(
    (topology.branches ?? [])
      .filter(branch => branch.closeTo)
      .flatMap(branch => branch.path.map(stop => stop.station))
  )
  const spine = buildTrunkSpine(topology)
  const visited = new Set(stationCodes)

  const finish = (code: string): Headsign => {
    // Boarding inside the loop already fixes the side; no via needed.
    if (!serviceTermini.has(code) || loopInterior.has(stationCodes[0]!)) {
      return { code, viaCode: null }
    }
    const via = (LOOP_VIA_DISCRIMINATORS[lineKey] ?? [])
      .find(discriminator => discriminator !== code && visited.has(discriminator))
    return { code, viaCode: via ?? null }
  }

  for (let step = 0; step <= graph.adjacency.size; step++) {
    if (serviceTermini.has(current)) return finish(current)
    const forward = (graph.adjacency.get(current) ?? []).filter(code => code !== prev)
    if (forward.length === 0) return finish(current) // reached the line's terminus
    const candidates = forward.filter(code => !visited.has(code))
    if (candidates.length === 0) return null // walk closed a loop

    let next: string
    if (candidates.length === 1) {
      next = candidates[0]!
    } else {
      // Junction fork (Citayam): follow the mainline; ambiguous forks (loop
      // mouths like Jatinegara) get no headsign.
      const index = spine.indexOf(current)
      const mainline = candidates.filter(code =>
        index !== -1 && (spine[index - 1] === code || spine[index + 1] === code)
      )
      if (mainline.length !== 1) return null
      next = mainline[0]!
    }
    visited.add(next)
    prev = current
    current = next
  }
  return null
}
