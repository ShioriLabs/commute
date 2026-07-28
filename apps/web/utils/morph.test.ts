import { describe, expect, it } from 'vitest'
import { morphStyle, type Box } from './morph'

const box = (left: number, top: number, width: number, height: number): Box =>
  ({ left, top, width, height })

// A phone-sized sheet and the nav-rail card it morphs from, taken from the real
// layout: a 168x128 card at (16, 700) against a 412x915 viewport.
const CARD = box(16, 700, 168, 128)
const SHEET = box(0, 0, 412, 915)

describe('morphStyle', () => {
  it('collapses the sheet onto the card', () => {
    const morph = morphStyle(CARD, SHEET, 0)
    expect(morph?.transform).toBe(`translate(16px, 700px) scale(${168 / 412}, ${128 / 915})`)
  })

  it('is the identity when the boxes already match', () => {
    const morph = morphStyle(SHEET, SHEET, 0)
    expect(morph?.transform).toBe('translate(0px, 0px) scale(1, 1)')
  })

  it('offsets by the difference between the two origins, not by the card alone', () => {
    // A sheet that does not start at the viewport origin — `mt-auto` pushes it
    // down whenever it is shorter than its container, which is exactly the case
    // the old window.innerHeight-based math got wrong.
    const morph = morphStyle(CARD, box(0, 55, 412, 860), 0)
    expect(morph?.transform).toContain('translate(16px, 645px)')
  })

  it('counter-scales the radius on both axes so it lands on the card value', () => {
    const morph = morphStyle(CARD, SHEET, 12)
    const scaleX = 168 / 412
    const scaleY = 128 / 915
    expect(morph?.radius).toBe(`${12 / scaleX}px / ${12 / scaleY}px`)

    // The point of the counter-scale: painted through the transform, each axis
    // comes back out at the card's own 12px rather than the ~5px x ~2px sliver
    // the uncorrected value produced.
    expect(12 / scaleX * scaleX).toBeCloseTo(12)
    expect(12 / scaleY * scaleY).toBeCloseTo(12)
  })

  it('returns null rather than an Infinity transform when a box has no area', () => {
    expect(morphStyle(CARD, box(0, 0, 0, 915), 12)).toBeNull()
    expect(morphStyle(CARD, box(0, 0, 412, 0), 12)).toBeNull()
    expect(morphStyle(box(0, 0, 0, 0), SHEET, 12)).toBeNull()
  })
})
