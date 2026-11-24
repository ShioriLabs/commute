import { describe, expect, it } from 'vitest'
import { buildPlaceIndex, endpointsFor, placeOf } from 'utils/places'

describe('buildPlaceIndex', () => {
  // Only `integrated` and `directional` hubs reach here (getPlaceMemberIds);
  // `hub`-kind complexes like Cawang are filtered out before.
  const index = buildPlaceIndex([
    ['LRTJBDB-RAS', 'TJ-RAS'], // integrated
    ['LRTJBDB-PAN', 'TJ-PAN-T'], // integrated, holding one side of a halte pair
    ['TJ-GGL-S', 'TJ-GGL-U'], // directional
    ['TJ-PAN-B', 'TJ-PAN-T'], // directional, overlapping the integrated hub
    ['TJ-CKK-B', 'TJ-CKK-T'], // directional, nested in the Cawang `hub`
    ['TJ-LONE'] // a one-member group is no place at all
  ])

  it('makes an integrated hub one place', () => {
    expect([...placeOf(index, 'TJ-RAS')].sort()).toEqual(['LRTJBDB-RAS', 'TJ-RAS'])
  })

  it('makes a directional hub one place', () => {
    expect([...placeOf(index, 'TJ-GGL-S')].sort()).toEqual(['TJ-GGL-S', 'TJ-GGL-U'])
  })

  it('unions a halte pair with the integrated hub one side belongs to', () => {
    expect([...placeOf(index, 'TJ-PAN-B')].sort()).toEqual(['LRTJBDB-PAN', 'TJ-PAN-B', 'TJ-PAN-T'])
    expect([...placeOf(index, 'LRTJBDB-PAN')].sort()).toEqual(['LRTJBDB-PAN', 'TJ-PAN-B', 'TJ-PAN-T'])
  })

  it('keeps a directional pair nested in a hub-kind complex to the pair alone', () => {
    expect([...placeOf(index, 'TJ-CKK-B')].sort()).toEqual(['TJ-CKK-B', 'TJ-CKK-T'])
    expect([...placeOf(index, 'KCI-CW')]).toEqual(['KCI-CW'])
  })

  it('answers an ungrouped station with just itself', () => {
    expect([...placeOf(index, 'MRTJ-LBB')]).toEqual(['MRTJ-LBB'])
    expect(index.has('TJ-LONE')).toBe(false)
  })

  it('falls back to the exact stations when origin and destination are one place', () => {
    const endpoints = endpointsFor(index, 'LRTJBDB-RAS', 'TJ-RAS')
    expect([...endpoints.originIds]).toEqual(['LRTJBDB-RAS'])
    expect([...endpoints.targetIds]).toEqual(['TJ-RAS'])
  })

  it('expands both sides otherwise', () => {
    const endpoints = endpointsFor(index, 'TJ-GGL-S', 'LRTJBDB-RAS')
    expect(endpoints.originIds.size).toBe(2)
    expect(endpoints.targetIds.size).toBe(2)
  })
})
