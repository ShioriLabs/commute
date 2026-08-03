/*
 * Official MRT Jakarta OD fare matrix (rupiah), keyed by our station codes
 * (see MRTJ_STATIONS_BY_SLUG in @commute/constants). MRTJ fares are published
 * per station pair, not formula-derived. Each unordered pair is stored once
 * in south->north order; getMRTJFare falls back to the reverse direction.
 * Source: published MRTJ tariff table (Rp 3.000-14.000), cross-checked
 * 2026-07-06; unchanged since 2019.
 */
export const MRTJ_FARES: Record<string, Record<string, number>> = {
  LBB: { FTM: 4000, CPR: 5000, HJN: 6000, BLA: 7000, BLM: 8000, SSM: 9000, SNY: 10000, IST: 11000, BNH: 12000, STB: 13000, DKA: 14000, BHI: 14000 },
  FTM: { CPR: 4000, HJN: 5000, BLA: 6000, BLM: 7000, SSM: 7000, SNY: 9000, IST: 9000, BNH: 10000, STB: 11000, DKA: 12000, BHI: 13000 },
  CPR: { HJN: 3000, BLA: 4000, BLM: 5000, SSM: 6000, SNY: 7000, IST: 8000, BNH: 9000, STB: 9000, DKA: 10000, BHI: 11000 },
  HJN: { BLA: 3000, BLM: 4000, SSM: 5000, SNY: 6000, IST: 7000, BNH: 8000, STB: 8000, DKA: 9000, BHI: 10000 },
  BLA: { BLM: 3000, SSM: 4000, SNY: 5000, IST: 6000, BNH: 7000, STB: 7000, DKA: 8000, BHI: 9000 },
  BLM: { SSM: 3000, SNY: 4000, IST: 5000, BNH: 6000, STB: 6000, DKA: 7000, BHI: 8000 },
  SSM: { SNY: 3000, IST: 4000, BNH: 5000, STB: 6000, DKA: 7000, BHI: 7000 },
  SNY: { IST: 3000, BNH: 4000, STB: 4000, DKA: 5000, BHI: 6000 },
  IST: { BNH: 3000, STB: 3000, DKA: 4000, BHI: 5000 },
  BNH: { STB: 3000, DKA: 3000, BHI: 4000 },
  STB: { DKA: 3000, BHI: 4000 },
  DKA: { BHI: 3000 }
}

export function getMRTJFare(fromCode: string, toCode: string): number | null {
  return MRTJ_FARES[fromCode]?.[toCode] ?? MRTJ_FARES[toCode]?.[fromCode] ?? null
}
