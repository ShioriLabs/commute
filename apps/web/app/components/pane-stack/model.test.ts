import { describe, expect, it } from 'vitest'
import {
  canPush,
  deckGeometry,
  MAX_PANE_STACK_DEPTH,
  paneKey,
  paneUrl,
  type PaneDescriptor,
  type StackedPane
} from './model'

const station: PaneDescriptor = { kind: 'station', operator: 'KCI', code: 'MRI' }
const timetable: PaneDescriptor = { kind: 'timetable', operator: 'KCI', code: 'MRI' }

function stacked(pane: PaneDescriptor, exiting = false): StackedPane {
  return { key: paneKey(pane), exiting }
}

describe('paneUrl', () => {
  it('maps a station onto its canonical route', () => {
    expect(paneUrl(station)).toBe('/stations/KCI/MRI')
  })

  it('maps a timetable onto the station route plus /timetable', () => {
    expect(paneUrl(timetable)).toBe('/stations/KCI/MRI/timetable')
  })

  it('passes operator and code through untouched', () => {
    // Halte codes contain hyphens and case that the API treats as canonical.
    expect(paneUrl({ kind: 'station', operator: 'TJ', code: 'H00037C-b' }))
      .toBe('/stations/TJ/H00037C-b')
  })
})

describe('paneKey', () => {
  it('separates the two kinds for the same station', () => {
    expect(paneKey(station)).not.toBe(paneKey(timetable))
  })

  it('separates two stations of the same kind', () => {
    expect(paneKey(station)).not.toBe(paneKey({ kind: 'station', operator: 'KCI', code: 'THB' }))
  })
})

describe('deckGeometry', () => {
  it('leaves the top card exactly where it is', () => {
    // The regression guard for "an empty stack looks like it did before": if
    // this is ever non-identity, every existing map detail card moves.
    expect(deckGeometry(0)).toEqual({ x: 0, scale: 1 })
  })

  it('pushes each deeper card further left and smaller', () => {
    const slots = Array.from({ length: MAX_PANE_STACK_DEPTH + 1 }, (_, i) => deckGeometry(i))
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].x).toBeLessThan(slots[i - 1].x)
      expect(slots[i].scale).toBeLessThan(slots[i - 1].scale)
    }
  })

  it('keeps the deepest reachable card on screen', () => {
    // The card is `left-4`, a 16px inset. A card whose left edge goes negative
    // is clipped by the viewport and stops reading as part of the deck.
    const CARD_LEFT_INSET_PX = 16
    expect(CARD_LEFT_INSET_PX + deckGeometry(MAX_PANE_STACK_DEPTH).x).toBeGreaterThan(0)
  })

  it('clamps past the depth cap rather than running off screen', () => {
    expect(deckGeometry(MAX_PANE_STACK_DEPTH + 5)).toEqual(deckGeometry(MAX_PANE_STACK_DEPTH))
  })

  it('clamps a negative depth to the top slot', () => {
    expect(deckGeometry(-1)).toEqual(deckGeometry(0))
  })
})

describe('canPush', () => {
  it('allows the first push onto a bare base card', () => {
    expect(canPush([], timetable)).toBe(true)
  })

  it('refuses once the stack is at the depth cap', () => {
    // At the cap the caller navigates instead, which is what the timetable link
    // does today anyway — a refused push is never a dead click.
    const full = Array.from({ length: MAX_PANE_STACK_DEPTH }, (_, i) =>
      stacked({ kind: 'station', operator: 'KCI', code: `S${i}` }))
    expect(canPush(full, timetable)).toBe(false)
  })

  it('refuses a duplicate of the current top card', () => {
    expect(canPush([stacked(timetable)], timetable)).toBe(false)
  })

  it('refuses while any entry is animating out', () => {
    expect(canPush([stacked(station, true)], timetable)).toBe(false)
  })
})
