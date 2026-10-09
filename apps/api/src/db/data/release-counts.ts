/*
 * Per-station counts from KAI Commuter press releases, for stations that have no
 * annual figure in ridership.ts.
 *
 * Each is ONE normal Friday's count up to a cut-off hour: boardings at an
 * origin, alightings at a destination. That is weaker than an annual anchor, so
 * these feed only the density model (db/scripts/density/volume.ts converts them
 * to a day) and never the station score, where they would also reorder search.
 *
 * Source: the KCI releases collected in docs/station-density.md, "Station roles:
 * directional split". The 11:00 counts are printed in the "WFH ASN berlaku"
 * release; the 13:00 ones are reconstructed from the 8 May 2026 release by undoing
 * its stated WFH drop. The 08:00 ones come from releases with a `source` of their own. The releases agree with each other to within ~5–10% per
 * station (Sudimara ~12%). Protest-day counts are deliberately absent: they run
 * 30–40% high.
 */
export interface ReleaseCount {
  stationId: string
  /** Riders counted from the start of service up to this hour. */
  count: number
  cutoffHour: 8 | 11 | 13
  /** What the release counted: riders getting on (origin) or off (destination). */
  kind: 'boarding' | 'alighting'
  published: string
  /** The release itself, where it isn't one of those collected in the spec. */
  source?: string
}

export const RELEASE_COUNTS: ReleaseCount[] = [
  { stationId: 'KCI-SDM', count: 14_390, cutoffHour: 11, kind: 'boarding', published: '14.390 penumpang hingga 11.00' },
  { stationId: 'KCI-TNG', count: 12_000, cutoffHour: 13, kind: 'boarding', published: '~12 ribu hingga 13.00 (rekonstruksi)' },
  { stationId: 'KCI-BKST', count: 5_300, cutoffHour: 13, kind: 'boarding', published: '~5,3 ribu hingga 13.00 (rekonstruksi)' },
  { stationId: 'KCI-GDD', count: 19_504, cutoffHour: 11, kind: 'alighting', published: '19.504 penumpang hingga 11.00' },
  { stationId: 'KCI-JUA', count: 15_621, cutoffHour: 11, kind: 'alighting', published: '15.621 penumpang hingga 11.00' },
  // The DPR station. ~18.4k is the normal day; the 23,994 protest-day count is not used.
  { stationId: 'KCI-PLM', count: 18_400, cutoffHour: 11, kind: 'alighting', published: '13.060 hingga 11.00 saat WFH (−29%), ~18,4 ribu hari normal' },
  {
    // Monday 21 Sep 2026, a normal schedule (1,065 trips). The same release puts
    // anchored Citayam and Bekasi at ~0.38 of their day by 08:00, which is how
    // volume.ts scales this one.
    stationId: 'KCI-BJD',
    count: 11_220,
    cutoffHour: 8,
    kind: 'boarding',
    published: 'Stasiun Bojonggede sebanyak 11.220 orang (naik, hingga pukul 08.00, Senin 21/9/2026)',
    source: 'https://www.kci.id/informasi-publik/berita/layanan-commuter-line-jabodetabek-kembali-normal-1-065-perjalanan-tambah-4-perjalanan-commuter-line-bogor-hari-ini'
  },
  // KCI lists Tebet among its office-district arrival stations.
  { stationId: 'KCI-TEB', count: 19_400, cutoffHour: 13, kind: 'alighting', published: '~19,4 ribu hingga 13.00 (rekonstruksi)' }
]

export const RELEASE_COUNTS_BY_STATION_ID: ReadonlyMap<string, ReleaseCount>
  = new Map(RELEASE_COUNTS.map(r => [r.stationId, r]))

/*
 * Riders changing trains at a station, from a KCI release, where ridership.ts
 * has no transitPerDay for it. Added on top of the station's gate boardings:
 * a transfer boards a train without touching a gate, so it isn't in KCI's
 * daily rider total either.
 */
export interface ReleaseTransit {
  stationId: string
  transitPerDay: number
  published: string
  source: string
}

export const RELEASE_TRANSIT: ReleaseTransit[] = [
  {
    // Tangerang line ↔ loop. Scaled from Manggarai, not counted directly: two
    // releases give Duri's transfers beside Manggarai's on the same day, and both
    // put Duri at a third or more of them, 0.42 on Sun 24 Mar 2024 (51,954 of
    // 124,092, full day) and 0.34 on Wed 1 Jan 2025 (23,275 of 67,723, by 13:30).
    // The lower ratio × Manggarai's weekday average (158,000, ridership.ts) is
    // 54,301. That overrules the 7 Oct 2026 escalator release's "13 ribu lebih"
    // (https://www.kci.id/informasi-publik/berita/kai-commuter-pastikan-perbaikan-eskalator-stasiun-duri-sesuai-dengan-aspek-keselamatan-dan-keamanan-pengguna),
    // which can't be a full day's transfers against these and is probably a
    // narrower count (one direction, or one interchange).
    stationId: 'KCI-DU',
    transitPerDay: Math.round(158_000 * 23_275 / 67_723),
    published: 'transit Duri 23.275 vs Manggarai 67.723 hingga pukul 13.30 (Rabu 1/1/2025); 51.954 vs 124.092 (Minggu 24/3/2024)',
    source: 'https://www.kci.id/informasi-publik/berita/kai-commuter-catat-rapor-positif-layani-1-2-juta-pengguna-commuter-line-jelang-tahun-baru-2025'
  },
  {
    // A floor: the larger of two holiday counts, so a weekday is at least this.
    // 16,327 by 13:30 on New Year's Day 2025; 13,977 for the whole of a Ramadan
    // Sunday, 24 Mar 2024 (https://www.kci.id/informasi-publik/berita/tren-volume-pengguna-commuter-line-jabodetabek-minggu-kedua-ramadan-naik-stasiun-stasiun-sekitar-kawasan-pusat-perbelanjaan-terpantau-ramai;
    // undated page, inferred from "Minggu (24/3)" and "Maret 2024"). Against
    // Manggarai the two give 0.24 and 0.11, too far apart to scale from.
    stationId: 'KCI-KPB',
    transitPerDay: 16_327,
    published: 'transit Kampung Bandan 16.327 hingga pukul 13.30 (Rabu 1/1/2025)',
    source: 'https://www.kci.id/informasi-publik/berita/kai-commuter-catat-rapor-positif-layani-1-2-juta-pengguna-commuter-line-jelang-tahun-baru-2025'
  }
]

export const RELEASE_TRANSIT_BY_STATION_ID: ReadonlyMap<string, ReleaseTransit>
  = new Map(RELEASE_TRANSIT.map(r => [r.stationId, r]))
