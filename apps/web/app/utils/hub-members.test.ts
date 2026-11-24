import { describe, expect, it } from 'vitest'
import {
  directionLabel,
  groupByOperator,
  headingOf,
  type HubMember,
  isAirportRail,
  isPlaceHub,
  orderDirections,
  resolveMember,
  splitKeepTogether,
  tileLabel
} from './hub-members'

const member = (operator: string, code: string, officialName: string, lines: string[] = []): HubMember => ({
  id: `${operator}-${code}`,
  name: officialName,
  officialName,
  code,
  operator: operator as HubMember['operator'],
  lines
})

// Pancoran as the API returns it: LRT first, then both TJ sides, Timur first.
const pancoran = [
  member('LRTJBDB', 'PAN', 'Pancoran', ['LRTJBDB:BK', 'LRTJBDB:CB']),
  member('TJ', 'H00198S', 'Pancoran Arah Timur', ['TJ:9']),
  member('TJ', 'H00203S', 'Pancoran Arah Barat', ['TJ:9'])
]

describe('hub members', () => {
  it('treats only integrated and directional hubs as one place', () => {
    expect(isPlaceHub('integrated')).toBe(true)
    expect(isPlaceHub('directional')).toBe(true)
    expect(isPlaceHub('hub')).toBe(false)
    expect(isPlaceHub(null)).toBe(false)
  })

  it('groups members into one tile per operator, in API order', () => {
    const groups = groupByOperator(pancoran)
    expect(groups.map(g => g.operator)).toEqual(['LRTJBDB', 'TJ'])
    expect(groups[1]!.members.map(m => m.code)).toEqual(['H00198S', 'H00203S'])
  })

  it('reads the side and its arrow off the official name', () => {
    expect(directionLabel(pancoran[1]!)).toBe('Arah Timur')
    expect(headingOf(pancoran[1]!)).toBe('right')
    expect(headingOf(member('TJ', 'H00138S', 'Kali Grogol Arah Utara'))).toBe('up')
    expect(directionLabel(pancoran[0]!)).toBeNull()
  })

  it('puts the right-pointing side last and keeps the rest in order', () => {
    expect(orderDirections(pancoran).map(directionLabel)).toEqual(['Arah Barat', 'Arah Timur'])
    const grogol = [member('TJ', 'H00138S', 'Kali Grogol Arah Utara'), member('TJ', 'H00197S', 'Kali Grogol Arah Selatan')]
    expect(orderDirections(grogol).map(directionLabel)).toEqual(['Arah Utara', 'Arah Selatan'])
  })

  it('labels the airport line ARL only when it serves nothing else', () => {
    const bandara = member('KCI', 'BST', 'Bandara Soekarno-Hatta', ['KCI:A'])
    const batuCeper = member('KCI', 'BPR', 'Batu Ceper', ['KCI:A', 'KCI:C'])
    expect(isAirportRail(bandara)).toBe(true)
    expect(tileLabel(bandara)).toBe('ARL')
    expect(tileLabel(batuCeper)).toBe('KRL')
    expect(tileLabel(pancoran[1]!)).toBe('BRT')
    expect(tileLabel(member('APCGK', 'T1', 'Stasiun KA Bandara'))).toBe('APM')
  })

  it('keeps Soekarno-Hatta in one piece', () => {
    expect(splitKeepTogether('Bandara Soekarno-Hatta')).toEqual({ before: 'Bandara ', phrase: 'Soekarno-Hatta', after: '' })
    expect(splitKeepTogether('Pancoran')).toBeNull()
  })

  it('resolves the requested member, else the first', () => {
    expect(resolveMember(pancoran, 'TJ-H00203S')?.code).toBe('H00203S')
    expect(resolveMember(pancoran, 'nope')?.code).toBe('PAN')
    expect(resolveMember([], null)).toBeNull()
  })
})
