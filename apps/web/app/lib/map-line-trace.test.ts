import { describe, expect, it } from 'vitest'
import corridorsManifest from '../data/map-corridors.json'
import pointsManifest from '../data/points.json'
import linesManifest from '../data/map-lines.json'
import { traceLine, type TracePoint, type TraceableLine, type TracedLine } from './map-line-trace'
import { channelDistance, CORRIDOR_COLOUR_TOLERANCE } from './map-corridor-colour'
import { prepareCorridors, projectOntoPolyline, type Corridor } from './map-corridors'

/*
 * Tracing a line is where a wrong answer is most expensive: the traced stroke is
 * the output, so electing a neighbour holds the wrong line at full strength.
 * These pin the two behaviours that prevent that — the colour gate, and the
 * refusal to chord across a gap.
 */

const dot = (id: string, x: number, y: number, station?: string): TracePoint =>
  ({ id, station, ax: x, ay: y, bx: x, by: y })

const line = (...segments: Array<{ kind: string, ids: string[], joinsAtCode?: string }>): TraceableLine =>
  ({ segments: segments.map(s => ({ kind: s.kind, joinsAtCode: s.joinsAtCode, stations: s.ids.map(id => ({ id })) })) })

// Two strokes on the same alignment, the shape that causes the real bug: a
// stacked pair where distance alone cannot tell them apart.
const YELLOW: Corridor = { w: 25, c: '#F8C434', pts: [[0, 0], [100, 0], [200, 0]] }
const BLUE: Corridor = { w: 25, c: '#F8C434', pts: [[0, 12], [200, 12]] }

