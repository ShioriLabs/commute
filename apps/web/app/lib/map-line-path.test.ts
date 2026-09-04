import { describe, expect, it } from 'vitest'
import type { Point } from './map-renderer'
import type { LineGeometry, LinesManifest } from './map-line-isolate'
import { TRACED_PATH_MAX_OFFSET_WORLD, prepareLinePaths, sliceLinePath } from './map-line-path'

/*
 * The traced geometry is the tracer's OUTPUT, so these fixtures are written the
 * way build-map-lines.ts emits it: contiguous edges plus an ordered station
 * list, with nothing recording where along the stroke each station sits. That
 * position is recovered by projection, which is the part worth testing.
 */

// A point whose centroid lands exactly at (x, y), matching the route overlay's
// own fixture shape.
function pt(id: string, x: number, y: number, station?: string): Point {
  return { id, station, ax: x - 10, ay: y, bx: x + 10, by: y, r: 5 }
}

// Turn a vertex list into the flat [ax, ay, bx, by] edges the manifest carries.
function edges(...pts: Array<[number, number]>): number[][] {
  const out: number[][] = []
  for (let i = 1; i < pts.length; i++) out.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]])
  return out
}

function line(
  key: string,
  segments: Array<{ kind: string, edges: number[][], markers: string[] }>
): LineGeometry {
  return {
    key,
    operator: key.split(':')[0],
    code: key.split(':')[1],
    name: key,
    color: '#FF0000',
    r: 5,
    segments,
    bbox: [0, 0, 0, 0],
    matchedPairs: 0,
    totalPairs: 0
  }
}

function manifest(...lines: LineGeometry[]): LinesManifest {
  return { version: 'test', pointsVersion: 'test', lines }
}

// A straight east-west trunk with four evenly spaced stops on it.
const TRUNK = line('KCI:C', [{
  kind: 'TRUNK',
  edges: edges([0, 0], [100, 0], [200, 0], [300, 0]),
  markers: ['A', 'B', 'C', 'D']
}])
const TRUNK_POINTS = [pt('A', 0, 0), pt('B', 100, 0), pt('C', 200, 0), pt('D', 300, 0)]

