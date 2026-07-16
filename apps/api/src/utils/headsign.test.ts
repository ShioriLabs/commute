import { describe, expect, it } from 'vitest'
import { computeHeadsignCode } from 'utils/headsign'

// Real TOPOLOGY pins the tests to the actual network (see directions.test.ts).
describe('computeHeadsignCode', () => {
  it('resolves both directions on a linear line (MRT)', () => {
    expect(computeHeadsignCode('MRTJ', 'M', ['BLA', 'BLM', 'SSM'])).toEqual({ code: 'BHI', viaCode: null })
    expect(computeHeadsignCode('MRTJ', 'M', ['SSM', 'BLM', 'BLA'])).toEqual({ code: 'LBB', viaCode: null })
  })

  it('returns the alight station when the leg ends at the terminus', () => {
    expect(computeHeadsignCode('MRTJ', 'M', ['DKA', 'BHI'])).toEqual({ code: 'BHI', viaCode: null })
  })

  it('follows the mainline continuation through the Citayam junction', () => {
    expect(computeHeadsignCode('KCI', 'B', ['UI', 'POC', 'DPB', 'DP'])).toEqual({ code: 'BOO', viaCode: null })
  })

  it('walks onto the Nambo ramp when the leg already rides it', () => {
    expect(computeHeadsignCode('KCI', 'B', ['DP', 'CTA', 'PDRG'])).toEqual({ code: 'NMO', viaCode: null })
  })

  it('resolves northbound Bogor-line legs to Jakarta Kota', () => {
    expect(computeHeadsignCode('KCI', 'B', ['DP', 'DPB', 'POC'])).toEqual({ code: 'JAKK', viaCode: null })
  })

  it('resolves the Cikarang loop stick eastbound to Cikarang', () => {
    expect(computeHeadsignCode('KCI', 'C', ['KLD', 'BUA'])).toEqual({ code: 'CKR', viaCode: null })
  })

  it('returns null at the loop mouth (Jatinegara, both sides ahead)', () => {
    expect(computeHeadsignCode('KCI', 'C', ['CUK', 'KLDB', 'BUA', 'KLD', 'JNG'])).toBe(null)
  })

  it('stops loop walks at the mid-loop service termini (Angke/Kampung Bandan)', () => {
    // Westbound through Manggarai is bound for Angke — must not leak
    // "Cikarang" by circling the loop and exiting the mouth.
    expect(computeHeadsignCode('KCI', 'C', ['MRI', 'SUD'])).toEqual({ code: 'AK', viaCode: null })
    // Pasar Senen side terminates at Kampung Bandan.
    expect(computeHeadsignCode('KCI', 'C', ['GST', 'PSE'])).toEqual({ code: 'KPB', viaCode: null })
  })

  it('resolves loop legs heading toward the mouth out to the stick', () => {
    expect(computeHeadsignCode('KCI', 'C', ['SUD', 'MRI'])).toEqual({ code: 'CKR', viaCode: null })
  })

  it('adds the loop side as via when boarding outside the loop', () => {
    // From the stick both sides depart the same way at Jatinegara; the rider
    // must board the right train.
    expect(computeHeadsignCode('KCI', 'C', ['CUK', 'KLDB', 'BUA', 'KLD', 'JNG', 'POK', 'KMT', 'GST', 'PSE']))
      .toEqual({ code: 'KPB', viaCode: 'PSE' })
    expect(computeHeadsignCode('KCI', 'C', ['CUK', 'KLDB', 'BUA', 'KLD', 'JNG', 'MTR', 'MRI', 'SUD']))
      .toEqual({ code: 'AK', viaCode: 'MRI' })
  })

  it('returns null for lines without topology', () => {
    expect(computeHeadsignCode('KCI', 'ZZ', ['DP', 'DPB'])).toBe(null)
  })

  it('returns null for single-station input', () => {
    expect(computeHeadsignCode('MRTJ', 'M', ['BLA'])).toBe(null)
  })
})