describe('traceLine', () => {
  const points = [dot('A', 0, 0), dot('B', 100, 0), dot('C', 200, 0)]

  it('traces a simple run onto its corridor', () => {
    const traced = traceLine(line({ kind: 'TRUNK', ids: ['A', 'B', 'C'] }), points, [YELLOW], ['#F8C434'], '#F8C434')
    expect(traced.matchedPairs).toBe(2)
    expect(traced.totalPairs).toBe(2)
    expect(traced.segments[0].edges.length).toBeGreaterThan(0)
  })

  it('refuses a wrong-coloured stroke even when it is nearer', () => {
    // The confirmed failure in miniature: a blue stroke sits closer to the stops
    // than the line's own yellow. Colour-blind matching takes the blue one.
    const stops = [dot('A', 0, 10), dot('B', 100, 10), dot('C', 200, 10)]
    const blind = traceLine(line({ kind: 'TRUNK', ids: ['A', 'B', 'C'] }), stops, [BLUE], ['#2355A2'], undefined)
    expect(blind.matchedPairs).toBe(2)

    const gated = traceLine(line({ kind: 'TRUNK', ids: ['A', 'B', 'C'] }), stops, [BLUE], ['#2355A2'], '#F8C434')
    expect(gated.matchedPairs).toBe(0)
    expect(gated.segments[0].edges).toHaveLength(0)
  })

  it('picks its own stroke over a NEARER parallel one, per pair', () => {
    // Tanah Abang to Karet in miniature: the wrong-coloured stroke is a hair
    // closer, so matching first and vetting the winner throws the pair away even
    // though the right corridor was in the candidate list. Filtering before the
    // match asks the question the right way round.
    const stops = [dot('A', 0, 6), dot('B', 200, 6)]
    const traced = traceLine(
      line({ kind: 'TRUNK', ids: ['A', 'B'] }),
      stops, [BLUE, YELLOW], ['#2355A2', '#F8C434'], '#F8C434'
    )
    expect(traced.matchedPairs).toBe(1)
  })

  it('elects its own stroke over a nearer one of another colour', () => {
    // The gate rescues as well as rejects: with both strokes present, filtering
    // before the election steers this onto the yellow it belongs to.
    const stops = [dot('A', 0, 8), dot('B', 100, 8), dot('C', 200, 8)]
    const traced = traceLine(
      line({ kind: 'TRUNK', ids: ['A', 'B', 'C'] }),
      stops, [BLUE, YELLOW], ['#2355A2', '#F8C434'], '#F8C434'
    )
    expect(traced.matchedPairs).toBe(2)
  })

  it('leaves a gap rather than chording an unmatched pair', () => {
    // A stop far off any corridor. The pair must contribute nothing: a chord
    // would claim the line runs somewhere it does not.
    const stops = [dot('A', 0, 0), dot('B', 100, 0), dot('FAR', 4000, 4000)]
    const traced = traceLine(line({ kind: 'TRUNK', ids: ['A', 'B', 'FAR'] }), stops, [YELLOW], ['#F8C434'], '#F8C434')
    expect(traced.totalPairs).toBe(2)
    expect(traced.matchedPairs).toBe(1)
  })

  it('traces an uncoloured corridor, so deferring BRT does not exclude it', () => {
    // Null colour is "unknown", never "excluded". If this ever fails, BRT has
    // been silently locked out rather than merely postponed.
    const traced = traceLine(line({ kind: 'TRUNK', ids: ['A', 'B', 'C'] }), points, [YELLOW], [null], '#F8C434')
    expect(traced.matchedPairs).toBe(2)
  })

  it('elects per segment, so a branch is not held to the trunk stroke', () => {
    // One election across the whole line would keep the trunk's corridor through
    // the branch and match nothing there.
    const branch: Corridor = { w: 25, c: '#F8C434', pts: [[200, 0], [200, 200]] }
    const stops = [...points, dot('D', 200, 100), dot('E', 200, 200)]
    const traced = traceLine(
      line({ kind: 'TRUNK', ids: ['A', 'B', 'C'] }, { kind: 'RAMP', ids: ['C', 'D', 'E'] }),
      stops, [YELLOW, branch], ['#F8C434', '#F8C434'], '#F8C434'
    )
    expect(traced.segments).toHaveLength(2)
    expect(traced.segments[0].matchedPairs).toBe(2)
    expect(traced.segments[1].matchedPairs).toBe(2)
  })

  it('keeps segment kinds and station order, for a later per-branch isolate', () => {
    const traced = traceLine(
      line({ kind: 'TRUNK', ids: ['A', 'B'] }, { kind: 'LOOP', ids: ['B', 'C'] }),
      points, [YELLOW], ['#F8C434'], '#F8C434'
    )
    expect(traced.segments.map(s => s.kind)).toEqual(['TRUNK', 'LOOP'])
    expect(traced.segments[0].markers).toEqual(['A', 'B'])
  })

  it('skips a station with no drawn point rather than throwing', () => {
    const traced = traceLine(line({ kind: 'TRUNK', ids: ['A', 'GHOST', 'C'] }), points, [YELLOW], ['#F8C434'], '#F8C434')
    expect(traced.segments[0].markers).toEqual(['A', 'C'])
  })

  it('pins a station drawn twice to its primary shape', () => {
    // An exact id beats an alias, the same rule the route overlay uses, so both
    // agree on where a twice-drawn halte is.
    const twin = dot('B-b', 900, 900, 'B')
    const traced = traceLine(line({ kind: 'TRUNK', ids: ['A', 'B'] }), [twin, ...points], [YELLOW], ['#F8C434'], '#F8C434')
    expect(traced.matchedPairs).toBe(1)
  })

  it('leaves a singly-drawn station alone while resolving a twinned one', () => {
    // Only B is drawn twice, so only B needs choosing between shapes. A and C
    // have one shape each and take it directly.
    const twin = dot('B-b', 100, 900, 'B')
    const traced = traceLine(
      line({ kind: 'TRUNK', ids: ['A', 'B', 'C'] }),
      [...points, twin], [YELLOW], ['#F8C434'], '#F8C434'
    )
    expect(traced.segments[0].markers).toEqual(['A', 'B', 'C'])
    expect(traced.matchedPairs).toBe(2)
  })

  it('reports nothing to trace without corridors', () => {
    const traced = traceLine(line({ kind: 'TRUNK', ids: ['A', 'B'] }), points, [], [], '#F8C434')
    expect(traced.matchedPairs).toBe(0)
    expect(traced.totalPairs).toBe(1)
  })
})

/*
 * LineDetail gives a branch or loop only its OWN stops — the junction it meets
 * stays on the trunk — so the connecting pair has to be reconstructed from
 * joinsAtCode. Missing this drew the Cikarang loop open, with a gap at exactly
 * the stretch that closes it.
 */
