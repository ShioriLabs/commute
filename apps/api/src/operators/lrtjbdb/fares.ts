/*
 * Official LRT Jabodebek OD fare matrix (rupiah), keyed by our station codes.
 * Peak tariff (jam sibuk); off-peak is this table capped at
 * LRTJBDB_FARE_CAP_OFFPEAK, which reproduces the published off-peak table
 * exactly, so only one table is kept.
 *
 * LRT Jabodebek fares follow 5000 for the first km + 700 per started km, but
 * on the operator's own station distances, not the physical track: priced off
 * edge distances, 120 of 306 peak pairs came out wrong even with track traced
 * from OpenStreetMap (Halim and Kuningan sit at different points on their
 * scale). Hence a matrix, like MRTJ.
 *
 * Each unordered pair is stored once, in the order the official table lists
 * stations (Bekasi line, then Cibubur branch); getLRTJBDBFare falls back to the
 * reverse direction. The published table is symmetric.
 * Source: https://lrtjabodebek.kai.id/informasi-tarif, transcribed 2026-10-09.
 */
export const LRTJBDB_FARES: Record<string, Record<string, number>> = {
  DKA: { SET: 5000, RAS: 5700, KUA: 7100, PAN: 8500, CKK: 9900, CIL: 10600, CWG: 11300, HAL: 13400, JBU: 16200, CK1: 18300, CK2: 19000, BEK: 20000, JTM: 20000, HAR: 20000, KAM: 16200, CRC: 17600, TMI: 14800 },
  SET: { RAS: 5000, KUA: 6400, PAN: 7800, CKK: 9200, CIL: 9900, CWG: 10600, HAL: 12700, JBU: 15500, CK1: 17600, CK2: 18300, BEK: 20000, JTM: 20000, HAR: 20000, KAM: 15500, CRC: 16900, TMI: 14100 },
  RAS: { KUA: 5000, PAN: 6400, CKK: 7800, CIL: 8500, CWG: 9200, HAL: 12000, JBU: 14100, CK1: 16200, CK2: 16900, BEK: 19700, JTM: 20000, HAR: 19700, KAM: 14800, CRC: 16200, TMI: 13400 },
  KUA: { PAN: 5700, CKK: 7100, CIL: 7800, CWG: 8500, HAL: 11300, JBU: 13400, CK1: 15500, CK2: 16200, BEK: 19000, JTM: 20000, HAR: 19000, KAM: 14100, CRC: 15500, TMI: 12700 },
  PAN: { CKK: 5700, CIL: 6400, CWG: 7100, HAL: 9200, JBU: 12000, CK1: 14100, CK2: 14800, BEK: 17600, JTM: 19700, HAR: 17600, KAM: 12700, CRC: 13400, TMI: 11300 },
  CKK: { CIL: 5000, CWG: 5700, HAL: 7800, JBU: 10600, CK1: 12700, CK2: 13400, BEK: 16200, JTM: 18300, HAR: 16200, KAM: 11300, CRC: 12000, TMI: 9900 },
  CIL: { CWG: 5000, HAL: 7100, JBU: 9900, CK1: 12000, CK2: 12700, BEK: 15500, JTM: 17600, HAR: 15500, KAM: 10600, CRC: 11300, TMI: 9200 },
  CWG: { HAL: 7100, JBU: 9200, CK1: 11300, CK2: 12000, BEK: 14800, JTM: 16900, HAR: 14800, KAM: 9900, CRC: 11300, TMI: 8500 },
  HAL: { JBU: 7100, CK1: 9200, CK2: 9900, BEK: 12000, JTM: 14800, HAR: 17600, KAM: 12000, CRC: 13400, TMI: 10600 },
  JBU: { CK1: 6400, CK2: 7100, BEK: 9200, JTM: 12000, HAR: 20000, KAM: 14800, CRC: 16200, TMI: 13400 },
  CK1: { CK2: 5000, BEK: 7800, JTM: 9900, HAR: 20000, KAM: 16900, CRC: 18300, TMI: 15500 },
  CK2: { BEK: 7100, JTM: 9200, HAR: 20000, KAM: 17600, CRC: 19000, TMI: 16200 },
  BEK: { JTM: 6400, HAR: 20000, KAM: 20000, CRC: 20000, TMI: 19000 },
  JTM: { HAR: 20000, KAM: 20000, CRC: 20000, TMI: 20000 },
  HAR: { KAM: 9200, CRC: 8500, TMI: 10600 },
  KAM: { CRC: 5700, TMI: 5700 },
  CRC: { TMI: 7100 }
}

export function getLRTJBDBFare(fromCode: string, toCode: string): number | null {
  return LRTJBDB_FARES[fromCode]?.[toCode] ?? LRTJBDB_FARES[toCode]?.[fromCode] ?? null
}
