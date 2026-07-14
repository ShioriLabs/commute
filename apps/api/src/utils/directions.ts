import {
  BOUND_FOR_STATION_ALIASES,
  DIRECTION_LABEL_BOOST_STATIONS,
  OFF_TOPOLOGY_TERMINUS_PROXIES,
  Operator
} from '@commute/constants'
import { TOPOLOGY, LineTopology } from 'db/data/topology'
import { GroupingSchedule } from 'db/schemas/schedules'

// A terminus needs this much daily service to define a group's spine (and thus
// its label). Rare diversions (3 late-night Jakarta Kota trains) must not own
// the label; busy near short-turns (Angke) must not truncate it either.
const SPINE_MIN_TRAINS_PER_DAY = 5

// Label = first N prominent stops + the spine end.
const LABEL_MAX_LEADING_STOPS = 2

// The Cikarang loop's two sides, used to derive the canonical via from a
// walked path. The raw API via string only exists at Bekasi-interlining
// stations; via-less Angke trains must still merge with "via Manggarai" ones.
const LOOP_DISCRIMINATORS: Record<string, [string, string]> = {
  'KCI:C': ['MRI', 'PSE']
}

const VIA_NAME_TO_CODE: Record<string, string> = {
  'Manggarai': 'MRI',
  'Pasar Senen': 'PSE'
}

export interface LineGraph {
  adjacency: Map<string, string[]>
  degree: Map<string, number>
}

export function buildLineGraph(topology: LineTopology): LineGraph {
  const adjacency = new Map<string, string[]>()

  const addEdge = (a: string, b: string) => {
    const fromA = adjacency.get(a) ?? []
    if (!fromA.includes(b)) fromA.push(b)
    adjacency.set(a, fromA)
    const fromB = adjacency.get(b) ?? []
    if (!fromB.includes(a)) fromB.push(a)
    adjacency.set(b, fromB)
  }

  for (let i = 0; i < topology.path.length - 1; i++) {
    addEdge(topology.path[i]!.station, topology.path[i + 1]!.station)
  }
  for (const branch of topology.branches ?? []) {
    const sequence = [branch.fromStation, ...branch.path.map(stop => stop.station)]
    if (branch.closeTo) sequence.push(branch.closeTo)
    for (let i = 0; i < sequence.length - 1; i++) {
      addEdge(sequence[i]!, sequence[i + 1]!)
    }
  }

  const degree = new Map<string, number>()
  for (const [station, neighbors] of adjacency) {
    degree.set(station, neighbors.length)
  }
  return { adjacency, degree }
}

// Topology is static per isolate, so the derived graph is too. Memoize it
// keyed by (operator, lineCode) — the grouped-timetable path builds this on
// every cache miss otherwise (mirrors fares.ts cachedGraph).
const lineGraphCache = new Map<string, LineGraph>()

export function getLineGraph(operator: Operator, lineCode: string, topology: LineTopology): LineGraph {
  const key = `${operator}:${lineCode}`
  let graph = lineGraphCache.get(key)
  if (!graph) {
    graph = buildLineGraph(topology)
    lineGraphCache.set(key, graph)
  }
  return graph
}

export function bfsPath(
  graph: LineGraph,
  from: string,
  to: string,
  banned?: ReadonlySet<string>
): string[] | null {
  if (from === to) return [from]
  if (!graph.adjacency.has(from) || !graph.adjacency.has(to)) return null

  const previous = new Map<string, string | null>([[from, null]])
  const queue = [from]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const next of graph.adjacency.get(current) ?? []) {
      if (previous.has(next) || banned?.has(next)) continue
      previous.set(next, current)
      if (next === to) {
        const path = [to]
        while (previous.get(path[path.length - 1]!) !== null) {
          path.push(previous.get(path[path.length - 1]!)!)
        }
        return path.reverse()
      }
      queue.push(next)
    }
  }
  return null
}

// Route through the via station when given, so "Kampung Bandan via Pasar
// Senen" walks the correct loop side even when it isn't the shortest.
export function viaAwarePath(
  graph: LineGraph,
  from: string,
  to: string,
  viaCode: string | null
): string[] | null {
  if (viaCode && viaCode !== from && viaCode !== to && graph.adjacency.has(viaCode)) {
    const firstLeg = bfsPath(graph, from, viaCode)
    if (firstLeg) {
      const banned = new Set(firstLeg.slice(0, -1))
      banned.delete(to)
      const secondLeg = bfsPath(graph, viaCode, to, banned)
      if (secondLeg) return [...firstLeg, ...secondLeg.slice(1)]
    }
  }
  return bfsPath(graph, from, to)
}