describe('traceLine joins branches to their trunk', () => {
  const spine: Corridor = { w: 25, c: '#F8C434', pts: [[0, 0], [100, 0], [200, 0], [300, 0]] }
  const points = [
    dot('KCI-A', 0, 0), dot('KCI-J', 100, 0), dot('KCI-B', 200, 0), dot('KCI-C', 300, 0)
  ]

  it('closes a LOOP onto its junction at both ends', () => {
    // The loop's own stops are B and C; it attaches at J. Both the J->B entry
    // and the C->J return have to be traced or the loop is drawn open.
    const traced = traceLine(
      line(
        { kind: 'TRUNK', ids: ['KCI-A', 'KCI-J'] },
        { kind: 'LOOP', ids: ['KCI-B', 'KCI-C'], joinsAtCode: 'J' }
      ),
      points, [spine], ['#F8C434'], '#F8C434'
    )
    const loop = traced.segments[1]
    // J, B, C, J — three pairs, not the one the raw stop list would give.
    expect(loop.totalPairs).toBe(3)
    expect(loop.markers).toEqual(['KCI-J', 'KCI-B', 'KCI-C', 'KCI-J'])
  })

  it('closes a RAMP onto its junction at the start only', () => {
    // A ramp leaves the trunk and does not come back, so appending the junction
    // would draw a return leg that does not exist.
    const traced = traceLine(
      line(
        { kind: 'TRUNK', ids: ['KCI-A', 'KCI-J'] },
        { kind: 'RAMP', ids: ['KCI-B', 'KCI-C'], joinsAtCode: 'J' }
      ),
      points, [spine], ['#F8C434'], '#F8C434'
    )
    expect(traced.segments[1].markers).toEqual(['KCI-J', 'KCI-B', 'KCI-C'])
  })

  it('leaves a segment alone when it has no join', () => {
    const traced = traceLine(
      line({ kind: 'TRUNK', ids: ['KCI-A', 'KCI-J'] }),
      points, [spine], ['#F8C434'], '#F8C434'
    )
    expect(traced.segments[0].markers).toEqual(['KCI-A', 'KCI-J'])
  })

  it('ignores a join that names no known station', () => {
    const traced = traceLine(
      line({ kind: 'LOOP', ids: ['KCI-B', 'KCI-C'], joinsAtCode: 'NOPE' }),
      points, [spine], ['#F8C434'], '#F8C434'
    )
    expect(traced.segments[0].markers).toEqual(['KCI-B', 'KCI-C'])
  })

  it('finds a junction whose operator differs from its segment', () => {
    // The code is bare, so the prefix is borrowed from a station the segment
    // already names. Where the junction belongs to another operator that guess
    // misses, and the scan over the point set is what still resolves it.
    const crossOperator = [
      dot('TJ-A', 0, 0), dot('KCI-J', 100, 0), dot('TJ-B', 200, 0), dot('TJ-C', 300, 0)
    ]
    const traced = traceLine(
      line({ kind: 'LOOP', ids: ['TJ-B', 'TJ-C'], joinsAtCode: 'J' }),
      crossOperator, [spine], ['#F8C434'], '#F8C434'
    )
    expect(traced.segments[0].markers).toEqual(['KCI-J', 'TJ-B', 'TJ-C', 'KCI-J'])
  })

  it('does not double the junction when the segment already starts there', () => {
    const traced = traceLine(
      line({ kind: 'LOOP', ids: ['KCI-J', 'KCI-B'], joinsAtCode: 'J' }),
      points, [spine], ['#F8C434'], '#F8C434'
    )
    expect(traced.segments[0].markers).toEqual(['KCI-J', 'KCI-B'])
  })
})

/*
 * The extractor splits a drawn line wherever the artwork breaks it, so a pair can
 * straddle the join and no single corridor reaches both stops. Cikarang's Duri to
 * Tanah Abang is exactly that: one continuous cyan stroke arriving as two
 * corridors that meet at a shared endpoint.
 */
