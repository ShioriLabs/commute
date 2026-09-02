import { describe, expect, it } from 'vitest'
import corridorsManifest from '../data/map-corridors.json'
import {
  CORRIDOR_COLOUR_TOLERANCE,
  channelDistance,
  colourMatches,
  electArtworkColour
} from './map-corridor-colour'

// The colour comparison is what stops a leg riding a neighbouring line's stroke.
// Getting it wrong does not fail loudly at runtime — it draws the wrong line at
// full strength — so these are the tests standing in for that.

describe('channelDistance', () => {
  it('is zero for the same colour', () => {
    expect(channelDistance('#ca2a51', '#ca2a51')).toBe(0)
  })

  it('takes the worst channel, not the average', () => {
    // One badly-off channel must not be averaged away by two close ones.
    expect(channelDistance('#000000', '#0000ff')).toBe(255)
  })

  it('is case-insensitive across the two palettes', () => {
    // The artwork writes upper case, the brand table lower.
    expect(channelDistance('#CA2A51', '#ca2a51')).toBe(0)
  })
})

describe('colourMatches', () => {
  it('accepts a line against its own artwork stroke', () => {
    expect(colourMatches('#CA2A51', '#ca2a51')).toBe(true)
  })

  it('rejects the confirmed failure: a yellow line on a blue stroke', () => {
    // Koridor 3's yellow traced onto the blue stub beside it. This is the case
    // the whole discriminator exists for.
    expect(colourMatches('#2355A2', '#F8C434')).toBe(false)
  })

  it('accepts a stroke coloured as a line that shares this track', () => {
    // The sheet draws shared track once, in one line's colour. LRT Jabodebek's
    // Cibubur line runs the Dukuh Atas to Cawang trunk drawn in Bekasi's green;
    // refusing it leaves a hole in the middle of the line being isolated.
    expect(colourMatches('#036C3E', '#21409A', ['#006838'])).toBe(true)
  })

  it('still refuses a parallel stroke when no sharing line owns its colour', () => {
    // The narrowing that keeps this an exception rather than a hole: a neighbour
    // that goes somewhere else does not get to lend its colour.
    expect(colourMatches('#2355A2', '#F8C434', ['#EE3D43'])).toBe(false)
    expect(colourMatches('#2355A2', '#F8C434', [])).toBe(false)
  })

  it('treats an unknown corridor colour as eligible', () => {
    expect(colourMatches(null, '#F8C434')).toBe(true)
  })

  it('treats an unknown line colour as eligible', () => {
    expect(colourMatches('#CA2A51', undefined)).toBe(true)
  })
})

