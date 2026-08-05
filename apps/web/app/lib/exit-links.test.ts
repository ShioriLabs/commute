import { describe, expect, it } from 'vitest'
import { isLiteSurface, resolveExitFor } from './exit-links'

// `resolveExitFor` takes the flag rather than reading IS_LITE, so both builds
// are covered here without stubbing import.meta.env. The one thing these tests
// cannot check is that the call sites pass the right flag — that is what
// `resolveExit`'s one-line body is for.

describe('isLiteSurface', () => {
  it.each([
    ['/', true],
    ['/map', true],
    ['/fare', true],
    ['/fare?from=KCI-MRI&to=KCI-BOO', true],
    ['/map#anchor', true],
    ['/stations/KCI/MRI', false],
    ['/stations/KCI/MRI/timetable', false],
    ['/hubs/dukuh-atas', false],
    ['/lines/KCI/C', false],
    ['/settings/about', false],
    ['/search', false]
  ])('%s -> %s', (path, expected) => {
    expect(isLiteSurface(path)).toBe(expected)
  })

  it('does not treat a route that merely starts with a surface name as hosted', () => {
    // '/mapping' is not '/map'. Prefix matching has to respect the segment
    // boundary or an unrelated future route silently stops funnelling out.
    expect(isLiteSurface('/mapping')).toBe(false)
    expect(isLiteSurface('/fares-legacy')).toBe(false)
  })
})

describe('resolveExitFor', () => {
  describe('normal build', () => {
    it.each([
      '/',
      '/map',
      '/fare?from=KCI-MRI&to=KCI-BOO',
      '/stations/KCI/MRI',
      '/hubs/dukuh-atas',
      '/lines/KCI/C'
    ])('keeps %s internal', (path) => {
      expect(resolveExitFor(path, false)).toEqual({ kind: 'internal', to: path })
    })
  })

  describe('lite build', () => {
    it.each([
      '/',
      '/map',
      '/fare',
      '/fare?from=KCI-MRI&to=KCI-BOO'
    ])('keeps the hosted surface %s internal', (path) => {
      expect(resolveExitFor(path, true)).toEqual({ kind: 'internal', to: path })
    })

    it.each([
      ['/stations/KCI/MRI', 'https://commute.shiorilabs.id/stations/KCI/MRI'],
      ['/stations/KCI/MRI/timetable', 'https://commute.shiorilabs.id/stations/KCI/MRI/timetable'],
      ['/hubs/dukuh-atas', 'https://commute.shiorilabs.id/hubs/dukuh-atas'],
      ['/lines/KCI/C', 'https://commute.shiorilabs.id/lines/KCI/C']
    ])('sends %s to the full app', (path, href) => {
      expect(resolveExitFor(path, true)).toEqual({ kind: 'external', href })
    })

    it('preserves the query string when funnelling out', () => {
      expect(resolveExitFor('/search?q=manggarai', true)).toEqual({
        kind: 'external',
        href: 'https://commute.shiorilabs.id/search?q=manggarai'
      })
    })
  })
})
