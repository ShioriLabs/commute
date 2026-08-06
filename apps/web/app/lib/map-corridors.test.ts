import { describe, expect, it } from 'vitest'
import corridorsManifest from '../data/map-corridors.json'
import {
  CORRIDOR_MATCH_MAX_DIST_WORLD,
  extractSubPolyline,
  matchCorridorPath,
  pickLegCorridor,
  polylineLength,
  prepareCorridor,
  prepareCorridors,
  projectOntoPolyline,
  type Corridor
} from './map-corridors'

// The matcher decides which drawn corridor a leg follows using nothing but
// geometry — corridors carry no line identity — so these tests are the only
// thing standing between a curved route and a confidently wrong one.

const prep = (pts: Array<[number, number]>, w = 25) => prepareCorridor({ w, pts })

// Coordinates come out of interpolation, so compare with a tolerance rather
// than on exact floats.
const expectPointsClose = (actual: Array<[number, number]>, expected: Array<[number, number]>) => {
  expect(actual).toHaveLength(expected.length)
  actual.forEach(([x, y], i) => {
    expect(x).toBeCloseTo(expected[i][0], 6)
    expect(y).toBeCloseTo(expected[i][1], 6)
  })
}

describe('projectOntoPolyline', () => {
  it('finds the perpendicular foot on a straight segment', () => {
    expect(projectOntoPolyline(50, 7, prep([[0, 0], [100, 0]]))).toEqual({ dist: 7, s: 50 })
  })

  it('clamps to the segment rather than its infinite line', () => {
    // Without the clamp a stop far past a corridor's end would project onto the
    // extended line at distance 0 and match a corridor it never touches.
    expect(projectOntoPolyline(140, 0, prep([[0, 0], [100, 0]]))).toEqual({ dist: 40, s: 100 })
  })

  it('accumulates arc length across vertices', () => {
    // Foot lands just past the corner, so `s` has to carry the first leg's full
    // 100 units rather than restarting per segment.
    const { dist, s } = projectOntoPolyline(103, 3, prep([[0, 0], [100, 0], [100, 100]]))
    expect(dist).toBeCloseTo(3, 6)
    expect(s).toBeCloseTo(103, 6)
  })

  it('survives a zero-length segment without NaN', () => {
    // Duplicate points occur in generated geometry; a 0/0 in the projection
    // would poison every downstream comparison silently.
    const { dist, s } = projectOntoPolyline(10, 5, prep([[0, 0], [0, 0], [50, 0]]))
    expect(Number.isFinite(dist)).toBe(true)
    expect(Number.isFinite(s)).toBe(true)
    expect(dist).toBeCloseTo(5, 6)
  })
})

describe('extractSubPolyline', () => {
  const lShape = prep([[0, 0], [100, 0], [100, 100]])

  it('interpolates both ends and keeps the vertices between', () => {
    expectPointsClose(extractSubPolyline(lShape, 50, 150), [[50, 0], [100, 0], [100, 50]])
  })

  it('returns the reverse array when travelling against the drawn direction', () => {
    // A leg riding the corridor backwards must come back in travel order, or
    // the polyline would render from the destination to the origin.
    const forward = extractSubPolyline(lShape, 50, 150)
    expectPointsClose(extractSubPolyline(lShape, 150, 50), [...forward].reverse())
  })

  it('handles a span inside a single segment', () => {
    expectPointsClose(extractSubPolyline(lShape, 20, 80), [[20, 0], [80, 0]])
  })

  it('returns nothing when both feet land on the same spot', () => {
    // Degenerate: the caller falls back to a chord rather than drawing a
    // zero-length segment.
    expect(extractSubPolyline(lShape, 40, 40)).toEqual([])
  })
})

describe('polylineLength', () => {
  it('sums the segments', () => {
    expect(polylineLength([[0, 0], [3, 0], [3, 4]])).toBe(7)
  })
})

