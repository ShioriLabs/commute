import { describe, expect, it } from 'vitest'
import corridorsManifest from '../data/map-corridors.json'
import skeletonManifest from '../data/map-skeleton.json'
import {
  CORRIDOR_COLOUR_TOLERANCE,
  channelDistance,
  colourMatches,
  corridorColours
} from './map-corridor-colour'
import type { Corridor } from './map-corridors'
import type { SkeletonStroke } from 'utils/map-skeleton-order'

// The join is what gives line isolation a discriminator the corridors file does
// not carry. Getting it wrong does not fail loudly at runtime — it holds the
// wrong line at full strength — so these are the tests standing in for that.

const corridor = (pts: Array<[number, number]>, w = 25): Corridor => ({ w, pts })
const stroke = (c: string, d: string, w = 25): SkeletonStroke => ({ c, w, cx: 0, cy: 0, d })

describe('corridorColours', () => {
  it('joins a corridor to the stroke sharing both its endpoints', () => {
    const colours = corridorColours(
      [corridor([[0, 0], [100, 0]])],
      [stroke('#1351A1', 'M0 0L50 0L100 0')]
    )
    expect(colours).toEqual(['#1351A1'])
  })

  it('joins a stroke drawn in the opposite direction', () => {
    // The two files agree on direction today, but a reversed polyline is a
    // plausible regeneration artefact and colouring from the wrong stroke is
    // worse than the cost of checking both ways.
    const colours = corridorColours(
      [corridor([[0, 0], [100, 0]])],
      [stroke('#036C3E', 'M100 0L0 0')]
    )
    expect(colours).toEqual(['#036C3E'])
  })

  it('does not join on one shared endpoint', () => {
    // Every stroke meeting at a junction shares an endpoint. Joining on one
    // would colour a corridor from whichever neighbour was listed first, which
    // is the exact error the join exists to prevent.
    const colours = corridorColours(
      [corridor([[0, 0], [100, 0]])],
      [stroke('#EE3637', 'M0 0L0 500')]
    )
    expect(colours).toEqual([null])
  })

  it('refuses an ambiguous join rather than taking the first', () => {
    // Two strokes answering to one corridor means the endpoint join is no longer
    // an identity. An unknown colour is safe; a wrong one is not.
    const colours = corridorColours(
      [corridor([[0, 0], [100, 0]])],
      [stroke('#EE3637', 'M0 0L100 0'), stroke('#00BDEE', 'M0 0L100 0')]
    )
    expect(colours).toEqual([null])
  })

  it('keeps a duplicate join when both strokes agree on the colour', () => {
    const colours = corridorColours(
      [corridor([[0, 0], [100, 0]])],
      [stroke('#EE3637', 'M0 0L100 0'), stroke('#EE3637', 'M0 0L50 0L100 0')]
    )
    expect(colours).toEqual(['#EE3637'])
  })

  it('returns null for a BRT corridor, which has no stroke to join', () => {
    // The skeleton is rail-only by construction. Null here must read as "no
    // colour information" and never as "no match", or deferring BRT silently
    // becomes excluding it.
    const colours = corridorColours(
      [corridor([[0, 0], [100, 0]], 15)],
      [stroke('#1351A1', 'M900 900L1000 900')]
    )
    expect(colours).toEqual([null])
  })

  it('returns one entry per corridor, aligned by index', () => {
    const colours = corridorColours(
      [corridor([[0, 0], [100, 0]]), corridor([[500, 500], [600, 500]])],
      [stroke('#90C854', 'M500 500L600 500')]
    )
    expect(colours).toEqual([null, '#90C854'])
  })
})

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

describe('the shipped map-corridors.json against map-skeleton.json', () => {
  const { corridors } = corridorsManifest as { corridors: Array<{ w: number, pts: number[][] }> }
  const { strokes } = skeletonManifest as { strokes: SkeletonStroke[] }
  const rail = corridors.filter(c => c.w === 25) as unknown as Corridor[]

  it('is generated from the same pass, so rail counts agree', () => {
    // Both files are written by build-map-skeleton.ts from one extraction. If
    // these diverge, one was regenerated without the other and the join below is
    // no longer trustworthy.
    expect(strokes.length).toBe(rail.length)
    expect(strokes.every(s => s.w === 25)).toBe(true)
  })

  it('colours every rail corridor, with no ambiguity', () => {
    // Measured 16/16 with zero ambiguous joins. A drop here means a regenerated
    // artifact moved endpoints, and line isolation has lost its discriminator.
    const colours = corridorColours(rail, strokes)
    expect(colours.filter(c => c !== null)).toHaveLength(rail.length)
  })

  it('leaves BRT corridors uncoloured', () => {
    const brt = corridors.filter(c => c.w === 15) as unknown as Corridor[]
    expect(brt.length).toBeGreaterThan(0)
    expect(corridorColours(brt, strokes).every(c => c === null)).toBe(true)
  })

  it('separates most of the rail palette at the working tolerance', () => {
    // The discriminator is only worth having if the shipped colours actually
    // fall outside it. Measured today: 10 distinct colours, 45 pairs, 37 of them
    // beyond the tolerance and the closest pair 36 apart (two reds).
    const distinct = [...new Set(strokes.map(s => s.c))]
    expect(distinct.length).toBeGreaterThanOrEqual(8)
    const pairs: number[] = []
    for (let i = 0; i < distinct.length; i++) {
      for (let j = i + 1; j < distinct.length; j++) {
        pairs.push(channelDistance(distinct[i], distinct[j]))
      }
    }
    const separated = pairs.filter(d => d > CORRIDOR_COLOUR_TOLERANCE).length
    expect(separated / pairs.length).toBeGreaterThan(0.75)
    // The pairs that do NOT separate must be the genuinely-similar ones, not an
    // artefact of the tolerance being set far too loose.
    expect(Math.max(...pairs)).toBeGreaterThan(CORRIDOR_COLOUR_TOLERANCE * 3)
  })

  it('rejects the wrong stroke for the case that motivated this', () => {
    // Koridor 3 traced onto the blue stub beside it, sampled off the artwork.
    // Not a rail case, but it is the failure the discriminator has to catch, and
    // the tolerance has to stay tight enough to catch it.
    expect(colourMatches('#2355A2', '#F8C434')).toBe(false)
    // ...while a line still matches its own stroke across palette drift.
    for (const s of strokes) expect(colourMatches(s.c, s.c)).toBe(true)
  })
})
