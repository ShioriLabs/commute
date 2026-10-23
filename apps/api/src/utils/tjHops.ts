import { TOPOLOGY, type LineTopology } from '../db/data/topology'
import { chainHops, stopLists } from './edgeChain'

/** Same values as observedHeadways/snapshots.ts `Dir`, which runtime code does not import. */
export type Dir = 'F' | 'R'

/*
 * TransJakarta's directed hops, as generateEdgesSQL emits them: which lines run
 * stop -> next, and in which of their directions.
 *
 * Built from the same chainHops/stopLists the edges come from, so the lines this
 * names on a hop are exactly the lines the search finds edges for there. The
 * direction is the observed-headway one (observedHeadways/arrivals.ts
 * buildOrder): F along `path`, R along `pathReverse` or `path` backwards.
 */

/** One line-direction's hops in travel order, as full station ids. */
export interface TjChain {
  lineCode: string
  dir: Dir
  hops: [from: string, to: string][]
}

const id = (code: string) => `TJ-${code}`

/** One TJ line's chains, F then R per stop list. Exported for its tests. */
export function chainsOf(line: LineTopology): TjChain[] {
  if (line.pathReverse) {
    return [
      { lineCode: line.lineCode, dir: 'F', hops: chainHops(line.path).map(h => [id(h.from.station), id(h.to.station)]) },
      { lineCode: line.lineCode, dir: 'R', hops: chainHops(line.pathReverse).map(h => [id(h.from.station), id(h.to.station)]) }
    ]
  }
  return stopLists(line).flatMap((list) => {
    const hops = chainHops(list)
    const forward = hops.filter(h => h.bothWays || h.direction === 'forward')
    const reverse = hops.filter(h => h.bothWays || h.direction === 'reverse')
    return [
      { lineCode: line.lineCode, dir: 'F' as const, hops: forward.map((h): [string, string] => [id(h.from.station), id(h.to.station)]) },
      {
        lineCode: line.lineCode,
        dir: 'R' as const,
        hops: reverseChain(reverse)
      }
    ]
  })
}

/*
 * A list's R hops in R travel order. chainHops gives either both-ways hops,
 * listed once forwards, which are flipped and taken in reverse order; or, on a
 * list with a one-way stop, a walk already made in R order, kept as it is.
 */
function reverseChain(hops: ReturnType<typeof chainHops>): [string, string][] {
  if (!hops.some(h => h.bothWays)) return hops.map(h => [id(h.from.station), id(h.to.station)])
  return hops.map((h): [string, string] => [id(h.to.station), id(h.from.station)]).reverse()
}

let chains: TjChain[] | undefined
let hopIndex: Map<string, Map<string, Dir>> | undefined

/** Every TJ line-direction chain. Branch lists are chains of their own. */
export function tjChains(): TjChain[] {
  return chains ??= TOPOLOGY.filter(line => line.operator === 'TJ').flatMap(chainsOf)
}

/** `${from}>${to}` -> line code -> direction, for every TJ hop. */
export function tjHopLines(): Map<string, Map<string, Dir>> {
  if (hopIndex) return hopIndex
  hopIndex = new Map()
  for (const chain of tjChains()) {
    for (const [from, to] of chain.hops) {
      const key = `${from}>${to}`
      let lines = hopIndex.get(key)
      if (!lines) hopIndex.set(key, lines = new Map())
      lines.set(chain.lineCode, chain.dir)
    }
  }
  return hopIndex
}

/**
 * A shared stretch's key: where the rider boards, which way (the same lines
 * pass a median halte in both directions, as two streams of buses), and the
 * lines, sorted. headways.shared.ts is keyed by it.
 */
export const sharedKey = (stop: string, next: string, lines: readonly string[]) => `${stop}>${next}|${[...lines].sort().join(',')}`

/** The direction `lineCode` runs `from -> to` in, or undefined when it has no such hop. */
export const tjDirOf = (lineCode: string, from: string, to: string): Dir | undefined =>
  tjHopLines().get(`${from}>${to}`)?.get(lineCode)
