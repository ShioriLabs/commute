import { describe, expect, it } from 'vitest'
import { column } from './fit'
import { HOLD_HOURS, interpolateProfiles, MAX_GAP_HOURS, rejectConflicting } from './interpolate'

const cell = (lineDir: string, dayType: 'WD' | 'WE', hour: number) => `${lineDir}|${column(dayType, hour)}`

describe('interpolateProfiles', () => {
  const measured = new Map([
    [cell('1@F', 'WD', 6), 200],
    [cell('1@F', 'WD', 8), 300],
    [cell('1@F', 'WD', 10), 250]
  ])

  it('fills a hour between two measured hours linearly in headway', () => {
    const out = interpolateProfiles(measured)
    expect(out.get(cell('1@F', 'WD', 7))).toBe(250)
    expect(out.get(cell('1@F', 'WD', 9))).toBe(275)
  })

  it('never alters or re-emits a measured cell', () => {
    const out = interpolateProfiles(measured)
    for (const id of measured.keys()) expect(out.has(id)).toBe(false)
  })

  it('holds the nearest value for a short way past the first and last hour, then stops', () => {
    const out = interpolateProfiles(measured)
    expect(out.get(cell('1@F', 'WD', 6 - HOLD_HOURS))).toBe(200)
    expect(out.has(cell('1@F', 'WD', 6 - HOLD_HOURS - 1))).toBe(false)
    expect(out.get(cell('1@F', 'WD', 10 + HOLD_HOURS))).toBe(250)
    expect(out.has(cell('1@F', 'WD', 10 + HOLD_HOURS + 1))).toBe(false)
  })

  it('refuses to bridge a gap wider than MAX_GAP_HOURS', () => {
    const wide = new Map([
      [cell('2@F', 'WD', 5), 200],
      [cell('2@F', 'WD', 5 + MAX_GAP_HOURS + 1), 600]
    ])
    expect(interpolateProfiles(wide).has(cell('2@F', 'WD', 8))).toBe(false)
  })

  it('bridges a gap of exactly MAX_GAP_HOURS', () => {
    const edge = new Map([
      [cell('2@F', 'WD', 5), 200],
      [cell('2@F', 'WD', 5 + MAX_GAP_HOURS), 800]
    ])
    expect(interpolateProfiles(edge).get(cell('2@F', 'WD', 8))).toBeCloseTo(200 + (600 * 3) / MAX_GAP_HOURS, 6)
  })

  it('keeps line-directions and day types apart', () => {
    const mixed = new Map([
      [cell('1@F', 'WD', 6), 100],
      [cell('1@R', 'WD', 8), 900],
      [cell('1@F', 'WE', 8), 500]
    ])
    const out = interpolateProfiles(mixed)
    // 1@F weekday has only hour 6: held, not blended with 1@R or the weekend.
    expect(out.get(cell('1@F', 'WD', 7))).toBe(100)
    expect(out.get(cell('1@R', 'WD', 7))).toBe(900)
    expect(out.get(cell('1@F', 'WE', 7))).toBe(500)
  })
})

