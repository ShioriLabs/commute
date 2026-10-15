import type { TripPattern } from '../../data/trips'

/*
 * Where the commute goes. Distance from these drives the station role: a
 * station far from them is a place people leave in the morning, one near them
 * is a place people arrive. Picked from KCI's own "stasiun tujuan perkantoran"
 * list in its 2026 releases (Sudirman, Juanda, Gondangdia, Palmerah) plus
 * the integration hubs the commute flows through (Manggarai, Tanah Abang, and
 * Duri, where the Tangerang line meets the loop) and the MRT/LRT counterparts
 * at Dukuh Atas.
 */
export const CORE_STATIONS = [
  'KCI-MRI', 'KCI-SUD', 'KCI-SUDB', 'KCI-THB', 'KCI-JUA', 'KCI-GDD', 'KCI-PLM', 'KCI-DU',
  'MRTJ-DKA', 'LRTJBDB-DKA'
] as const

/*
 * Minutes added per change of pattern at a shared station. It stands in for walking
 * and waiting. It's only a ranking input, so the exact value matters little.
 */
export const TRANSFER_PENALTY_MIN = 5

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/*
 * Scheduled ride minutes from every station to its NEAREST core station,
 * Dijkstra over pattern hops weighted by the median hop time across trips.
 * Edges are undirected: a morning ride in and an evening ride out take the same
 * time, and some patterns only exist in one direction in TRIP_PATTERNS.
 * Stations with no path (the LRT Jakarta island) are absent; callers fall back.
 */
export function rideMinutesToCore(patterns: TripPattern[], core: readonly string[] = CORE_STATIONS): Map<string, number> {
  // Each node is (pattern index, station); changing pattern at a station costs the penalty.
  const edges = new Map<string, { to: string, w: number }[]>()
  const link = (a: string, b: string, w: number) => {
    if (!edges.has(a)) edges.set(a, [])
    if (!edges.has(b)) edges.set(b, [])
    edges.get(a)!.push({ to: b, w })
    edges.get(b)!.push({ to: a, w })
  }
  const nodesAt = new Map<string, string[]>()
  patterns.forEach((p, pi) => {
    p.stations.forEach((st, i) => {
      const node = `${pi}|${st}`
      nodesAt.set(st, [...(nodesAt.get(st) ?? []), node])
      if (i === 0) return
      const hops = p.trips.map(t => (t.s[i]! - t.s[i - 1]!) / 60).filter(x => x >= 0)
      if (hops.length) link(`${pi}|${p.stations[i - 1]}`, node, median(hops)!)
    })
  })
  for (const nodes of nodesAt.values()) {
    for (let i = 1; i < nodes.length; i++) link(nodes[0]!, nodes[i]!, TRANSFER_PENALTY_MIN)
  }

  const dist = new Map<string, number>()
  const queue: [string, number][] = []
  for (const st of core) {
    for (const node of nodesAt.get(st) ?? []) {
      dist.set(node, 0)
      queue.push([node, 0])
    }
  }
  while (queue.length) {
    queue.sort((a, b) => a[1] - b[1])
    const [node, d] = queue.shift()!
    if (d > (dist.get(node) ?? Infinity)) continue
    for (const { to, w } of edges.get(node) ?? []) {
      const nd = d + w
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd)
        queue.push([to, nd])
      }
    }
  }

  const out = new Map<string, number>()
  for (const [st, nodes] of nodesAt) {
    const best = Math.min(...nodes.map(n => dist.get(n) ?? Infinity))
    if (Number.isFinite(best)) out.set(st, Math.round(best))
  }
  return out
}
