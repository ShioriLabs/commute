import { describe, expect, it } from 'vitest'
import corridorsManifest from '../data/map-corridors.json'
import {
  CORRIDOR_COLOUR_TOLERANCE,
  channelDistance,
  colourMatches
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