describe('rejectConflicting', () => {
  const hours = (lineDir: string, values: Record<number, number>) =>
    new Map(Object.entries(values).map(([h, v]) => [cell(lineDir, 'WD', Number(h)), v] as const))
  const merge = (...maps: Map<string, number>[]) => new Map(maps.flatMap(m => [...m]))
  const measuredAround = (...hs: number[]) => new Set(hs.map(h => column('WD', h)))

  it('keeps a column where the interpolation agrees with the model\'s own values', () => {
    const interpolated = merge(hours('1@F', { 9: 300 }), hours('2@F', { 9: 500 }))
    const reference = merge(hours('1@F', { 9: 320 }), hours('2@F', { 9: 480 }))
    const { accepted, rejectedColumns } = rejectConflicting(interpolated, reference, measuredAround(8, 10))
    expect(rejectedColumns).toEqual([])
    expect(accepted.size).toBe(2)
  })

  it('drops a column where the interpolation is far from the model in the median', () => {
    // A night ramp: interpolated 800 where the model's own values are ~2000.
    const interpolated = merge(hours('1@F', { 3: 800 }), hours('2@F', { 3: 700 }), hours('3@F', { 3: 900 }))
    const reference = merge(hours('1@F', { 3: 2100 }), hours('2@F', { 3: 1900 }), hours('3@F', { 3: 2300 }))
    const { accepted, rejectedColumns } = rejectConflicting(interpolated, reference, measuredAround(0, 5))
    expect(rejectedColumns).toEqual([column('WD', 3)])
    expect(accepted.size).toBe(0)
  })

  it('judges by the median, so one noisy cell does not condemn a column', () => {
    const interpolated = merge(hours('1@F', { 9: 300 }), hours('2@F', { 9: 300 }), hours('3@F', { 9: 300 }))
    const reference = merge(hours('1@F', { 9: 310 }), hours('2@F', { 9: 290 }), hours('3@F', { 9: 3000 }))
    const { rejectedColumns, accepted, vetoedCells } = rejectConflicting(interpolated, reference, measuredAround(8, 10))
    expect(rejectedColumns).toEqual([])
    // The outlier cell is 10x off, so it is vetoed on its own while its column survives.
    expect(vetoedCells).toBe(1)
    expect(accepted.size).toBe(2)
  })

  it('keeps cells with no model value to contradict them (a truly blind hour)', () => {
    const interpolated = hours('1@F', { 17: 400 })
    const { accepted, rejectedColumns, vetoedCells } = rejectConflicting(interpolated, new Map(), measuredAround(16, 19))
    expect(rejectedColumns).toEqual([])
    expect(vetoedCells).toBe(0)
    expect(accepted.get(cell('1@F', 'WD', 17))).toBe(400)
  })

  it('decides per span: a conflict in one span does not touch another', () => {
    const interpolated = merge(hours('1@F', { 3: 800, 9: 300 }))
    const reference = merge(hours('1@F', { 3: 2000, 9: 310 }))
    const { accepted, rejectedColumns } = rejectConflicting(interpolated, reference, measuredAround(0, 5, 8, 10))
    expect(rejectedColumns).toEqual([column('WD', 3)])
    expect([...accepted.keys()]).toEqual([cell('1@F', 'WD', 9)])
  })

  it('judges the hours between two measured hours together, so the weakest cannot ship alone', () => {
    // 01 is borderline (just inside the tolerance); 03 clearly conflicts. They sit in one
    // span between measured hours 00 and 05, so 01 must go with 03 rather than ship a step.
    const interpolated = merge(hours('1@F', { 1: 800, 3: 800 }), hours('2@F', { 1: 800, 3: 800 }))
    const reference = merge(hours('1@F', { 1: 1000, 3: 2400 }), hours('2@F', { 1: 1000, 3: 2400 }))
    const alone = rejectConflicting(interpolated, reference, measuredAround(0, 1, 5))
    // With 01 itself measured, 01 is not in the span and stays accepted...
    expect(alone.rejectedColumns).toEqual([column('WD', 3)])
    // ...but as part of the same unmeasured span, 01 is rejected with 03.
    const together = rejectConflicting(interpolated, reference, measuredAround(0, 5))
    expect(together.rejectedColumns).toEqual([column('WD', 1), column('WD', 3)])
    expect(together.accepted.size).toBe(0)
  })

  it('reports each column\'s median deviation so a borderline one is visible', () => {
    const interpolated = hours('1@F', { 9: 300 })
    const reference = hours('1@F', { 9: 330 })
    const { deviations } = rejectConflicting(interpolated, reference, measuredAround(8, 10))
    expect(deviations.get(column('WD', 9))).toBeCloseTo(Math.log(330 / 300), 6)
  })

  it('treats the stretch before the first or after the last measured hour as a span of its own', () => {
    const interpolated = merge(hours('1@F', { 2: 500, 22: 500 }))
    const reference = merge(hours('1@F', { 2: 2000, 22: 505 }))
    const { rejectedColumns } = rejectConflicting(interpolated, reference, measuredAround(4, 20))
    // Hour 2 conflicts and is in the leading span; hour 22 agrees and is in the trailing one.
    expect(rejectedColumns).toEqual([column('WD', 2)])
  })

  describe('sparse cells', () => {
    // 7F has no scheduled service 09:30-14:00; the fit sees that column as healthy and
    // gives 7F no profile there, and the neighbours would fill it with ~19 minutes.
    const interpolated = hours('7F@F', { 12: 1100 })
    const noReference = new Map<string, number>()

    it('drops a cell in a column that had data but where the line-direction has no model value', () => {
      const result = rejectConflicting(interpolated, noReference, measuredAround(11, 14), new Set([column('WD', 12)]))
      expect(result.sparseVetoed).toBe(1)
      expect(result.accepted.size).toBe(0)
    })

    it('keeps the same cell in a column with no data (a truly blind hour)', () => {
      const result = rejectConflicting(interpolated, noReference, measuredAround(11, 14), new Set())
      expect(result.sparseVetoed).toBe(0)
      expect(result.accepted.size).toBe(1)
    })

    it('drops a cell the backtest held back, even where the model agrees with the interpolation', () => {
      const reference = hours('7F@F', { 12: 1100 })
      const held = new Set([`7F@F|${column('WD', 12)}`])
      const result = rejectConflicting(interpolated, reference, measuredAround(11, 14), new Set([column('WD', 12)]), held)
      expect(result.heldBackDropped).toBe(1)
      expect(result.accepted.size).toBe(0)
    })

    it('does not count a cell that has a model value of its own as sparse', () => {
      const reference = hours('7F@F', { 12: 1000 })
      const result = rejectConflicting(interpolated, reference, measuredAround(11, 14), new Set([column('WD', 12)]))
      expect(result.sparseVetoed).toBe(0)
      expect(result.accepted.size).toBe(1)
    })
  })
})
