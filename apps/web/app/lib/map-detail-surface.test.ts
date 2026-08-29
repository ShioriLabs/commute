import { describe, expect, it } from 'vitest'
import { openSurface, isSurfaceOpen, type DetailSurfaceState } from './map-detail-surface'

const empty: DetailSurfaceState = {
  station: null,
  hubSlug: null,
  lineKey: null,
  fare: null
}

const station = { operator: 'KCI', code: 'MRI' }

describe('openSurface', () => {
  it('opening a station closes an open line', () => {
    // The reported bug: tapping a corridor then a station left both cards on
    // screen, two DetailSurfaces stacked on one layer.
    const next = openSurface({ ...empty, lineKey: 'KCI:C' }, { kind: 'station', station })
    expect(next.station).toEqual(station)
    expect(next.lineKey).toBeNull()
  })

  it('opening a line closes an open station', () => {
    const next = openSurface({ ...empty, station }, { kind: 'line', lineKey: 'KCI:C' })
    expect(next.lineKey).toBe('KCI:C')
    expect(next.station).toBeNull()
  })

  it('opening a hub closes an open line', () => {
    const next = openSurface({ ...empty, lineKey: 'KCI:C' }, { kind: 'hub', hubSlug: 'dukuh-atas' })
    expect(next.hubSlug).toBe('dukuh-atas')
    expect(next.lineKey).toBeNull()
  })

  it('opening the fare sheet closes an open line', () => {
    const next = openSurface({ ...empty, lineKey: 'KCI:C' }, { kind: 'fare', snap: 'peek' })
    expect(next.fare?.snap).toBe('peek')
    expect(next.lineKey).toBeNull()
  })

  it('leaves exactly one surface open from any starting state', () => {
    // The invariant the whole module exists to hold, checked exhaustively
    // rather than one transition at a time.
    const states: DetailSurfaceState[] = [
      empty,
      { ...empty, station },
      { ...empty, hubSlug: 'dukuh-atas' },
      { ...empty, lineKey: 'KCI:C' },
      { ...empty, fare: { snap: 'peek', id: 1 } }
    ]
    const opens = [
      { kind: 'station', station } as const,
      { kind: 'hub', hubSlug: 'dukuh-atas' } as const,
      { kind: 'line', lineKey: 'KCI:C' } as const,
      { kind: 'fare', snap: 'peek' } as const
    ]
    for (const from of states) {
      for (const open of opens) {
        const next = openSurface(from, open)
        const live = [next.station, next.hubSlug, next.lineKey, next.fare].filter(Boolean)
        expect(live).toHaveLength(1)
      }
    }
  })

  it('bumps the fare id so each opening remounts the sheet', () => {
    // MapFareSheet is keyed on this id; reusing it would leave the previous
    // sheet's drag state in place.
    const first = openSurface(empty, { kind: 'fare', snap: 'peek' })
    const second = openSurface(first, { kind: 'fare', snap: 'full' })
    expect(second.fare!.id).toBeGreaterThan(first.fare!.id)
  })
})

describe('isSurfaceOpen', () => {
  it('counts a line, not just station/hub/fare', () => {
    // Drives paneCoversChrome: with this false the title pill stayed visible
    // underneath an open line card.
    expect(isSurfaceOpen({ ...empty, lineKey: 'KCI:C' })).toBe(true)
  })

  it('is false only when nothing is open', () => {
    expect(isSurfaceOpen(empty)).toBe(false)
    expect(isSurfaceOpen({ ...empty, station })).toBe(true)
    expect(isSurfaceOpen({ ...empty, hubSlug: 'x' })).toBe(true)
    expect(isSurfaceOpen({ ...empty, fare: { snap: 'peek', id: 1 } })).toBe(true)
  })
})