describe('the shipped map-corridors.json', () => {
  const { corridors } = corridorsManifest as { corridors: Array<{ w: number, c: string, pts: number[][] }> }

  it('carries an artwork colour on every corridor', () => {
    // The whole point of the extraction change: colour arrives with the geometry
    // instead of being recovered afterwards. A corridor without one cannot be
    // filtered, so it would silently fall back to distance-only matching.
    expect(corridors.length).toBeGreaterThan(0)
    for (const corridor of corridors) {
      expect(corridor.c).toMatch(/^#[0-9A-F]{6}$/)
    }
  })

  it('covers BRT as well as rail', () => {
    // The skeleton join this replaced could only ever colour rail. BRT colour is
    // what lets the route overlay stop tracing Koridor 3 onto a blue stub.
    expect(corridors.filter(c => c.w === 25).length).toBeGreaterThanOrEqual(16)
    expect(corridors.filter(c => c.w === 15).length).toBeGreaterThanOrEqual(38)
    expect(corridors.filter(c => c.w === 15).every(c => c.c)).toBe(true)
  })

  it('keeps the short connectors the length filter used to drop', () => {
    // One of them runs through Jatinegara and is exactly the geometry line
    // tracing previously had to reinvent as a hand-authored bridge.
    const short = corridors.filter((corridor) => {
      let length = 0
      for (let i = 0; i < corridor.pts.length - 1; i++) {
        length += Math.hypot(
          corridor.pts[i + 1][0] - corridor.pts[i][0],
          corridor.pts[i + 1][1] - corridor.pts[i][1]
        )
      }
      return length < 320
    })
    expect(short.length).toBeGreaterThan(0)
  })

  it('separates most of the rail palette at the working tolerance', () => {
    // The discriminator is only worth having if the shipped colours actually
    // fall outside it. Measured: 10 rail colours, closest pair 36 apart.
    const distinct = [...new Set(corridors.filter(c => c.w === 25).map(c => c.c))]
    expect(distinct.length).toBeGreaterThanOrEqual(8)
    const pairs: number[] = []
    for (let i = 0; i < distinct.length; i++) {
      for (let j = i + 1; j < distinct.length; j++) {
        pairs.push(channelDistance(distinct[i], distinct[j]))
      }
    }
    expect(pairs.filter(d => d > CORRIDOR_COLOUR_TOLERANCE).length / pairs.length).toBeGreaterThan(0.75)
    expect(Math.max(...pairs)).toBeGreaterThan(CORRIDOR_COLOUR_TOLERANCE * 3)
  })

  it('rejects the wrong stroke for the case that motivated this', () => {
    // Koridor 3 traced onto the blue stub beside it.
    expect(colourMatches('#2355A2', '#F8C434')).toBe(false)
    for (const corridor of corridors) expect(colourMatches(corridor.c, corridor.c)).toBe(true)
  })
})

/*
 * The ink election is what supplies a BRT line's identity, so these pin the two
 * ways it can go wrong: failing to correct a brand that lies about the artwork,
 * and correcting one it should have left alone.
 *
 * Synthetic geometry is legitimate here because the election is pure tallying —
 * unlike the tracer tests, which need real corridors to be non-vacuous.
 */
describe('electArtworkColour', () => {
  // A stop votes for every distinct ink within reach; `at` places one stop on a
  // named stroke by giving that stroke distance 0 and all others a long way off.
  const ballot = (rows: Array<{ c: string, on: number[] }>): ReadonlyArray<{ c: string, project: (x: number, y: number) => number }> =>
    rows.map(row => ({
      c: row.c,
      project: (x: number) => (row.on.includes(x) ? 0 : 999)
    }))
  const stops = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }))

  it('elects the dominant ink over a minority stroke that matches the brand', () => {
    /*
     * TJ:7F in miniature, the case the whole mechanism exists for: the line is
     * DRAWN in crimson but BRANDED brown, and the brown-ish stub it merely
     * crosses is what the brand gate would accept. Six stops on the crimson,
     * two on the stub.
     */
    const corridors = ballot([
      { c: '#F71752', on: [0, 1, 2, 3, 4, 5] },
      { c: '#CD4411', on: [6, 7] }
    ])
    expect(electArtworkColour(stops(8), corridors, '#914900')).toBe('#F71752')
  })

  it('keeps the brand colour when no ink leads', () => {
    // Genuinely shared infrastructure: two inks tie, so there is nothing to
    // learn and the brand stands.
    const corridors = ballot([
      { c: '#F71752', on: [0, 1, 2] },
      { c: '#CD4411', on: [3, 4, 5] }
    ])
    expect(electArtworkColour(stops(6), corridors, '#914900')).toBe('#914900')
  })

  it('keeps the brand colour below the vote floor', () => {
    // Two stops is a coincidence, not a corridor.
    const corridors = ballot([{ c: '#F71752', on: [0, 1] }])
    expect(electArtworkColour(stops(2), corridors, '#914900')).toBe('#914900')
  })

  it('counts one vote per stop, not per stroke', () => {
    /*
     * Three strokes of one hex drawn on top of each other must not outvote four
     * stops on another, or a single interchange would rename the line.
     */
    const corridors = ballot([
      { c: '#1F2B8D', on: [0] },
      { c: '#1F2B8D', on: [0] },
      { c: '#1F2B8D', on: [0] },
      { c: '#3AA43C', on: [1, 2, 3, 4] }
    ])
    expect(electArtworkColour(stops(5), corridors, '#3AA43C')).toBe('#3AA43C')
  })

  it('refuses to overrule the brand on a thin ballot', () => {
    /*
     * The election must not be able to rubber-stamp the one stroke a short line
     * happens to sit near: that would hand the colour gate the very stroke it
     * exists to refuse. Three stops clears the ordinary floor but not the higher
     * bar for contradicting the brand outright.
     */
    const corridors = ballot([{ c: '#2355A2', on: [0, 1, 2] }])
    expect(electArtworkColour(stops(3), corridors, '#F8C434')).toBe('#F8C434')
  })

  it('overrules the brand when most of a long line agrees', () => {
    // The same shape as TJ:14, which is drawn in an orange its brand never names.
    const corridors = ballot([{ c: '#FA7116', on: [0, 1, 2, 3, 4, 5, 6] }])
    expect(electArtworkColour(stops(8), corridors, '#F5AB6E')).toBe('#FA7116')
  })

  it('returns the brand colour when there are no corridors', () => {
    expect(electArtworkColour(stops(5), [], '#914900')).toBe('#914900')
  })

  it('keeps the colour-blind path colour-blind', () => {
    // An undefined brand disables the gate entirely; the election must not
    // quietly switch it back on.
    const corridors = ballot([{ c: '#F71752', on: [0, 1, 2, 3, 4, 5] }])
    expect(electArtworkColour(stops(6), corridors, undefined)).toBe('#F71752')
  })
})
