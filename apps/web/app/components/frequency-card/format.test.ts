import { describe, expect, it } from 'vitest'
import { formatHeadway } from './index'

/*
 * The copy rules around a headway are the part worth pinning.
 *
 * A headway is a frequency, never an arrival: `journey-labels.ts` spells out
 * that it "must read as *the vehicle comes often* and never as *you will arrive
 * sooner*", because the app has no arrival time to promise. The tilde is what
 * carries that — values are combined averages across a corridor's route
 * variants, clamped at a two-minute floor, so a bare "2 menit" would claim
 * precision the model does not have.
 */
describe('formatHeadway', () => {
  it('rounds to whole minutes and marks the value as approximate', () => {
    expect(formatHeadway(420)).toBe('Setiap ~7 menit')
    expect(formatHeadway(600)).toBe('Setiap ~10 menit')
  })

  it('renders the clamped floor in the same form, not a special one', () => {
    // 120s is the generator's floor and ~37% of TJ pairs sit on it. It reads as
    // "about two minutes" rather than a bound the data cannot support.
    expect(formatHeadway(120)).toBe('Setiap ~2 menit')
  })

  it('never rounds down to zero minutes', () => {
    expect(formatHeadway(20)).toBe('Setiap ~1 menit')
  })

  it('rounds to nearest, not down', () => {
    expect(formatHeadway(170)).toBe('Setiap ~3 menit') // 2.83 min
    expect(formatHeadway(146)).toBe('Setiap ~2 menit') // 2.43 min
  })

  // House style: no trailing period on the last sentence of UI prose.
  it('carries no trailing period', () => {
    expect(formatHeadway(300).endsWith('.')).toBe(false)
  })
})