describe('traceLine chains across a split stroke', () => {
  // Two halves of one line, meeting exactly at (0, 100).
  const upper: Corridor = { w: 25, c: '#F8C434', pts: [[0, 0], [0, 100]] }
  const lower: Corridor = { w: 25, c: '#F8C434', pts: [[0, 100], [0, 200]] }
  const points = [dot('KCI-A', 0, 0), dot('KCI-B', 0, 200)]

  it('traces a pair whose stops sit on different halves', () => {
    const traced = traceLine(
      line({ kind: 'TRUNK', ids: ['KCI-A', 'KCI-B'] }),
      points, [upper, lower], ['#00BDEE', '#00BDEE'], '#25B8EB'
    )
    expect(traced.matchedPairs).toBe(1)
    expect(traced.segments[0].edges.length).toBeGreaterThan(0)
  })

  it('still refuses when the halves are the wrong colour', () => {
    // Chaining widens which GEOMETRY can be found, never which colours pass.
    const traced = traceLine(
      line({ kind: 'TRUNK', ids: ['KCI-A', 'KCI-B'] }),
      points, [upper, lower], ['#282A65', '#282A65'], '#25B8EB'
    )
    expect(traced.matchedPairs).toBe(0)
  })

  it('chains across a break at a station disc', () => {
    // The artwork draws the marker over the line, so the stroke resumes on its
    // far side ~47 units later. Soekarno-Hatta breaks exactly this way between
    // Sudirman Baru and Duri, and refusing the join sent it down Cikarang's cyan
    // for a third of its length.
    const upperHalf: Corridor = { w: 25, c: '#282A65', pts: [[0, 0], [0, 100]] }
    const lowerHalf: Corridor = { w: 25, c: '#282A65', pts: [[0, 147], [0, 250]] }
    const stops = [dot('KCI-A', 0, 0), dot('KCI-B', 0, 250)]
    const traced = traceLine(
      line({ kind: 'TRUNK', ids: ['KCI-A', 'KCI-B'] }),
      stops, [upperHalf, lowerHalf], undefined, '#262262'
    )
    expect(traced.matchedPairs).toBe(1)
  })

  it('does not chain across corridors that never meet', () => {
    // One hop between TOUCHING strokes, not a path search free to wander the
    // network to connect any two points. The second half is offset so it reaches
    // the far stop but shares no endpoint with the first, and the two stops are
    // far enough apart that neither corridor alone can serve both.
    const far = [dot('KCI-A', 0, 0), dot('KCI-B', 600, 1000)]
    const detached: Corridor = { w: 25, c: '#F8C434', pts: [[600, 900], [600, 1000]] }
    const traced = traceLine(
      line({ kind: 'TRUNK', ids: ['KCI-A', 'KCI-B'] }),
      far, [upper, detached], ['#00BDEE', '#00BDEE'], '#25B8EB'
    )
    expect(traced.matchedPairs).toBe(0)
  })

  it('chains onto a half whose colour is lent by a sharing line', () => {
    const traced = traceLine(
      line({ kind: 'TRUNK', ids: ['KCI-A', 'KCI-B'] }),
      points, [upper, lower], ['#006838', '#006838'], '#21409A',
      () => ['#006838']
    )
    expect(traced.matchedPairs).toBe(1)
  })
})

/*
 * Tracing against the REAL artwork.
 *
 * The synthetic fixtures above cannot reach these behaviours: a pair of stubs
 * twelve units apart does not reproduce "the brand hex is 102 channels from the
 * ink the line is drawn in", and a test that cannot reproduce the bug passes
 * whether or not the fix is present. Every case here was checked by reverting
 * the election and confirming it fails.
 *
 * Driven off the committed artifacts rather than a copied fixture, so the tests
 * cannot drift away from what actually ships.
 */
