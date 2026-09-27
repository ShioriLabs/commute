import { describe, expect, it } from 'vitest'
import { DIRECTIONAL_HEADWAYS_S, LINE_TERMINI, STOP_HEADWAYS_S } from './headways'
import { TOPOLOGY } from './topology'

/*
 * Guards on the per-direction headway table.
 *
 * These assert properties of the GENERATED data rather than the generator's
 * internals, so they keep holding across a feed refresh — which is the point, as
 * the failure modes here are all "a new feed quietly changed what the classifier
 * believes".
 */

const keys = Object.keys(DIRECTIONAL_HEADWAYS_S)
const opposite = (key: string) => (key.endsWith('@F') ? `${key.slice(0, -1)}R` : `${key.slice(0, -1)}F`)

describe('DIRECTIONAL_HEADWAYS_S', () => {
  /*
   * A lone half is meaningful, not a bug: it means the corridor passes this halte
   * in one direction only, so the row is labelled rather than silently reporting a
   * one-way frequency as if it applied both ways. What must hold is that a lone
   * half is ALWAYS a stop the topology serves one way — never a dropped opposite.
   */
  it('only carries a lone direction where the topology serves one way', () => {
    const served = { F: new Set<string>(), R: new Set<string>() }
    for (const line of TOPOLOGY) {
      if (line.operator !== 'TJ') continue
      const reverse = line.pathReverse ?? line.path
      for (const s of line.path) served.F.add(`${line.lineCode}@TJ-${s.station}`)
      for (const s of reverse) served.R.add(`${line.lineCode}@TJ-${s.station}`)
    }
    const wrong = keys
      .filter(k => DIRECTIONAL_HEADWAYS_S[opposite(k)] === undefined)
      .filter((k) => {
        const stop = k.slice(0, k.lastIndexOf('@'))
        // A lone entry is only valid when the OTHER direction is genuinely unserved.
        return k.endsWith('@F') ? served.R.has(stop) : served.F.has(stop)
      })
    expect(wrong).toEqual([])
  })

  /*
   * Where both directions ARE served, the table exists to say they differ. A pair
   * that agrees belongs in STOP_HEADWAYS_S alone, or a halte page would show two
   * identical rows for no reason.
   */
  it('only carries two-way pairs whose directions actually differ', () => {
    const identical = keys
      .filter(k => k.endsWith('@F') && DIRECTIONAL_HEADWAYS_S[opposite(k)] !== undefined)
      .filter(k => DIRECTIONAL_HEADWAYS_S[k] === DIRECTIONAL_HEADWAYS_S[opposite(k)])
    expect(identical).toEqual([])
  })

  /*
   * Koridor 1 is the trunk BRT and runs a deliberately symmetric timetable —
   * TJ pairs every service with an opposing twin at the same headway (R07/R08 at
   * 360s, R11/R12 at 1200s, and so on), so no two-way stop splits. Its one-way
   * stops still get labelled, which is the whole point of this addition.
   */
  it('labels Koridor 1 one-way stops without splitting its symmetric ones', () => {
    const k1 = keys.filter(k => k.startsWith('1@'))
    expect(k1.length).toBeGreaterThan(0)
    const twoWay = k1.filter(k => DIRECTIONAL_HEADWAYS_S[opposite(k)] !== undefined)
    expect(twoWay).toEqual([])
  })

  /*
   * The direction gate. A loop trip touches its stops in both directions of the
   * circuit, but the corridor may only SERVE a halte one way — 28% of pairs are
   * single-direction. Emitting the unserved half would advertise a frequency for
   * a direction no service calls in.
   */
  it('only carries directions the topology actually serves', () => {
    const served = new Set<string>()
    for (const line of TOPOLOGY) {
      if (line.operator !== 'TJ') continue
      const reverse = line.pathReverse ?? line.path
      for (const s of line.path) served.add(`${line.lineCode}@TJ-${s.station}@F`)
      for (const s of reverse) served.add(`${line.lineCode}@TJ-${s.station}@R`)
    }
    expect(keys.filter(k => !served.has(k))).toEqual([])
  })

  /*
   * Every split pair must also exist as a combined value, since that is what the
   * router reads and what a client ignoring `boundFor` falls back to.
   */
  it('never splits a pair that has no combined value', () => {
    const missing = keys
      .map(k => k.slice(0, k.lastIndexOf('@')))
      .filter(k => STOP_HEADWAYS_S[k] === undefined)
    expect([...new Set(missing)]).toEqual([])
  })

  /*
   * A terminus is not two directions. At Tanjung Priok, corridor 12's "arah
   * Tanjung Priok" is where buses arrive, not a service anyone boards, and the
   * label would name the halte the rider is already standing at. The stop keeps
   * its combined value instead.
   */
  it('never splits at a line\'s own terminus', () => {
    expect(DIRECTIONAL_HEADWAYS_S['12@TJ-H00240P@F']).toBeUndefined()
    expect(STOP_HEADWAYS_S['12@TJ-H00240P']).toBeDefined()

    const selfLabelled = keys.filter((k) => {
      const lineStop = k.slice(0, k.lastIndexOf('@'))
      const dir = k.slice(-1) as 'F' | 'R'
      const terminus = LINE_TERMINI[lineStop.split('@')[0]!]
      return terminus !== undefined && terminus[dir] === lineStop.split('@')[1]
    })
    expect(selfLabelled).toEqual([])
  })

  /*
   * The pathReverse trap, as a regression.
   *
   * `pathReverse` is NOT the mirror of `path` on TJ, so a classifier scoring only
   * against the forward index cannot see reverse-only stops and misclassifies most
   * trips — the first implementation got 214 wrong that way. 10H is the corridor
   * that exposed it, and a working classifier finds a real split there.
   */
  it('classifies 10H correctly despite pathReverse differing from path', () => {
    const line = TOPOLOGY.find(t => t.operator === 'TJ' && t.lineCode === '10H')!
    const forward = line.path.map(s => s.station)
    const reverse = (line.pathReverse ?? line.path).map(s => s.station)
    // The precondition that makes this test meaningful.
    expect(reverse).not.toEqual([...forward].reverse())

    expect(DIRECTIONAL_HEADWAYS_S['10H@TJ-H00067P@F']).toBe(286)
    expect(DIRECTIONAL_HEADWAYS_S['10H@TJ-H00067P@R']).toBe(1008)
  })
})

describe('LINE_TERMINI', () => {
  it('resolves both directions for every TJ corridor', () => {
    const corridors = TOPOLOGY.filter(t => t.operator === 'TJ').map(t => t.lineCode)
    for (const code of corridors) {
      const t = LINE_TERMINI[code]
      expect(t, code).toBeDefined()
      expect(t!.F, code).toMatch(/^TJ-/)
      expect(t!.R, code).toMatch(/^TJ-/)
    }
  })

  /*
   * A corridor whose two "termini" are the same station cannot be labelled — both
   * rows would read "arah X". None do today, and a feed that introduced one would
   * need the label handled rather than silently duplicated.
   */
  it('never names the same station for both directions', () => {
    const same = Object.entries(LINE_TERMINI).filter(([, t]) => t.F === t.R)
    expect(same).toEqual([])
  })

  /*
   * Every line that splits somewhere must be labellable, or the UI would render a
   * two-row split with nothing to tell the rows apart.
   */
  it('covers every line that has a directional split', () => {
    const splitLines = new Set(keys.map(k => k.split('@')[0]!))
    expect([...splitLines].filter(l => LINE_TERMINI[l] === undefined)).toEqual([])
  })
})
