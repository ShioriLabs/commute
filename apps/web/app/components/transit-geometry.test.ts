import { describe, expect, it } from 'vitest'
import { interlinedTrackFill, LINE_COLOR_FALLBACK } from './transit-geometry'

/*
 * The blend rule, pinned.
 *
 * Two things here are measured rather than chosen, so they are the parts worth
 * a test: the interpolation space (sRGB put a desaturated colour at the
 * midpoint that neither line owns) and the held ends (each service keeps a run
 * of track in its own colour).
 */
describe('interlinedTrackFill', () => {
  const BK = '#006838'
  const CB = '#21409A'

  it('returns a flat fill for a single line', () => {
    expect(interlinedTrackFill([BK])).toEqual({ backgroundColor: BK })
  })

  it('falls back to neutral grey when given no colours', () => {
    expect(interlinedTrackFill([])).toEqual({ backgroundColor: LINE_COLOR_FALLBACK })
  })

  /*
   * The whole point of the change. sRGB interpolation runs BK -> CB through
   * #105469, whose chroma (0.072) is below BOTH endpoints (0.114 and 0.152) —
   * a desaturated colour is what reads as muddy. OKLCH interpolates hue and
   * chroma separately and carries 0.133 through the middle instead.
   */
  it('interpolates in oklch, not sRGB', () => {
    const { backgroundImage } = interlinedTrackFill([BK, CB])
    expect(backgroundImage).toContain('in oklch')
  })

  // Each service owns a run of track in its own colour, so the blend is a seam
  // between two identified lines rather than the subject of the segment.
  it('holds each end colour before blending', () => {
    const { backgroundImage } = interlinedTrackFill([BK, CB])
    expect(backgroundImage).toBe(`linear-gradient(to right in oklch, ${BK} 0 40%, ${CB} 60% 100%)`)
  })

  /*
   * Interlined TJ track carries up to five services, but they collapse to
   * fewer colours — 6 and 6A are both #1BAC47, 13E and L13E both #7A357B. Left
   * undeduped, the two seams between identical colours are invisible and the
   * held-end percentages are spent on stops that draw nothing.
   */
  it('dedupes repeated colours before splitting the track', () => {
    const { backgroundImage } = interlinedTrackFill(['#512C62', '#1BAC47', '#1BAC47', '#7A357B', '#7A357B'])
    expect(backgroundImage).toBe(
      'linear-gradient(to right in oklch, #512C62 0 23.3333%, #1BAC47 43.3333% 56.6667%, #7A357B 76.6667% 100%)'
    )
  })

  it('treats a leg whose services share one colour as a flat fill', () => {
    expect(interlinedTrackFill(['#1BAC47', '#1BAC47'])).toEqual({ backgroundColor: '#1BAC47' })
  })

  // Three distinct colours divide the track evenly, each still holding a run.
  it('spaces three colours evenly', () => {
    const { backgroundImage } = interlinedTrackFill(['#006838', '#21409A', '#7A357B'])
    expect(backgroundImage).toBe(
      'linear-gradient(to right in oklch, #006838 0 23.3333%, #21409A 43.3333% 56.6667%, #7A357B 76.6667% 100%)'
    )
  })

  // The outer edges are seams for nobody, so the run to 0% and 100% is flat.
  it('runs the first and last colours flat to the track ends', () => {
    const { backgroundImage } = interlinedTrackFill([BK, CB])
    expect(backgroundImage).toContain(`${BK} 0 `)
    expect(backgroundImage).toContain(`${CB} 60% 100%`)
  })

  // The route bar's track runs across the card; the timeline's runs down it.
  it('runs down the track when asked, with the same stops', () => {
    expect(interlinedTrackFill([BK, CB], 'to bottom')).toEqual({
      backgroundImage: `linear-gradient(to bottom in oklch, ${BK} 0 40%, ${CB} 60% 100%)`
    })
  })
})
