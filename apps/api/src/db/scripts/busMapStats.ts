import * as fs from 'node:fs'
import { decodePolyline, type LngLat } from '../../utils/polyline'
import type { BusMapEdge } from './busMapBundle'

/*
 * How tidy Peta Bus's network is, from the edges as shipped: the yardstick for
 * the drawing (bundling, ordering) between runs. Topology is rebuilt from the
 * edges' ends, which meet exactly at their shared nodes.
 *
 *   pnpm --filter api exec tsx src/db/scripts/busMapStats.ts [path to bus-map.json]
 *
 * Crossings are counted only at nodes, where a line's place across a street can
 * change: two lines carrying on along the same edges in swapped order (same),
 * or two lines parting with the one going left on the right (split).
 */

const KX = Math.cos((-6.2 * Math.PI) / 180) * 111_320
const KY = 110_574

export interface NetworkStats {
  edges: number
  shortEdges: number
  nodes: number
  junctions: number
  sameCrossings: number
  splitCrossings: number
}

interface End {
  edge: number
  /** Whether the edge starts here (else it ends here). */
  start: boolean
  /** Unit direction leaving the node along the edge. */
  dx: number
  dy: number
}

const key = ([lng, lat]: LngLat): string => `${lng.toFixed(5)},${lat.toFixed(5)}`

/** The edge's lines left to right as seen travelling along it away from the node, or towards it. */
function across(edge: BusMapEdge, end: End, leaving: boolean): string[] {
  // Stored left to right along the shape; leaving from its start or arriving at its end is that way.
  const along = end.start === leaving
  return along ? edge.lines : [...edge.lines].reverse()
}

export function networkStats(edges: readonly BusMapEdge[]): NetworkStats {
  const shapes = edges.map(e => decodePolyline(e.shape))
  const at = new Map<string, End[]>()
  let shortEdges = 0
  shapes.forEach((pts, i) => {
    let m = 0
    for (let k = 1; k < pts.length; k++) m += Math.hypot((pts[k]![0] - pts[k - 1]![0]) * KX, (pts[k]![1] - pts[k - 1]![1]) * KY)
    if (m < 50) shortEdges++
    for (const start of [true, false]) {
      const here = start ? pts[0]! : pts[pts.length - 1]!
      // The direction away from the node, over the edge's first ~30 m.
      const seq = start ? pts : [...pts].reverse()
      let to = seq[seq.length - 1]!
      for (const p of seq.slice(1)) {
        if (Math.hypot((p[0] - here[0]) * KX, (p[1] - here[1]) * KY) >= 30) {
          to = p
          break
        }
      }
      const dx = (to[0] - here[0]) * KX
      const dy = (to[1] - here[1]) * KY
      const d = Math.hypot(dx, dy) || 1
      const list = at.get(key(here)) ?? []
      list.push({ edge: i, start, dx: dx / d, dy: dy / d })
      at.set(key(here), list)
    }
  })

  let same = 0
  let split = 0
  let junctions = 0
  for (const ends of at.values()) {
    if (ends.length >= 3) junctions++
    // Each line's two ends here: where it comes from and where it goes. A line on more ends is skipped.
    const ofLine = new Map<string, End[]>()
    for (const end of ends) {
      for (const line of edges[end.edge]!.lines) ofLine.set(line, [...(ofLine.get(line) ?? []), end])
    }
    const through = [...ofLine].filter(([, e]) => e.length === 2)
    for (let i = 0; i < through.length; i++) {
      for (let j = i + 1; j < through.length; j++) {
        const [a, [a1, a2]] = through[i]!
        const [b, [b1, b2]] = through[j]!
        // Look from each edge they share into the node.
        for (const [inA, outA, inB, outB] of [[a1!, a2!, b1!, b2!], [a2!, a1!, b2!, b1!]] as const) {
          if (inA.edge !== inB.edge) continue
          const arriving = across(edges[inA.edge]!, inA, false)
          const aLeftOfB = arriving.indexOf(a) < arriving.indexOf(b)
          if (outA.edge === outB.edge) {
            const leaving = across(edges[outA.edge]!, outA, true)
            if ((leaving.indexOf(a) < leaving.indexOf(b)) !== aLeftOfB) same++
          } else {
            // Arriving along -in, is A's way out to the left of B's? Compare the turn angles.
            const hx = -inA.dx
            const hy = -inA.dy
            const turn = (o: End): number => Math.atan2(hx * o.dy - hy * o.dx, hx * o.dx + hy * o.dy)
            const aGoesLeft = turn(outA) > turn(outB)
            if (aGoesLeft !== aLeftOfB) split++
          }
        }
      }
    }
  }
  // Each same-edge pair was seen from both of its sides: count it once.
  return {
    edges: edges.length,
    shortEdges,
    nodes: at.size,
    junctions,
    sameCrossings: Math.round(same / 2),
    splitCrossings: split
  }
}

if (require.main === module) {
  const file = process.argv[2] ?? `${__dirname}/../../../../web/app/data/bus-map.json`
  const map = JSON.parse(fs.readFileSync(file, 'utf-8')) as { edges: BusMapEdge[] }
  console.log(networkStats(map.edges))
}