describe('traceLine on the shipped artwork', () => {
  const corridors = corridorsManifest.corridors as unknown as Corridor[]
  const points = pointsManifest.points as TracePoint[]
  const prepared = prepareCorridors(corridors)

  // The line detail the API returns, reduced to what traceLine reads. Station
  // order is the shipped artifact's own marker list, so these stay in step with
  // the network without a network call.
  const trunk = (ids: string[]): TraceableLine =>
    ({ segments: [{ kind: 'TRUNK', stations: ids.map(id => ({ id })) }] })

  // Kalideres to Rawa Buaya and on: the stretch koridor 3 and 3F share.
  const K3_SHARED = [
    'TJ-H00094P', 'TJ-H00169P', 'TJ-H00229P', 'TJ-H00193P', 'TJ-H00084P',
    'TJ-H00046P', 'TJ-H00087P', 'TJ-H00235P', 'TJ-H00077P', 'TJ-H00083P'
  ]
  const K3F_TAIL = ['TJ-H00071P', 'TJ-H00210S', 'TJ-H00204S']
  const TJ14 = [
    'TJ-H00273P', 'TJ-H00287P', 'TJ-H00286P', 'TJ-H00042P',
    'TJ-H00108P', 'TJ-H00288P', 'TJ-H00285P', 'TJ-H00212P'
  ]
  // Kampung Rambutan outward, the stretch where TJ:7's crimson runs alongside
  // the brown-ish stubs its brand colour would rather match.
  const TJ7 = [
    'TJ-H00096P', 'TJ-H00238S', 'TJ-H00056P', 'TJ-H00196P', 'TJ-H00147P',
    'TJ-H00150P', 'TJ-H00171P', 'TJ-H00013P', 'TJ-H00030P'
  ]

  // The artwork colour under an edge's midpoint, or null where it crosses blank
  // paper. This is the non-circular question: what IS drawn here, never which
  // corridor the matcher happened to choose.
  const inkUnder = (edge: number[]): string | null => {
    const mx = (edge[0] + edge[2]) / 2
    const my = (edge[1] + edge[3]) / 2
    let nearest = Infinity
    let ink: string | null = null
    for (const corridor of prepared) {
      const { dist } = projectOntoPolyline(mx, my, corridor)
      if (dist < nearest) {
        nearest = dist
        ink = corridor.c
      }
    }
    return nearest <= 12.5 ? ink : null
  }

  const edgesOf = (ids: string[], colour: string) => {
    const traced = traceLine(trunk(ids), points, corridors, undefined, colour, undefined, true)
    return { traced, edges: traced.segments.flatMap(segment => segment.edges) }
  }

  it('traces TJ:14 on the orange it is actually drawn in', () => {
    /*
     * TJ:14's brand `#F5AB6E` matches no stroke on the sheet at all — it is a
     * pale tint of the `#FA7116` the line is drawn in. Gated on the brand, the
     * line finds no candidate and rides whatever the fallback reaches; every one
     * of its edges lands on foreign ink.
     */
    const { traced, edges } = edgesOf(TJ14, '#F5AB6E')
    expect(traced.tracedColour).toBe('#FA7116')
    expect(traced.matchedPairs).toBeGreaterThanOrEqual(6)
    const foreign = edges.filter((edge) => {
      const ink = inkUnder(edge)
      return ink !== null && channelDistance(ink, '#FA7116') > CORRIDOR_COLOUR_TOLERANCE
    })
    expect(foreign).toHaveLength(0)
  })

  it('duplicates a shared trunk across branching lines', () => {
    /*
     * The point of grounding a trace in the line's own stations: koridor 3 and
     * 3F run the same busway out of Kalideres, so they must draw it IDENTICALLY
     * and diverge only where their stations do.
     *
     * Asserted pair by pair. Whole-line edge-set overlap is the wrong measure
     * and would be vacuous here — 3 against 3F reads 0.12 purely because 3F's
     * tail is 58 edges against a 10-edge shared trunk, so a loose threshold
     * passes even when the trunk is traced onto two different strokes.
     */
    for (let i = 0; i < K3_SHARED.length - 1; i++) {
      const pair = [K3_SHARED[i], K3_SHARED[i + 1]]
      const onK3 = edgesOf(pair, '#FDCB1C').edges
      const onK3F = edgesOf(pair, '#FDCB1C').edges
      expect(onK3F).toEqual(onK3)
    }

    // And the branch really does leave: 3F's own tail is geometry 3 never draws.
    const k3 = edgesOf(K3_SHARED, '#FDCB1C').edges.map(e => JSON.stringify(e))
    const tail = edgesOf([K3_SHARED[K3_SHARED.length - 1], ...K3F_TAIL], '#FDCB1C').edges
    expect(tail.length).toBeGreaterThan(0)
    expect(tail.some(edge => k3.includes(JSON.stringify(edge)))).toBe(false)
  })

  it('does not put TJ:7 on the brown stubs its brand matches', () => {
    /*
     * TJ:7 is branded brown `#914900` but drawn in crimson `#F71752`, 102 apart.
     * The stubs it crosses (`#CD4411` at 60, `#89070E` at 66) DO pass the brand
     * gate, so colour alone does not merely fail to help here — it elects the
     * wrong stroke.
     */
    const { traced, edges } = edgesOf(TJ7, '#914900')
    expect(traced.tracedColour).toBe('#F71752')
    /*
     * Asserted against the ELECTED ink, not against the stubs: `#CD4411` sits 65
     * channels from the crimson, inside the tolerance, so "far from the stub"
     * would reject the line's own artwork. The honest question is whether each
     * edge lies on ink consistent with the colour the line was traced as.
     */
    expect(traced.matchedPairs).toBe(traced.totalPairs)
    const foreign = edges.filter((edge) => {
      const ink = inkUnder(edge)
      return ink !== null && channelDistance(ink, '#F71752') > CORRIDOR_COLOUR_TOLERANCE
    })
    expect(foreign).toHaveLength(0)
  })

  it('starts a branch at its own terminus, not on the trunk it leaves', () => {
    /*
     * Puri Beta 2 begins three lines (13B, 13E, L13E) on a short branch stub that
     * meets the trunk side-on. The trunk still passes within the 110 gate — 101
     * units away — so a direct match succeeds and the branch is never drawn:
     * all three used to start a hundred units from the station they terminate at.
     */
    const PB2 = { x: 809.4, y: 4602.4 }
    const traced = traceLine(
      trunk(['TJ-H00190P', 'TJ-H00189P', 'TJ-H00001P']),
      points, corridors, undefined, '#7A357B', undefined, true
    )
    const edges = traced.segments.flatMap(segment => segment.edges)
    const closest = Math.min(...edges.map(([ax, ay, bx, by]) => Math.min(
      Math.hypot(ax - PB2.x, ay - PB2.y),
      Math.hypot(bx - PB2.x, by - PB2.y)
    )))
    expect(closest).toBeLessThan(10)
  })

  it('chains its own colour rather than borrowing a neighbour that shares the stops', () => {
    /*
     * TJ:6 runs Halimun to Galunggung on green drawn in two pieces. TJ:4 calls at
     * both stops too, so the shared-track exception offers its purple — and the
     * purple stroke between them is NEARER than either green piece. Taking the
     * fallback before trying a chain of this line's own colour drew TJ:6 along
     * koridor 4 for the whole stretch, which is what the map showed.
     */
    /*
     * The shared-track lookup is what makes this reproduce: it is the caller
     * saying "TJ:4 serves both these stops too", which is exactly what offers the
     * purple. Without it the fallback has nothing to borrow and the bug cannot
     * occur, so a test that omits it passes whether or not the fix is present.
     */
    const traced = traceLine(
      trunk(['TJ-H00073P', 'TJ-H00283P']),
      points, corridors, undefined, '#1BAC47', () => ['#512C62'], true
    )
    const edges = traced.segments.flatMap(segment => segment.edges)
    expect(edges.length).toBeGreaterThan(0)
    for (const edge of edges) {
      const ink = inkUnder(edge)
      if (ink === null) continue
      expect(channelDistance(ink, '#1BAC47')).toBeLessThanOrEqual(CORRIDOR_COLOUR_TOLERANCE)
    }
  })

  it('leaves a rail line on its own stroke', () => {
    /*
     * The election must refine rail without moving it: every rail line elects
     * the artwork spelling of its own brand, which is within tolerance, so the
     * gate behaves exactly as before. KCI:A is the case that proves it matters —
     * its nearest stroke by distance is KCI:T's orange, 152 channels away.
     */
    const traced = traceLine(
      trunk(['KCI-DU', 'KCI-BPR', 'KCI-TNG']),
      points, corridors, undefined, '#262262', undefined, false
    )
    expect(channelDistance(traced.tracedColour!, '#262262')).toBeLessThanOrEqual(CORRIDOR_COLOUR_TOLERANCE)
  })
})