describe('sliceLinePath', () => {
  it('slices the traced stroke between two adjacent stops', () => {
    const prepared = prepareLinePaths(manifest(TRUNK), TRUNK_POINTS)
    expect(sliceLinePath(prepared, 'KCI:C', 'B', 'C')).toEqual([[100, 0], [200, 0]])
  })

  it('keeps the stroke shape between stops that are not adjacent', () => {
    const prepared = prepareLinePaths(manifest(TRUNK), TRUNK_POINTS)
    expect(sliceLinePath(prepared, 'KCI:C', 'A', 'D')).toEqual([[0, 0], [100, 0], [200, 0], [300, 0]])
  })

  /*
   * Direction is the rider's, not the artwork's. The tracer draws each line
   * once, in one direction, so a southbound leg reads the same stroke backwards
   * and the path has to come back in travel order or the route draws itself in
   * reverse.
   */
  it('returns the path in travel order when the leg rides against the drawn direction', () => {
    const prepared = prepareLinePaths(manifest(TRUNK), TRUNK_POINTS)
    expect(sliceLinePath(prepared, 'KCI:C', 'C', 'A')).toEqual([[200, 0], [100, 0], [0, 0]])
  })

  it('follows a corner instead of chording across it', () => {
    const cornered = line('KCI:C', [{
      kind: 'TRUNK',
      edges: edges([0, 0], [100, 0], [100, 100]),
      markers: ['A', 'B', 'C']
    }])
    const prepared = prepareLinePaths(manifest(cornered), [pt('A', 0, 0), pt('B', 100, 0), pt('C', 100, 100)])
    expect(sliceLinePath(prepared, 'KCI:C', 'A', 'C')).toEqual([[0, 0], [100, 0], [100, 100]])
  })

  it('has no path for a line the manifest does not carry', () => {
    const prepared = prepareLinePaths(manifest(TRUNK), TRUNK_POINTS)
    expect(sliceLinePath(prepared, 'TJ:99', 'B', 'C')).toBeNull()
  })

  it('has no path for a stop the line does not serve', () => {
    const prepared = prepareLinePaths(manifest(TRUNK), TRUNK_POINTS)
    expect(sliceLinePath(prepared, 'KCI:C', 'B', 'Z')).toBeNull()
  })

  it('has no path when the two stops resolve to the same spot on the stroke', () => {
    const prepared = prepareLinePaths(manifest(TRUNK), TRUNK_POINTS)
    expect(sliceLinePath(prepared, 'KCI:C', 'B', 'B')).toBeNull()
  })

  /*
   * The gate. Where the trace has a hole, a station projects across the gap
   * onto a stretch of stroke it does not belong to, and slicing from there
   * would draw the route down entirely the wrong piece of artwork. Refusing
   * lets the caller fall back to the corridor matcher, which carries far more
   * slack precisely for these junction breaks.
   */
  it('refuses a stop sitting further off the stroke than the gate allows', () => {
    const off = TRACED_PATH_MAX_OFFSET_WORLD + 10
    const prepared = prepareLinePaths(manifest(TRUNK), [
      pt('A', 0, 0), pt('B', 100, 0), pt('C', 200, off), pt('D', 300, 0)
    ])
    expect(sliceLinePath(prepared, 'KCI:C', 'B', 'C')).toBeNull()
    // Its neighbours are still traced — one bad stop costs its own pairs, not
    // the whole line.
    expect(sliceLinePath(prepared, 'KCI:C', 'A', 'B')).toEqual([[0, 0], [100, 0]])
  })

  it('accepts a stop sitting just inside the gate', () => {
    const prepared = prepareLinePaths(manifest(TRUNK), [
      pt('A', 0, 0), pt('B', 100, 0), pt('C', 200, TRACED_PATH_MAX_OFFSET_WORLD - 1), pt('D', 300, 0)
    ])
    expect(sliceLinePath(prepared, 'KCI:C', 'B', 'C')).toEqual([[100, 0], [200, 0]])
  })

  it('resolves a station drawn under an alias to its own marker', () => {
    const prepared = prepareLinePaths(manifest(TRUNK), [
      pt('A', 0, 0), pt('B-alias', 100, 0, 'B'), pt('C', 200, 0), pt('D', 300, 0)
    ])
    expect(sliceLinePath(prepared, 'KCI:C', 'B', 'C')).toEqual([[100, 0], [200, 0]])
  })
})

describe('sliceLinePath across segments', () => {
  /*
   * A branch shares its junction station with the trunk, so several segments
   * can legitimately contain the same station. The pair belongs to whichever
   * segment actually rides it.
   */
  const branched = line('TJ:9', [
    { kind: 'TRUNK', edges: edges([0, 0], [100, 0], [200, 0]), markers: ['A', 'B', 'J'] },
    { kind: 'RAMP', edges: edges([200, 0], [200, 100]), markers: ['J', 'R'] }
  ])
  const branchedPoints = [pt('A', 0, 0), pt('B', 100, 0), pt('J', 200, 0), pt('R', 200, 100)]

  it('rides the trunk for a trunk pair', () => {
    const prepared = prepareLinePaths(manifest(branched), branchedPoints)
    expect(sliceLinePath(prepared, 'TJ:9', 'B', 'J')).toEqual([[100, 0], [200, 0]])
  })

  it('rides the branch for a branch pair', () => {
    const prepared = prepareLinePaths(manifest(branched), branchedPoints)
    expect(sliceLinePath(prepared, 'TJ:9', 'J', 'R')).toEqual([[200, 0], [200, 100]])
  })

  /*
   * Both stations sit on the trunk AND the trunk is the only segment carrying
   * both, so the ramp must not win merely by touching one of them.
   */
  it('prefers the segment where the pair is adjacent', () => {
    const prepared = prepareLinePaths(manifest(branched), branchedPoints)
    expect(sliceLinePath(prepared, 'TJ:9', 'A', 'J')).toEqual([[0, 0], [100, 0], [200, 0]])
  })
})

