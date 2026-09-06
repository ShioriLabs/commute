import { describe, expect, it } from 'vitest'
import { dayLabel, formatHeadway } from './index'

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

/*
 * Which days a corridor runs, in the words a rider would use.
 *
 * The rule that matters: only the exceptions get a label. Most TransJakarta
 * corridors run all week, so labelling those "tiap hari" would bury the handful
 * that genuinely differ under noise.
 */
describe('dayLabel', () => {
  it('says nothing about a corridor that runs all week', () => {
    expect(dayLabel(['WD', 'SAT', 'SUN'])).toBeNull()
    // Absent means every day — the API omits the field for the common case.
    expect(dayLabel(undefined)).toBeNull()
  })

  it('names the weekday-only and weekend-only cases', () => {
    expect(dayLabel(['WD'])).toBe('hari kerja')
    expect(dayLabel(['SAT', 'SUN'])).toBe('akhir pekan')
  })

  /*
   * 7T and 8A really do run on Sundays and not Saturdays. Folding them into
   * "akhir pekan" would send a Saturday rider to a halte for a bus that is not
   * coming, which is the one thing this label exists to prevent.
   */
  it('keeps a single weekend day distinct from the whole weekend', () => {
    expect(dayLabel(['SUN'])).toBe('Minggu')
    expect(dayLabel(['SAT'])).toBe('Sabtu')
    expect(dayLabel(['SUN'])).not.toBe(dayLabel(['SAT', 'SUN']))
  })
})
