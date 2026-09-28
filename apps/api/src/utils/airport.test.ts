import { describe, expect, it } from 'vitest'
import type { RouteLeg } from '@commute/tsundere'
import { airportExclusion, ridesAirportPairsOnly, withAirportExclusion } from 'utils/airport'

const ride = (lineCode: string, from: string, to: string): RouteLeg =>
  ({ type: 'RIDE', operator: from.split('-')[0]!, lineCode, fromStationId: from, toStationId: to, stationIds: [from, to], distanceM: 1000 })

describe('airportExclusion', () => {
  it('offers line A when either end is the airport station or a Kalayang stop', () => {
    expect(airportExclusion('KCI-BOO', 'KCI-BST').size).toBe(0)
    expect(airportExclusion('KCI-BST', 'KCI-BOO').size).toBe(0)
    expect(airportExclusion('APCGK-T3', 'KCI-MRI').size).toBe(0)
  })

  it('excludes line A for every city trip', () => {
    expect([...airportExclusion('KCI-MRI', 'KCI-DU')]).toEqual(['A'])
  })

  it('counts any member of a place as the airport', () => {
    expect(airportExclusion(new Set(['KCI-MRI', 'TJ-X']), new Set(['KCI-SUDB'])).size).toBe(1)
    expect(airportExclusion(new Set(['KCI-MRI']), new Set(['KCI-BST', 'APCGK-SHIA'])).size).toBe(0)
  })

  it('merges with an exclusion the rider already asked for', () => {
    expect([...withAirportExclusion('KCI-MRI', 'KCI-DU', new Set(['1']))].sort()).toEqual(['1', 'A'])
    expect([...withAirportExclusion('KCI-MRI', 'KCI-BST', new Set(['1']))]).toEqual(['1'])
  })
})

describe('ridesAirportPairsOnly', () => {
  it('accepts an A ride that starts or ends at BST', () => {
    expect(ridesAirportPairsOnly([ride('B', 'KCI-BOO', 'KCI-MRI'), ride('A', 'KCI-MRI', 'KCI-BST')])).toBe(true)
  })

  it('rejects an A ride between two city stations', () => {
    expect(ridesAirportPairsOnly([ride('A', 'KCI-MRI', 'KCI-DU'), ride('T', 'KCI-DU', 'KCI-TNG')])).toBe(false)
  })
})
