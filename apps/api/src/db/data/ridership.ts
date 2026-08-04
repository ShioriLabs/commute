/*
 * Published per-station ridership, the measured half of `stations.score`.
 *
 * We collect no usage telemetry — no analytics SDK, no ingestion endpoint, and
 * recents/favourites never leave the browser — so every number here comes from
 * an operator press release, cited per entry. Operators only ever publish
 * top-N lists, so this covers 15 of ~150 rail stations; everything else is
 * estimated from service and structure by db/scripts/generateStationScoresSQL.ts.
 *
 * TWO METRICS, and the second is the one that matters. `gatePerDay` counts taps
 * at the gate. `transitPerDay` counts riders changing trains, who never touch
 * one. Manggarai does not appear in KAI Commuter's busiest-by-gate top five yet
 * is the most crowded station on the network: 57.67 million transit passengers
 * in 2024, 166,587 on an average weekday, roughly five times its own gate
 * traffic. Gate data alone would demote our largest interchange, so a station's
 * demand is the sum of both.
 *
 * PICK ONE SERIES PER OPERATOR. KAI Commuter publishes Bogor twice — 8,888,669
 * for Sem I 2025 and 33,081,659 for Jan-Nov 2025 — which is not growth but two
 * different metrics: boardings versus gate in-out. They differ by ~2x and mixing
 * them would silently double half the network. Every KCI, LRTJBDB and Manggarai
 * figure below is gate IN-OUT. MRT Jakarta does not state which it publishes;
 * its entries are marked and may be understated by up to 2x, which on the log
 * scale is worth about one 19-point step.
 *
 * Cross-checked against KCI's 2024 annual report, which names Bogor at 1,566,584
 * departures per month over Jan-May 2025. That is 52,220/day, within 6% of the
 * Sem I boardings series (49,109/day) and half the in-out series used here —
 * three independent publications agreeing once the units are lined up.
 *
 * The same report is why this table uses in-out rather than departures: it lists
 * Sudirman among the busiest DESTINATIONS (1,006,102/month) but not among the
 * busiest departures. CBD stations absorb in the morning and shed in the
 * evening, so a departures-only metric understates exactly the office-district
 * stations riders search for most.
 *
 * Every figure is normalised to passengers per day AT AUTHORING TIME, because
 * the sources mix periods freely and must never be compared raw. Divisors:
 * Jan-Nov 2025 / 334, Nov 2025 / 30, 2024 / 365. `published` keeps the original
 * so a re-check needs no arithmetic.
 *
 * Refresh when operators publish again — half-yearly for KCI, monthly for MRTJ.
 * Stale anchors still beat none: they move slowly, and this feeds a ranking.
 */
export interface RidershipAnchor {
  stationId: string
  /** Gate taps per day, in + out. */
  gatePerDay?: number
  /** Riders changing trains per day. Absent for non-interchanges. */
  transitPerDay?: number
  /** Period the published figure covers. */
  period: string
  /** The figure as printed, before normalisation. */
  published: string
  source: string
}

const KCI_SOURCE = 'https://kumparan.com/kumparanbisnis/rata-rata-pengguna-krl-jabodetabek-tembus-951-ribu-orang-per-hari-26O4H93l5Bz'
const MRTJ_SOURCE = 'https://koran-jakarta.com/2025-12-16/berikut-daftar-stasiun-mrt-jakarta-yang-paling-sibuk'
const LRTJBDB_SOURCE = 'https://data.goodstats.id/statistic/pengguna-lrt-jabodebek-tembus-21-juta-stasiun-dukuh-atas-tersibuk-zVhhb'