/*
 * Joining consecutive pairs at the station they share.
 *
 * A pair is drawn between the FEET its stops project to, so where two pairs
 * match different pieces of the artwork the station between them has two feet
 * and the space between goes undrawn. Bridging closes that — but only where the
 * artwork really does run through, which is what the refusals below pin.
 */
describe('traceLine bridges consecutive pairs', () => {
  it('closes the gap where one run continues into the next', () => {
    // Two collinear pieces of one stroke, 40 units apart. The connector runs on
    // the same bearing as both, so it is describing track the sheet draws.
    const west: Corridor = { w: 25, c: '#F8C434', pts: [[0, 0], [200, 0]] }
    const east: Corridor = { w: 25, c: '#F8C434', pts: [[240, 0], [440, 0]] }
    const stops = [dot('A', 0, 0), dot('B', 200, 0), dot('C', 440, 0)]
    const traced = traceLine(
      line({ kind: 'TRUNK', ids: ['A', 'B', 'C'] }),
      stops, [west, east], ['#F8C434', '#F8C434'], '#F8C434'
    )
    expect(traced.matchedPairs).toBe(2)
    expect(traced.segments[0].edges).toContainEqual([200, 0, 240, 0])
  })

  it('refuses a connector that cuts a corner the artwork draws', () => {
    // The second stroke leaves at a right angle. A straight bridge across would
    // replace the fillet the sheet turns through, so the pair is dropped instead
    // — the corner is drawn, this pair simply did not match it.
    const west: Corridor = { w: 25, c: '#F8C434', pts: [[0, 0], [200, 0]] }
    const north: Corridor = { w: 25, c: '#F8C434', pts: [[200, 40], [200, 240]] }
    const stops = [dot('A', 0, 0), dot('B', 200, 0), dot('C', 200, 240)]
    const traced = traceLine(
      line({ kind: 'TRUNK', ids: ['A', 'B', 'C'] }),
      stops, [west, north], ['#F8C434', '#F8C434'], '#F8C434'
    )
    // The first run is drawn; the second is refused rather than mitred onto it.
    expect(traced.matchedPairs).toBe(1)
    expect(traced.segments[0].edges).toEqual([[0, 0, 200, 0]])
  })

  it('refuses a sidestep onto a stroke running alongside', () => {
    // The signature of the staircase: a short connector crossing both the run
    // before it and the run after, which themselves keep the same bearing. A
    // gap is the honest answer — the line is not drawn stepping sideways here.
    const west: Corridor = { w: 25, c: '#F8C434', pts: [[0, 0], [200, 0]] }
    const beside: Corridor = { w: 25, c: '#F8C434', pts: [[200, 20], [400, 20]] }
    const stops = [dot('A', 0, 0), dot('B', 200, 0), dot('C', 400, 20)]
    const traced = traceLine(
      line({ kind: 'TRUNK', ids: ['A', 'B', 'C'] }),
      stops, [west, beside], ['#F8C434', '#F8C434'], '#F8C434'
    )
    expect(traced.matchedPairs).toBe(1)
    expect(traced.segments[0].edges).toEqual([[0, 0, 200, 0]])
  })

  it('refuses a connector that arrives across the run it joins', () => {
    // The mitre cut from the other end: the bridge leaves along the incoming
    // bearing, so the first test passes, and then meets a stroke running square
    // to it. Judged against what the bridge leads INTO as well as what it leaves.
    const west: Corridor = { w: 25, c: '#F8C434', pts: [[0, 0], [200, 0]] }
    const upright: Corridor = { w: 25, c: '#F8C434', pts: [[240, 0], [240, 200]] }
    const stops = [dot('A', 0, 0), dot('B', 200, 0), dot('C', 240, 200)]
    const traced = traceLine(
      line({ kind: 'TRUNK', ids: ['A', 'B', 'C'] }),
      stops, [west, upright], ['#F8C434', '#F8C434'], '#F8C434'
    )
    expect(traced.matchedPairs).toBe(1)
    expect(traced.segments[0].edges).toEqual([[0, 0, 200, 0]])
  })

  it('bridges into a pair only a chain could reach', () => {
    // The second pair straddles a break, so no single stroke serves it and the
    // chain is the only match. It still has to join what is already drawn, and
    // here it carries straight on — so the connector is drawn with it.
    const west: Corridor = { w: 25, c: '#F8C434', pts: [[0, 0], [200, 0]] }
    const midWest: Corridor = { w: 25, c: '#F8C434', pts: [[230, 0], [400, 0]] }
    const midEast: Corridor = { w: 25, c: '#F8C434', pts: [[400, 0], [600, 0]] }
    const stops = [dot('A', 0, 0), dot('B', 200, 0), dot('C', 600, 0)]
    const traced = traceLine(
      line({ kind: 'TRUNK', ids: ['A', 'B', 'C'] }),
      stops, [west, midWest, midEast], ['#F8C434', '#F8C434', '#F8C434'], '#F8C434'
    )
    expect(traced.matchedPairs).toBe(2)
    expect(traced.segments[0].edges).toContainEqual([200, 0, 230, 0])
  })

  it('refuses a chain that would have to turn a corner to join', () => {
    // Same shape, except the chain leaves at a right angle. The pair is dropped
    // rather than mitred on: a chain gets no more licence to cut a corner than a
    // single stroke does.
    const west: Corridor = { w: 25, c: '#F8C434', pts: [[0, 0], [200, 0]] }
    const northLow: Corridor = { w: 25, c: '#F8C434', pts: [[200, 30], [200, 150]] }
    const northHigh: Corridor = { w: 25, c: '#F8C434', pts: [[200, 150], [200, 300]] }
    const stops = [dot('A', 0, 0), dot('B', 200, 0), dot('C', 200, 300)]
    const traced = traceLine(
      line({ kind: 'TRUNK', ids: ['A', 'B', 'C'] }),
      stops, [west, northLow, northHigh], ['#F8C434', '#F8C434', '#F8C434'], '#F8C434'
    )
    expect(traced.matchedPairs).toBe(1)
    expect(traced.segments[0].edges).toEqual([[0, 0, 200, 0]])
  })

  it('leaves a gap too wide to be one continuous run unbridged', () => {
    // Beyond MAX_STATION_BRIDGE_WORLD the two pairs are not describing one run,
    // and a connector would be inventing track. Both pairs still draw; only the
    // connector between them is withheld.
    const west: Corridor = { w: 25, c: '#F8C434', pts: [[0, 0], [200, 0]] }
    const east: Corridor = { w: 25, c: '#F8C434', pts: [[400, 0], [600, 0]] }
    const stops = [dot('A', 0, 0), dot('B', 200, 0), dot('C', 600, 0)]
    const traced = traceLine(
      line({ kind: 'TRUNK', ids: ['A', 'B', 'C'] }),
      stops, [west, east], ['#F8C434', '#F8C434'], '#F8C434'
    )
    const edges = traced.segments[0].edges
    expect(edges).toContainEqual([0, 0, 200, 0])
    expect(edges.some(([ax, , bx]) => ax === 200 && bx === 400)).toBe(false)
  })
})