export function normalizeStationName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export interface StationNameIndex {
  byNormalizedName: Map<string, string>
  displayNameByCode: Map<string, string>
}

export function buildStationNameIndex(
  rows: { code: string, name: string, formattedName: string | null }[]
): StationNameIndex {
  const byNormalizedName = new Map<string, string>()
  const displayNameByCode = new Map<string, string>()
  for (const row of rows) {
    byNormalizedName.set(normalizeStationName(row.name), row.code)
    if (row.formattedName) byNormalizedName.set(normalizeStationName(row.formattedName), row.code)
    displayNameByCode.set(row.code, row.formattedName ?? row.name)
  }
  return { byNormalizedName, displayNameByCode }
}

export function resolveBoundForCode(boundFor: string, index: StationNameIndex): string | null {
  const normalized = normalizeStationName(boundFor)
  return BOUND_FOR_STATION_ALIASES[normalized] ?? index.byNormalizedName.get(normalized) ?? null
}

// Stations serving more than one of the operator's TOPOLOGY lines read as
// interchanges in direction labels.
export function buildLineMembershipCount(operator: Operator): Map<string, number> {
  const lineCodesByStation = new Map<string, Set<string>>()
  for (const topology of TOPOLOGY) {
    if (topology.operator !== operator) continue
    const stops = [
      ...topology.path,
      ...(topology.branches ?? []).flatMap(branch => branch.path)
    ]
    for (const stop of stops) {
      const lineCodes = lineCodesByStation.get(stop.station) ?? new Set()
      lineCodes.add(topology.lineCode)
      lineCodesByStation.set(stop.station, lineCodes)
    }
  }
  const counts = new Map<string, number>()
  for (const [station, lineCodes] of lineCodesByStation) {
    counts.set(station, lineCodes.size)
  }
  return counts
}

export interface BoundForEntry {
  boundFor: string
  via: string | null
  // Only the grouping-relevant fields are read here (tripNumber); full Schedule
  // rows also satisfy this, so both compact and full callers pass through.
  schedules: GroupingSchedule[]
}

export interface DirectionGroupCore {
  key: string
  label: string[]
  nextHopCode: string | null
  destinations: BoundForEntry[]
}

export function syntheticGroup(entry: BoundForEntry): DirectionGroupCore {
  return {
    key: `SYN:${entry.boundFor}:${entry.via ?? ''}`,
    label: [entry.boundFor],
    nextHopCode: null,
    destinations: [entry]
  }
}

interface WalkedDestination extends BoundForEntry {
  path: string[]
  proxied: boolean
}