describe('sliceLinePath on a stroke drawn in pieces', () => {
  /*
   * Five joints in the shipped manifest jump hundreds of units, where a line's
   * stroke is genuinely drawn in separate pieces. Truncating the segment at the
   * first break strands every station past it — TJ:4's trunk breaks at edge 29
   * of 41, which cost seven consecutive pairs beyond the gap, none of them
   * individually untraceable.
   */
  const broken = line('TJ:4', [{
    kind: 'TRUNK',
    // ...[0,0]→[100,0], then a 400-unit jump, then [500,0]→[600,0].
    edges: [...edges([0, 0], [100, 0]), ...edges([500, 0], [600, 0])],
    markers: ['A', 'B', 'C', 'D']
  }])
  const brokenPoints = [pt('A', 0, 0), pt('B', 100, 0), pt('C', 500, 0), pt('D', 600, 0)]

  it('still slices pairs on the far side of the break', () => {
    const prepared = prepareLinePaths(manifest(broken), brokenPoints)
    expect(sliceLinePath(prepared, 'TJ:4', 'C', 'D')).toEqual([[500, 0], [600, 0]])
  })

  it('still slices pairs before the break', () => {
    const prepared = prepareLinePaths(manifest(broken), brokenPoints)
    expect(sliceLinePath(prepared, 'TJ:4', 'A', 'B')).toEqual([[0, 0], [100, 0]])
  })

  // The line genuinely is not drawn across the gap, so refusing is the honest
  // answer — and it never invents a dash straight through it.
  it('refuses a pair that would have to span the break', () => {
    const prepared = prepareLinePaths(manifest(broken), brokenPoints)
    expect(sliceLinePath(prepared, 'TJ:4', 'B', 'C')).toBeNull()
  })

  /*
   * The joint tolerance has to clear the tracer's own float error. At 0.001 the
   * noise reads as a break, and a line's whole trunk collapses to its first
   * edge while still looking traced — how MRTJ's 50-edge stroke silently lost
   * every pair on the line.
   */
  it('treats a float-noise joint as continuous, not as a break', () => {
    const noisy = line('MRTJ:M', [{
      kind: 'TRUNK',
      edges: [[0, 0, 100, 0], [100.029, 0, 200, 0]],
      markers: ['A', 'B', 'C']
    }])
    const prepared = prepareLinePaths(manifest(noisy), [pt('A', 0, 0), pt('B', 100, 0), pt('C', 200, 0)])
    expect(sliceLinePath(prepared, 'MRTJ:M', 'A', 'C')).not.toBeNull()
  })
})

describe('sliceLinePath on a loop', () => {
  /*
   * A LOOP segment repeats its first station as its last to close the ring, so
   * the same id appears at two positions with different arc lengths. Slicing by
   * station identity would collapse those and pick an arbitrary one; slicing by
   * position in the marker list keeps the ride going the way it is drawn.
   */
  const loop = line('TJ:2', [{
    kind: 'LOOP',
    edges: edges([0, 0], [100, 0], [100, 100], [0, 100], [0, 0]),
    markers: ['A', 'B', 'C', 'D', 'A']
  }])
  const loopPoints = [pt('A', 0, 0), pt('B', 100, 0), pt('C', 100, 100), pt('D', 0, 100)]

  it('rides the loop forward from its first occurrence', () => {
    const prepared = prepareLinePaths(manifest(loop), loopPoints)
    expect(sliceLinePath(prepared, 'TJ:2', 'A', 'B')).toEqual([[0, 0], [100, 0]])
  })

  /*
   * The closing leg. D->A must run the short way to the loop's END, not all the
   * way back round to its start — which is what identity-based slicing would do.
   */
  it('closes the loop through the repeated terminal rather than doubling back', () => {
    const prepared = prepareLinePaths(manifest(loop), loopPoints)
    expect(sliceLinePath(prepared, 'TJ:2', 'D', 'A')).toEqual([[0, 100], [0, 0]])
  })

  /*
   * Resolving the wrap must touch ONLY the closing marker. Sweeping the list
   * and moving any stop that fell behind its predecessor cascades — the opening
   * stop legitimately projects to arc length 0, so the rule fires on the second
   * stop and pins every stop after it to the far end. The whole ring collapses
   * onto one spot and every pair on it falls back, which is what happened to
   * Cikarang's 15 ring pairs.
   */
  it('leaves every stop between the ends on its own stretch of the ring', () => {
    const prepared = prepareLinePaths(manifest(loop), loopPoints)
    expect(sliceLinePath(prepared, 'TJ:2', 'B', 'C')).toEqual([[100, 0], [100, 100]])
    expect(sliceLinePath(prepared, 'TJ:2', 'C', 'D')).toEqual([[100, 100], [0, 100]])
  })
})