export const RIDERSHIP_ANCHORS: RidershipAnchor[] = [
  // --- KCI ------------------------------------------------------------------
  // Busiest-by-gate top five, Jan-Nov 2025. Boardings-heavy termini dominate;
  // the interchanges that dominate by transfer volume are conspicuously absent.
  {
    stationId: 'KCI-BOO',
    gatePerDay: 99_047, // 33,081,659 / 334
    period: '2025-01/11',
    published: '33.081.659 transaksi gate in-out (Jan-Nov 2025)',
    source: KCI_SOURCE
  },
  {
    stationId: 'KCI-THB',
    gatePerDay: 89_126, // 29,768,022 / 334
    transitPerDay: 155_000, // 2nd-highest daily transfer volume, 2023
    period: '2025-01/11',
    published: '29.768.022 transaksi gate in-out (Jan-Nov 2025); 155.000 transit/hari (2023)',
    source: KCI_SOURCE
  },
  {
    stationId: 'KCI-SUD',
    gatePerDay: 67_543, // 22,559,386 / 334
    period: '2025-01/11',
    published: '22.559.386 transaksi gate in-out (Jan-Nov 2025)',
    source: KCI_SOURCE
  },
  {
    stationId: 'KCI-CTA',
    gatePerDay: 61_927, // 20,683,468 / 334
    period: '2025-01/11',
    published: '20.683.468 transaksi gate in-out (Jan-Nov 2025)',
    source: KCI_SOURCE
  },
  {
    stationId: 'KCI-BKS',
    gatePerDay: 60_407, // 20,176,011 / 334
    period: '2025-01/11',
    published: '20.176.011 transaksi gate in-out (Jan-Nov 2025)',
    source: KCI_SOURCE
  },
  {
    // The station the gate rankings miss, and the reason this table carries two
    // metrics at all. Transit is ~5x its own gate traffic and the largest single
    // figure anywhere here.
    stationId: 'KCI-MRI',
    gatePerDay: 29_699, // (5.55M in + 5.29M out) / 365
    transitPerDay: 158_000, // 57.67M / 365; 166,587 weekday, 149,930 weekend
    period: '2024',
    published: '5,55 juta gate in + 5,29 juta gate out; 57,67 juta transit (2024)',
    source: 'https://www.antaranews.com/berita/4810129/kai-memperkuat-fungsi-mobilitas-stasiun-manggarai-di-usia-107-tahun'
  },

  // --- MRTJ -----------------------------------------------------------------
  // Top five of thirteen, November 2025. Metric unstated by the source — see
  // the header note; possibly boardings-only, so possibly understated ~2x.
  {
    stationId: 'MRTJ-DKA',
    gatePerDay: 24_096, // 722,881 / 30
    period: '2025-11',
    published: '722.881 penumpang (November 2025)',
    source: MRTJ_SOURCE
  },
  {
    stationId: 'MRTJ-BLM',
    gatePerDay: 16_123, // 483,694 / 30
    period: '2025-11',
    published: '483.694 penumpang (November 2025)',
    source: MRTJ_SOURCE
  },
  {
    stationId: 'MRTJ-LBB',
    gatePerDay: 14_385, // 431,536 / 30
    period: '2025-11',
    published: '431.536 penumpang (November 2025)',
    source: MRTJ_SOURCE
  },
  {
    stationId: 'MRTJ-BHI',
    gatePerDay: 14_327, // 429,805 / 30
    period: '2025-11',
    published: '429.805 penumpang (November 2025)',
    source: MRTJ_SOURCE
  },
  {
    stationId: 'MRTJ-IST',
    gatePerDay: 11_099, // 332,974 / 30
    period: '2025-11',
    published: '332.974 penumpang (November 2025)',
    source: MRTJ_SOURCE
  },

  // --- LRTJBDB --------------------------------------------------------------
  // Gate in-out, Jan-Nov 2025. These four are why the anchors exist: a
  // frequency-only estimate ranks Dukuh Atas LAST on this operator, because a
  // terminus sees departures in one direction only. It is in fact first.
  {
    stationId: 'LRTJBDB-DKA',
    gatePerDay: 22_601, // 7,548,845 / 334
    period: '2025-01/11',
    published: '7.548.845 transaksi gate in-out (Jan-Nov 2025)',
    source: LRTJBDB_SOURCE
  },
  {
    stationId: 'LRTJBDB-HAR',
    gatePerDay: 18_089, // 6,041,570 / 334
    period: '2025-01/11',
    published: '6.041.570 transaksi gate in-out (Jan-Nov 2025)',
    source: LRTJBDB_SOURCE
  },
  {
    stationId: 'LRTJBDB-KUA',
    gatePerDay: 14_156, // 4,727,984 / 334
    period: '2025-01/11',
    published: '4.727.984 transaksi gate in-out (Jan-Nov 2025)',
    source: LRTJBDB_SOURCE
  },
  {
    stationId: 'LRTJBDB-CKK',
    gatePerDay: 12_546, // 4,190,204 / 334
    period: '2025-01/11',
    published: '4.190.204 transaksi gate in-out (Jan-Nov 2025)',
    source: LRTJBDB_SOURCE
  }
]

/** Total measured demand per day: gate taps plus transfers. */
export function anchorDemand(anchor: RidershipAnchor): number {
  return (anchor.gatePerDay ?? 0) + (anchor.transitPerDay ?? 0)
}

export const RIDERSHIP_BY_STATION_ID: ReadonlyMap<string, RidershipAnchor>
  = new Map(RIDERSHIP_ANCHORS.map(anchor => [anchor.stationId, anchor]))
