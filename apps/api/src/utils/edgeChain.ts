import type { LineTopology, Stop } from '../db/data/topology'

/*
 * One adjacency generateEdgesSQL turns into edge rows.
 *
 * `via` lists the stops a vehicle runs THROUGH without calling, in travel
 * order, so the caller can price the hop as the track it actually covers
 * rather than a straight line between its ends.
 */
export interface Hop {
  from: Stop
  to: Stop
  via: Stop[]
  bothWays: boolean
  /** Which walk produced a one-way hop; absent when `bothWays`. */
  direction?: 'forward' | 'reverse'
}

/*
 * The hops a stop list describes, honouring `Stop.serves` and `Stop.passThrough`.
 *
 * A list with no directional stop is paired up exactly as it always was, one
 * hop per neighbour pair, emitted both ways, with any pass-through stops folded
 * into the hop that runs past them. A list with one is walked once per
 * direction instead, each walk leaving out the stops that direction does not
 * serve, so the unserved direction gets a single hop straight past them.
 *
 * Kept free of coordinates and SQL so the rule can be tested on its own.
 */
export function chainHops(stops: Stop[]): Hop[] {
  const ends = [stops[0], stops[stops.length - 1]]
  const unserved = ends.find(s => s?.passThrough)
  if (unserved) {
    throw new Error(`${unserved.station} is passed through but sits at the end of the list, so there is nothing to bridge to`)
  }

  if (!stops.some(s => s.serves)) {
    return walk(stops, 'forward').map(({ from, to, via }) => ({ from, to, via, bothWays: true }))
  }

  const stranded = ends.find(s => s?.serves)
  if (stranded) {
    throw new Error(`${stranded.station} is served one way only but sits at the end of the list, so there is nothing to bridge to`)
  }
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!
    const b = stops[i]!
    if (a.serves && a.serves === b.serves) {
      throw new Error(`${a.station} and ${b.station} are both skipped in the same direction; model a skip-stop run like line A instead`)
    }
  }

  return [
    ...walk(stops, 'forward'),
    ...walk([...stops].reverse(), 'reverse')
  ]
}

function walk(ordered: Stop[], direction: 'forward' | 'reverse'): Hop[] {
  const hops: Hop[] = []
  let from = ordered[0]!
  let via: Stop[] = []
  for (const stop of ordered.slice(1)) {
    if (stop.passThrough || (stop.serves && stop.serves !== direction)) {
      via.push(stop)
      continue
    }
    hops.push({ from, to: stop, via, bothWays: false, direction })
    from = stop
    via = []
  }
  return hops
}

/*
 * The stop lists a line is chained from: its `path`, then each branch as one
 * list running junction -> branch stops -> closure. Chaining a branch whole,
 * rather than as three pieces, is what lets a directional stop sit next to a
 * junction and still have a neighbour to bridge to.
 *
 * Not for `pathReverse` lines, whose two chains are already directional.
 */
export function stopLists(line: LineTopology): Stop[][] {
  const byCode = new Map<string, Stop>()
  for (const s of line.path) byCode.set(s.station, s)
  for (const b of line.branches ?? []) for (const s of b.path) byCode.set(s.station, s)
  return [
    line.path,
    ...(line.branches ?? []).map((br) => {
      const junction = byCode.get(br.fromStation)
      const close = br.closeTo ? byCode.get(br.closeTo) : undefined
      return [...(junction ? [junction] : []), ...br.path, ...(close ? [close] : [])]
    })
  ]
}

/*
 * The U-turns a one-way stop creates, as (from, via, to) station codes.
 *
 * Once PSE is served northbound only, PSE -> KMO -> GST and KMO -> GST -> PSE
 * are the only same-line ways between those stops — and both are really two
 * trains, out one way and back the other. On one line code the planner cannot
 * tell, so each is charged a boarding as a service break (see SERVICE_BREAKS).
 *
 * A turn is a one-way hop into a stop followed by one out of it in the other
 * direction. Straight back to where it came from is left out: that revisits a
 * stop, and no search keeps it.
 */
export function oneWayTurns(line: LineTopology): { from: string, via: string, to: string }[] {
  if (line.pathReverse) return []
  const turns: { from: string, via: string, to: string }[] = []
  for (const list of stopLists(line)) {
    const hops = chainHops(list).filter(h => !h.bothWays)
    for (const into of hops) {
      for (const out of hops) {
        if (out.from !== into.to || out.direction === into.direction || out.to === into.from) continue
        turns.push({ from: into.from.station, via: into.to.station, to: out.to.station })
      }
    }
  }
  return turns
}