describe('matchCorridorPath', () => {
  it('follows the corridor between two stops on it', () => {
    const corridors = prepareCorridors([{ w: 25, pts: [[0, 0], [100, 0], [100, 100]] }])
    const path = matchCorridorPath(0, 0, 100, 100, corridors)?.path
    expectPointsClose(path!, [[0, 0], [100, 0], [100, 100]])
  })

  /*
   * The Jatinegara trap, in miniature.
   *
   * On the real map the Cikarang main line runs straight through Jatinegara
   * while the train being drawn takes the branch, and the through line projects
   * CLOSER to the station than the branch does. Nearest-stroke matching picks
   * the through line; only the partner stop reveals which is right.
   *
   * Both directions share one corridor pair on purpose — that is what makes
   * this a trap test rather than two unrelated assertions.
   */
  describe('the Jatinegara through-line trap', () => {
    const throughLine: Corridor = { w: 25, pts: [[-1000, 0], [1000, 0]] }
    const branch: Corridor = { w: 25, pts: [[0, 0], [0, -500], [400, -500]] }
    const corridors = prepareCorridors([throughLine, branch])
    // 1 unit off the through line, 1 unit off the branch — nearest-stroke is a
    // coin flip here, and on the real map it lands on the wrong side.
    const junction = { x: 0, y: 1 }

    it('takes the branch when the partner stop is down the branch', () => {
      const path = matchCorridorPath(junction.x, junction.y, 0, -498, corridors)?.path ?? null
      expect(path).not.toBeNull()
      // Ends at the partner, and turns the corner rather than running along y≈0.
      expect(path![path!.length - 1][1]).toBeCloseTo(-498, 0)
      expect(path!.every(([x]) => Math.abs(x) < 1)).toBe(true)
    })

    it('takes the through line when the partner stop is along it', () => {
      const path = matchCorridorPath(junction.x, junction.y, 600, 0, corridors)?.path ?? null
      expect(path).not.toBeNull()
      expect(path![path!.length - 1][0]).toBeCloseTo(600, 0)
      // Never dives down the branch.
      expect(path!.every(([, y]) => Math.abs(y) < 1)).toBe(true)
    })
  })

  /*
   * Detour rejection: a corridor whose two feet are 10 units apart in space but
   * ~1590 units apart along the polyline. Matching on proximity alone would
   * draw the entire loop to connect two adjacent stops.
   */
  describe('detour rejection', () => {
    const loop: Corridor = { w: 25, pts: [[0, 0], [0, 400], [400, 400], [400, 0], [10, 0]] }

    it('rejects the long way round and falls back to a chord', () => {
      expect(matchCorridorPath(0, 0, 10, 0, prepareCorridors([loop]))).toBeNull()
    })

    it('skips the detour and takes the next-best corridor', () => {
      // The short connector fits slightly worse (offset 1 unit), so it sorts
      // second — proving the matcher tries the runner-up instead of giving up
      // the moment its first choice is rejected.
      const shortcut: Corridor = { w: 15, pts: [[0, 1], [10, 1]] }
      const path = matchCorridorPath(0, 0, 10, 0, prepareCorridors([loop, shortcut]))?.path ?? null
      expect(path).not.toBeNull()
      expect(polylineLength(path!)).toBeLessThan(20)
    })
  })

  it('rejects a corridor that is near one stop but far from the other', () => {
    const corridors = prepareCorridors([{ w: 25, pts: [[0, 0], [1000, 0]] }])
    // Comfortably past CORRIDOR_MATCH_MAX_DIST_WORLD on the second stop. Written
    // against the constant rather than a literal so a retune moves the fixture
    // with it instead of silently turning this into a no-op.
    const beyond = CORRIDOR_MATCH_MAX_DIST_WORLD + 5
    expect(matchCorridorPath(100, 5, 200, beyond, corridors)).toBeNull()
  })

  it('accepts a stop sitting just inside the threshold', () => {
    // The case the threshold exists for: BRT corridors break at junctions, so a
    // stop can sit tens of units from the stroke that serves its partner.
    const corridors = prepareCorridors([{ w: 15, pts: [[0, 0], [1000, 0]] }])
    const inside = CORRIDOR_MATCH_MAX_DIST_WORLD - 5
    expect(matchCorridorPath(100, 0, 200, inside, corridors)).not.toBeNull()
  })

  /*
   * The artwork draws a BRT corridor's two directions as separate strokes ~22
   * units apart. Judged independently, consecutive stops pick whichever is a
   * fraction closer, and a flat run of haltes renders as a staircase.
   */
  describe('sticking to one corridor across a leg', () => {
    // Two parallel strokes, 22 apart, both well inside the distance gate.
    const north: Corridor = { w: 15, pts: [[0, 0], [1000, 0]] }
    const south: Corridor = { w: 15, pts: [[0, 22], [1000, 22]] }
    const corridors = prepareCorridors([north, south])

    it('would otherwise hop between them as the nearest flips', () => {
      // Stop A leans north, stop B leans south: without a preference each pair
      // resolves to a different stroke.
      expect(matchCorridorPath(100, 9, 200, 9, corridors)!.index).toBe(0)
      expect(matchCorridorPath(200, 13, 300, 13, corridors)!.index).toBe(1)
    })

    it('keeps the corridor the leg elected', () => {
      // Same second pair, now carrying the leg's elected corridor — it stays
      // put rather than stepping across the 22-unit gap.
      const match = matchCorridorPath(200, 13, 300, 13, corridors, { preferIndex: 0 })
      expect(match!.index).toBe(0)
      expect(match!.path.every(([, y]) => y === 0)).toBe(true)
    })

    it('still abandons a preferred corridor that no longer reaches the stops', () => {
      // A real branch moves the stops clear of the old stroke: the preference is
      // a tiebreak among valid candidates, never an override of the gate. The
      // branch here runs far enough south that the north stroke fails maxDist.
      const branch: Corridor = { w: 15, pts: [[0, 400], [1000, 400]] }
      const branching = prepareCorridors([north, branch])
      const match = matchCorridorPath(100, 400, 300, 400, branching, { preferIndex: 0 })
      expect(match!.index).toBe(1)
    })
  })

  /*
   * The Koridor 3 case in miniature: its own stroke ends partway, a parallel
   * 2A stroke continues past it, and the middle stops sit BETWEEN the two with
   * the wrong one fractionally nearer. Which stroke the leg rides must depend
   * on the leg's stops, never on which end the journey starts from — rolling
   * per-pair stickiness failed exactly there.
   */
  describe('pickLegCorridor', () => {
    // Own stroke: covers x 0..500. Neighbour: covers x 300..1000, and is 1 unit
    // NEARER to the shared middle stops.
    const own: Corridor = { w: 15, pts: [[0, 12], [500, 12]] }
    const neighbour: Corridor = { w: 15, pts: [[300, 0], [1000, 0]] }
    const corridors = prepareCorridors([own, neighbour])
    // Five stops: three only `own` serves, two in the overlap leaning towards
    // the neighbour (y=5: 7 from own, 5 from neighbour).
    const stops = [
      { x: 50, y: 12 }, { x: 150, y: 12 }, { x: 250, y: 12 },
      { x: 350, y: 5 }, { x: 450, y: 5 }
    ]

    it('elects the corridor serving the most stops, not the locally nearest', () => {
      expect(pickLegCorridor(stops, corridors)).toBe(0)
    })

    it('is direction-independent', () => {
      // The same stops reversed — the journey drawn from the other end — must
      // elect the same corridor. This is the property the rolling model broke.
      expect(pickLegCorridor([...stops].reverse(), corridors)).toBe(pickLegCorridor(stops, corridors))
    })

    it('breaks a serve-count tie by total distance', () => {
      // Both strokes serve both stops; the nearer one wins.
      const pair = [{ x: 400, y: 5 }, { x: 480, y: 5 }]
      expect(pickLegCorridor(pair, corridors)).toBe(1)
    })

    it('returns undefined when no corridor reaches two stops', () => {
      // One grazed stop is not a leg's corridor — a preference needs a pair.
      expect(pickLegCorridor([{ x: 50, y: 12 }, { x: 5000, y: 5000 }], corridors)).toBeUndefined()
      expect(pickLegCorridor([], corridors)).toBeUndefined()
    })
  })

  it('prefers the closest of two parallel corridors', () => {
    const corridors = prepareCorridors([
      { w: 25, pts: [[0, 30], [1000, 30]] },
      { w: 25, pts: [[0, 0], [1000, 0]] }
    ])
    const path = matchCorridorPath(100, 2, 300, 2, corridors)?.path ?? null
    expect(path!.every(([, y]) => y === 0)).toBe(true)
  })

  it('chords when there are no corridors at all', () => {
    expect(matchCorridorPath(0, 0, 100, 0, [])).toBeNull()
  })

  it('chords when both stops resolve to the same place', () => {
    const corridors = prepareCorridors([{ w: 25, pts: [[0, 0], [100, 0]] }])
    expect(matchCorridorPath(50, 0, 50, 0, corridors)).toBeNull()
  })
})

// The shipped file is generated by scripts/build-map-skeleton.ts. These assert
// a bad regeneration fails at `pnpm test` rather than as a silently straight
// route in the browser.
describe('the shipped map-corridors.json', () => {
  // Typed as JSON actually parses it — a plain number[][] — rather than as
  // Corridor. Asserting each entry really is a pair of finite numbers is one of
  // the things this suite is for, so borrowing the tuple type would assume the
  // very thing under test.
  const { corridors } = corridorsManifest as { version: string, corridors: Array<{ w: number, pts: number[][] }> }

  it('carries both width classes in usable quantity', () => {
    expect(corridors.length).toBeGreaterThanOrEqual(32)
    expect(corridors.filter(c => c.w === 25).length).toBeGreaterThanOrEqual(12)
    expect(corridors.filter(c => c.w === 15).length).toBeGreaterThanOrEqual(20)
  })

  it('holds only drawable polylines inside the map viewBox', () => {
    for (const corridor of corridors) {
      expect(corridor.pts.length).toBeGreaterThanOrEqual(2)
      for (const [x, y] of corridor.pts) {
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(9514)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(6727)
      }
    }
  })
})