export function groupDirections(params: {
  operator: Operator
  lineCode: string
  stationCode: string
  topology: LineTopology | null
  entries: BoundForEntry[]
  nameIndex: StationNameIndex | null
  lineMembershipCount: Map<string, number>
}): DirectionGroupCore[] {
  const { operator, lineCode, stationCode, topology, entries, nameIndex, lineMembershipCount } = params

  const graph = topology ? getLineGraph(operator, lineCode, topology) : null
  const hasViaSplitEntries = entries.some(entry => entry.via !== null)
  const discriminators = LOOP_DISCRIMINATORS[`${operator}:${lineCode}`]

  const synthetic: DirectionGroupCore[] = []
  const walkedGroups = new Map<string, WalkedDestination[]>()

  const addWalked = (entry: BoundForEntry, walkTarget: string, viaCode: string | null, proxied: boolean) => {
    let path = viaAwarePath(graph!, stationCode, walkTarget, viaCode)
    if (path && !viaCode && discriminators) {
      // Loop equidistance (Angke sits exactly opposite Jatinegara) resolves
      // to the Manggarai side, matching actual service patterns.
      const preferred = viaAwarePath(graph!, stationCode, walkTarget, discriminators[0])
      if (preferred && preferred.length === path.length) path = preferred
    }
    if (!path || path.length < 2) {
      synthetic.push(syntheticGroup(entry))
      return
    }
    let canonicalVia = ''
    if (discriminators) {
      const interior = path.slice(1)
      if (interior.includes(discriminators[0])) canonicalVia = discriminators[0]
      else if (interior.includes(discriminators[1])) canonicalVia = discriminators[1]
    }
    const key = `${path[1]}:${canonicalVia}`
    const group = walkedGroups.get(key) ?? []
    group.push({ ...entry, path, proxied })
    walkedGroups.set(key, group)
  }

  for (const entry of entries) {
    if (!graph || !nameIndex) {
      synthetic.push(syntheticGroup(entry))
      continue
    }
    const destinationCode = resolveBoundForCode(entry.boundFor, nameIndex)
    if (!destinationCode || destinationCode === stationCode) {
      synthetic.push(syntheticGroup(entry))
      continue
    }
    const viaCode = entry.via ? VIA_NAME_TO_CODE[entry.via] ?? null : null

    if (graph.adjacency.has(destinationCode)) {
      addWalked(entry, destinationCode, viaCode, false)
      continue
    }

    const proxy = OFF_TOPOLOGY_TERMINUS_PROXIES[`${operator}:${lineCode}:${destinationCode}`]
    if (!proxy || proxy.walkToward === stationCode) {
      synthetic.push(syntheticGroup(entry))
      continue
    }
    if (proxy.viaFromTripPrefix && viaCode === null && hasViaSplitEntries) {
      // The station distinguishes loop sides; split the proxied trains the
      // same way the interlining rule does (by trip-number prefix).
      const { prefix, via, elseVia } = proxy.viaFromTripPrefix
      const onPrefix = entry.schedules.filter(s => (s.tripNumber ?? '').startsWith(prefix))
      const offPrefix = entry.schedules.filter(s => !(s.tripNumber ?? '').startsWith(prefix))
      if (onPrefix.length > 0) addWalked({ ...entry, schedules: onPrefix }, proxy.walkToward, via, true)
      if (offPrefix.length > 0) addWalked({ ...entry, schedules: offPrefix }, proxy.walkToward, elseVia, true)
    } else {
      addWalked(entry, proxy.walkToward, viaCode, true)
    }
  }

  // Spine per group: path of the farthest terminus with meaningful service.
  const spines = new Map<string, WalkedDestination>()
  for (const [key, destinations] of walkedGroups) {
    const qualifying = destinations.filter(d => d.schedules.length >= SPINE_MIN_TRAINS_PER_DAY)
    const pool = qualifying.length > 0 ? qualifying : destinations
    const owner = pool.reduce((best, candidate) =>
      candidate.path.length > best.path.length
      || (candidate.path.length === best.path.length && candidate.schedules.length > best.schedules.length)
        ? candidate
        : best
    )
    spines.set(key, owner)
  }

  // A station lying on two or more sibling spines distinguishes nothing
  // (Jatinegara sits on both westbound walks out of Cakung).
  const interiorCounts = new Map<string, number>()
  for (const owner of spines.values()) {
    for (const code of new Set(owner.path.slice(1, -1))) {
      interiorCounts.set(code, (interiorCounts.get(code) ?? 0) + 1)
    }
  }

  const groups: DirectionGroupCore[] = []
  for (const [key, destinations] of walkedGroups) {
    const owner = spines.get(key)!
    const spine = owner.path
    const spineEnd = spine[spine.length - 1]!

    const terminusTrains = new Map<string, number>()
    for (const destination of destinations) {
      const terminus = destination.path[destination.path.length - 1]!
      terminusTrains.set(terminus, (terminusTrains.get(terminus) ?? 0) + destination.schedules.length)
    }

    let labelCodes = spine.slice(1).filter((code) => {
      if (code !== spineEnd && (interiorCounts.get(code) ?? 0) >= 2) return false
      return (lineMembershipCount.get(code) ?? 0) > 1
        || (graph!.degree.get(code) ?? 0) >= 3
        || DIRECTION_LABEL_BOOST_STATIONS.has(`${operator}:${code}`)
        || (terminusTrains.get(code) ?? 0) >= SPINE_MIN_TRAINS_PER_DAY
        || code === spineEnd
    })
    if (labelCodes.length > LABEL_MAX_LEADING_STOPS + 1) {
      labelCodes = [...labelCodes.slice(0, LABEL_MAX_LEADING_STOPS), spineEnd]
    }

    const label = labelCodes.map(code => nameIndex!.displayNameByCode.get(code) ?? code)
    if (owner.proxied && labelCodes[labelCodes.length - 1] === spineEnd) {
      // The real terminus lies beyond the routable topology.
      label[label.length - 1] = owner.boundFor
    }

    groups.push({
      key,
      label,
      nextHopCode: spine[1]!,
      destinations: [...destinations]
        .sort((a, b) => b.path.length - a.path.length)
        .map(({ boundFor, via, schedules }) => ({ boundFor, via, schedules }))
    })
  }

  const totalTrains = (group: DirectionGroupCore) =>
    group.destinations.reduce((sum, destination) => sum + destination.schedules.length, 0)

  return [...groups, ...synthetic].sort((a, b) =>
    totalTrains(b) - totalTrains(a) || a.key.localeCompare(b.key)
  )
}