// The committed artifact's shape, reduced to what a replay reads.
interface ShippedLine {
  key: string
  operator: string
  color: string
  matchedPairs: number
  totalPairs: number
  segments: Array<{ kind: string, markers: string[], edges: Array<[number, number, number, number]> }>
}

/*
 * Every shipped line, traced against the artwork it was built from.
 *
 * The synthetic fixtures above each isolate one rule, which is what makes them
 * readable — and is also why they cannot reach the paths that only a real sheet
 * produces: a ring closed by a 42-unit fillet, a terminus whose return arm is
 * drawn separately, a 92-unit interchange bar with the line's ink broken into a
 * piece at each end. None of those can be posed in six points.
 *
 * So this drives all 41 lines through the tracer and holds the result against
 * the committed artifact. It is a regression test rather than a behavioural one:
 * it does not say what the tracer SHOULD do, it says the tracer still does what
 * the shipped map was drawn from. A change that moves any line's coverage has to
 * regenerate the artifact and show the diff, which is exactly the review the
 * geometry deserves.
 */
describe('traceLine reproduces the shipped artifact', () => {
  const corridors = corridorsManifest.corridors as unknown as Corridor[]
  const points = pointsManifest.points as TracePoint[]

  const shipped = Object.values(linesManifest.lines) as unknown as ShippedLine[]

  // Which stops each line serves, which is all the shared-track lookup needs:
  // the build asks "does any OTHER line call at both ends of this pair", not
  // whether it runs them adjacently.
  const servedByKey = new Map<string, Set<string>>(
    shipped.map(entry => [entry.key, new Set(entry.segments.flatMap(s => s.markers))])
  )

  /*
   * The build's sharedTrack lookup, rebuilt from the artifact.
   *
   * Without it the replay is not the same call the artifact was built from —
   * four TJ lines run stretches the sheet draws once, in a neighbour's colour,
   * and a strict gate refuses the whole shared run. Reconstructing it here keeps
   * the comparison honest rather than lowering the expectation to match.
   */
  const sharedTrackFor = (key: string) => (fromId: string, toId: string): string[] => {
    const shared: string[] = []
    for (const other of shipped) {
      if (other.key === key) continue
      const served = servedByKey.get(other.key)
      if (served?.has(fromId) && served.has(toId)) shared.push(other.color)
    }
    return shared
  }

  // The artifact's own marker lists are the traced stop order, junctions already
  // resolved — so replaying them needs no joinsAtCode and no network call.
  const replay = (entry: ShippedLine): TracedLine => traceLine(
    { segments: entry.segments.map(s => ({ kind: s.kind, stations: s.markers.map(id => ({ id })) })) },
    points, corridors, undefined, entry.color, sharedTrackFor(entry.key), entry.operator === 'TJ'
  )

  it('covers all 41 lines', () => {
    expect(shipped).toHaveLength(41)
  })

  it.each(shipped.map(entry => [entry.key, entry] as const))(
    'traces %s to its recorded coverage',
    (_key, entry) => {
      const traced = replay(entry)
      expect(traced.matchedPairs).toBe(entry.matchedPairs)
      /*
       * Counted off the artifact's own markers rather than its totalPairs.
       *
       * The two agree everywhere but TJ:7, where the line detail named a station
       * with no drawn point: it counted toward the build's totalPairs and was
       * then dropped from markers, so replaying the markers has one pair fewer.
       * Deriving the expectation from what is actually being replayed keeps this
       * a real assertion instead of a constant tuned to absorb that.
       */
      const pairs = entry.segments.reduce((n, s) => n + Math.max(0, s.markers.length - 1), 0)
      expect(traced.totalPairs).toBe(pairs)
    }
  )

  it('draws the same geometry the artifact ships', () => {
    // Edge for edge, not merely the same pair count: a trace can keep its
    // coverage while moving onto a neighbouring stroke, which is the failure
    // this whole module exists to prevent.
    for (const entry of shipped) {
      const traced = replay(entry)
      expect(traced.segments.map(s => s.edges)).toEqual(entry.segments.map(s => s.edges))
    }
  })
})
