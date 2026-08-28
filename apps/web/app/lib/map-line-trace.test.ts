import { describe, expect, it } from 'vitest'
import { traceLine, type TracePoint, type TraceableLine } from './map-line-trace'
import type { Corridor } from './map-corridors'

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
