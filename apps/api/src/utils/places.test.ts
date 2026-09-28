import { describe, expect, it } from 'vitest'
import { buildPlaceIndex, endpointsFor, placeOf } from 'utils/places'

const station = (id: string, officialName: string) => ({ id, operator: id.split('-')[0]!, officialName })

describe('buildPlaceIndex', () => {
  const index = buildPlaceIndex(
    [['LRTJBDB-RAS', 'TJ-RAS'], ['LRTJBDB-PAN', 'TJ-PAN-T']],
    [
      station('TJ-GGL-U', 'Kali Grogol Arah Utara'),
      station('TJ-GGL-S', 'Kali Grogol Arah Selatan'),
      station('TJ-PAN-T', 'Pancoran Arah Timur'),
      station('TJ-PAN-B', 'Pancoran Arah Barat'),
      station('TJ-RAS', 'Rasuna Said'),
      // Same base name on another operator: never folded into the TJ pair.
      station('KCI-GGL', 'Grogol Arah Utara')
    ]
  )

  it('makes an integrated hub one place', () => {
    expect([...placeOf(index, 'TJ-RAS')].sort()).toEqual(['LRTJBDB-RAS', 'TJ-RAS'])
  })

  it('makes an Arah pair one place, per operator', () => {
    expect([...placeOf(index, 'TJ-GGL-S')].sort()).toEqual(['TJ-GGL-S', 'TJ-GGL-U'])
    expect([...placeOf(index, 'KCI-GGL')]).toEqual(['KCI-GGL'])
  })

  it('unions a halte pair with the integrated hub one side belongs to', () => {
    expect([...placeOf(index, 'TJ-PAN-B')].sort()).toEqual(['LRTJBDB-PAN', 'TJ-PAN-B', 'TJ-PAN-T'])
    expect([...placeOf(index, 'LRTJBDB-PAN')].sort()).toEqual(['LRTJBDB-PAN', 'TJ-PAN-B', 'TJ-PAN-T'])
  })

  it('answers an ungrouped station with just itself', () => {
    expect([...placeOf(index, 'MRTJ-LBB')]).toEqual(['MRTJ-LBB'])
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
