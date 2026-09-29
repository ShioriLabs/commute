import { describe, expect, it } from 'vitest'
import type { Stop } from 'db/data/topology'
import { chainHops, oneWayTurns, stopLists } from './edgeChain'

const stop = (station: string, serves?: Stop['serves']): Stop => ({ station, pos: station, serves })
const summary = (stops: Stop[]) => chainHops(stops).map(h =>
  `${h.from.station}${h.bothWays ? '<->' : '->'}${h.to.station}${h.via.length ? ` via ${h.via.map(s => s.station).join(',')}` : ''}`)

describe('chainHops', () => {
  it('pairs consecutive stops both ways when nothing is directional', () => {
    expect(summary([stop('A'), stop('B'), stop('C')])).toEqual(['A<->B', 'B<->C'])
  })

  it('bridges a forward-only stop in the reverse direction', () => {
    // Pasar Senen: GST -> PSE -> KMO stops there, KMO -> GST runs through.
    expect(summary([stop('GST'), stop('PSE', 'forward'), stop('KMO')])).toEqual([
      'GST->PSE', 'PSE->KMO',
      'KMO->GST via PSE'
    ])
  })

  it('bridges a reverse-only stop in the forward direction', () => {
    expect(summary([stop('A'), stop('B', 'reverse'), stop('C')])).toEqual([
      'A->C via B',
      'C->B', 'B->A'
    ])
  })

  it('emits the untouched hops of a directional list in both directions', () => {
    expect(summary([stop('A'), stop('B'), stop('C', 'forward'), stop('D')])).toEqual([
      'A->B', 'B->C', 'C->D',
      'D->B via C', 'B->A'
    ])
  })

  it('lets opposite-direction stops sit next to each other', () => {
    // A TJ-style split: B served one way, C the other, on the same street.
    expect(summary([stop('A'), stop('B', 'forward'), stop('C', 'reverse'), stop('D')])).toEqual([
      'A->B', 'B->D via C',
      'D->C', 'C->A via B'
    ])
  })

  it('refuses a directional stop at either end of the list', () => {
    expect(() => chainHops([stop('A', 'forward'), stop('B'), stop('C')])).toThrow(/end of the list/)
    expect(() => chainHops([stop('A'), stop('B'), stop('C', 'reverse')])).toThrow(/end of the list/)
  })

  it('refuses two adjacent stops skipped in the same direction', () => {
    expect(() => chainHops([stop('A'), stop('B', 'forward'), stop('C', 'forward'), stop('D')])).toThrow(/skip-stop/)
  })

  it('bridges a run of pass-through stops both ways', () => {
    // LRTJ: Rawamangun -> Manggarai runs through S08-S10 without calling.
    const through = (station: string): Stop => ({ station, pos: station, passThrough: true })
    expect(summary([stop('VEL'), stop('RWM'), through('PKA'), through('KYM'), through('MAT'), stop('MGI')])).toEqual([
      'VEL<->RWM', 'RWM<->MGI via PKA,KYM,MAT'
    ])
  })

  it('refuses a pass-through stop at either end of the list', () => {
    expect(() => chainHops([{ station: 'A', pos: 'A', passThrough: true }, stop('B')])).toThrow(/end of the list/)
  })
})

// The Cikarang loop in miniature: a stick into JNG, a loop branch closing back
// onto it, and PSE served in the branch's written direction only.
const lollipop = {
  operator: 'KCI' as const,
  lineCode: 'C',
  path: [stop('CKR'), stop('JNG')],
  branches: [{ fromStation: 'JNG', closeTo: 'JNG', path: [stop('KMT'), stop('GST'), stop('PSE', 'forward'), stop('KMO'), stop('RJW')] }]
}

describe('stopLists', () => {
  it('chains each branch from its junction to its closure', () => {
    expect(stopLists(lollipop).map(list => list.map(s => s.station))).toEqual([
      ['CKR', 'JNG'],
      ['JNG', 'KMT', 'GST', 'PSE', 'KMO', 'RJW', 'JNG']
    ])
  })
})

describe('oneWayTurns', () => {
  it('names the two U-turns a one-way stop creates, and nothing else', () => {
    // PSE -> KMO -> GST: out on a northbound train, back on a southbound one.
    // KMO -> GST -> PSE: out southbound past PSE, back northbound to call there.
    expect(oneWayTurns(lollipop)).toEqual([
      { from: 'PSE', via: 'KMO', to: 'GST' },
      { from: 'KMO', via: 'GST', to: 'PSE' }
    ])
  })

  it('finds none on a line without directional stops', () => {
    expect(oneWayTurns({ ...lollipop, branches: [] })).toEqual([])
  })
})
