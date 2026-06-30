import type { Operator } from '@commute/constants'

/*
 * Line topology — the single source of truth for the network graph.
 *
 * Built from the official KAI Commuter / MRT / LRT station codes (Wikipedia,
 * cross-checked against the live API station set, 2026-06-30). Drives two
 * generators:
 *   - generateStationCodesSQL.ts  -> backfills stationLines.stationNumber (`pos`)
 *   - generateEdgesSQL.ts         -> builds the `edges` adjacency + distance table
 *
 * `station` is the API station code (e.g. 'MRI'); the DB id is `${operator}-${station}`.
 * `pos` is the official per-line code (e.g. 'C13', 'b23', 'C11a').
 * `cumM` is the cumulative distance from the line origin, in METRES (to match
 * transfers.distance), where Wikipedia publishes it (KCI B/R/T/TP). Consecutive
 * stops with cumM on both ends get a real track distance (the difference);
 * everything else falls back to haversine from station lat/lng.
 *
 * Special structures:
 *   - Cikarang (C) is a lollipop: a stick (Cikarang->Jatinegara) plus a loop branch
 *     from Jatinegara that closes back to it (`closeTo`).
 *   - Bogor (B) forks at Citayam into the Bogor and Nambo branches.
 *   - Soekarno-Hatta (A) is skip-stop: only its service stops are listed (SHIA is
 *     not yet in the DB, so 5 here); consecutive pairs already span the skipped track.
 */

export interface Stop {
  station: string // API station code; DB id = `${operator}-${station}`
  pos: string // official per-line code -> stationLines.stationNumber
  cumM?: number // cumulative METRES from origin (real track distance) where known
}

export interface Branch {
  fromStation: string // junction station (must appear in the main path)
  path: Stop[]
  closeTo?: string // if set, the branch tail edges back here (loop closure)
}

export interface LineTopology {
  operator: Operator
  lineCode: string
  path: Stop[] // consecutive stops => edges
  branches?: Branch[]
}

/*
 * Schedule-derived stationLines rows that are NOT real stops and should be
 * pruned. The Soekarno-Hatta (A) line runs the Duri–Batu Ceper Tangerang track
 * but only stops at Batu Ceper; these four are passed through, not served.
 * (Jakarta Kota on C is deliberately NOT here — those late-night terminating
 * workings are real; see the Cikarang note below.)
 */
export const BOGUS_MEMBERSHIPS: { operator: Operator, station: string, lineCode: string }[] = [
  { operator: 'KCI', station: 'KDS', lineCode: 'A' }, // Kalideres
  { operator: 'KCI', station: 'PI', lineCode: 'A' }, // Poris
  { operator: 'KCI', station: 'PSG', lineCode: 'A' }, // Pesing
  { operator: 'KCI', station: 'TKO', lineCode: 'A' } // Taman Kota
]

export const TOPOLOGY: LineTopology[] = [
  // ── KCI Cikarang (loop / lollipop) ───────────────────────────────────────
  // Stick Cikarang->Jatinegara, then the central-Jakarta loop off Jatinegara.
  // Jakarta Kota is intentionally absent from the routable line. It's not a
  // regular Cikarang stop, but 1-2 late-night workings divert from Kampung
  // Bandan to terminate at Jakarta Kota (which is why the schedule-derived
  // KCI-JAKK-C stationLines row legitimately exists). Excluded so trip planning
  // never routes a passenger via a once-nightly train.
  {
    operator: 'KCI',
    lineCode: 'C',
    path: [
      { station: 'CKR', pos: 'C26' },
      { station: 'TLM', pos: 'C25' },
      { station: 'CIT', pos: 'C24' },
      { station: 'TB', pos: 'C23' },
      { station: 'BKST', pos: 'C22' },
      { station: 'BKS', pos: 'C21' },
      { station: 'KRI', pos: 'C20' },
      { station: 'CUK', pos: 'C19' },
      { station: 'KLDB', pos: 'C18' },
      { station: 'BUA', pos: 'C17' },
      { station: 'KLD', pos: 'C16' },
      { station: 'JNG', pos: 'C15' }
    ],
    branches: [
      {
        fromStation: 'JNG',
        closeTo: 'JNG',
        path: [
          { station: 'POK', pos: 'C01' },
          { station: 'KMT', pos: 'C02' },
          { station: 'GST', pos: 'C03' },
          { station: 'PSE', pos: 'C04' },
          { station: 'KMO', pos: 'C05' },
          { station: 'RJW', pos: 'C06' },
          { station: 'KPB', pos: 'C07' },
          { station: 'AK', pos: 'C08' },
          { station: 'DU', pos: 'C09' },
          { station: 'THB', pos: 'C10' },
          { station: 'KAT', pos: 'C11a' },
          { station: 'SUDB', pos: 'C11' },
          { station: 'SUD', pos: 'C12' },
          { station: 'MRI', pos: 'C13' },
          { station: 'MTR', pos: 'C14' }
        ]
      }
    ]
  },

  // ── KCI Bogor (forks at Citayam into Bogor + Nambo) ──────────────────────
  {
    operator: 'KCI',
    lineCode: 'B',
    path: [
      { station: 'JAKK', pos: 'B01', cumM: 0 },
      { station: 'JAY', pos: 'B02' },
      { station: 'MGB', pos: 'B03' },
      { station: 'SW', pos: 'B04' },
      { station: 'JUA', pos: 'B05' },
      { station: 'GDD', pos: 'B07' }, // B06 Gambir not yet served
      { station: 'CKI', pos: 'B08' },
      { station: 'MRI', pos: 'B09', cumM: 10700 },
      { station: 'TEB', pos: 'B10', cumM: 13300 },
      { station: 'CW', pos: 'B11', cumM: 14600 },
      { station: 'DRN', pos: 'B12', cumM: 16000 },
      { station: 'PSMB', pos: 'B13', cumM: 17500 },
      { station: 'PSM', pos: 'B14', cumM: 19200 },
      { station: 'TNT', pos: 'B15', cumM: 22200 },
      { station: 'LNA', pos: 'B16', cumM: 24800 },
      { station: 'UP', pos: 'B17', cumM: 25800 },
      { station: 'UI', pos: 'B18', cumM: 28000 },
      { station: 'POC', pos: 'B19', cumM: 29100 },
      { station: 'DPB', pos: 'B20', cumM: 31600 },
      { station: 'DP', pos: 'B21', cumM: 33300 },
      { station: 'CTA', pos: 'B22', cumM: 38300 }
    ],
    branches: [
      {
        fromStation: 'CTA',
        path: [
          { station: 'BJD', pos: 'B23', cumM: 43500 },
          { station: 'CLT', pos: 'B24', cumM: 47800 }, // B25 Sukaresmi planned
          { station: 'BOO', pos: 'B26', cumM: 54800 }
        ]
      },
      {
        fromStation: 'CTA',
        path: [
          { station: 'PDRG', pos: 'b23', cumM: 41500 },
          { station: 'CBN', pos: 'b24', cumM: 44700 }, // b25 Gunung Putri planned
          { station: 'NMO', pos: 'b26', cumM: 51000 }
        ]
      }
    ]
  },

  // ── KCI Rangkasbitung ────────────────────────────────────────────────────
  {
    operator: 'KCI',
    lineCode: 'R',
    path: [
      { station: 'THB', pos: 'R01', cumM: 0 },
      { station: 'PLM', pos: 'R02', cumM: 3191 },
      { station: 'KBY', pos: 'R03', cumM: 6928 },
      { station: 'PDJ', pos: 'R04', cumM: 13146 },
      { station: 'JMU', pos: 'R05', cumM: 15325 },
      { station: 'SDM', pos: 'R06', cumM: 17299 },
      { station: 'RU', pos: 'R07', cumM: 21865 },
      { station: 'SRP', pos: 'R08', cumM: 24278 },
      { station: 'CSK', pos: 'R09', cumM: 26062 },
      { station: 'CC', pos: 'R10', cumM: 28581 },
      { station: 'JTK', pos: 'R11' }, // opened Jan 2026, cumM n/a
      { station: 'PRP', pos: 'R12', cumM: 34549 },
      { station: 'CJT', pos: 'R14', cumM: 41574 }, // R13 Parayasa planned
      { station: 'DAR', pos: 'R15', cumM: 44249 },
      { station: 'TEJ', pos: 'R16', cumM: 48151 },
      { station: 'TGS', pos: 'R18', cumM: 51125 }, // R17 Tigaraksa Podomoro planned
      { station: 'CKY', pos: 'R19', cumM: 53776 },
      { station: 'MJ', pos: 'R20', cumM: 55629 },
      { station: 'CTR', pos: 'R21' }, // cumM n/a
      { station: 'RK', pos: 'R22', cumM: 72769 }
    ]
  },

  // ── KCI Tangerang ────────────────────────────────────────────────────────
  {
    operator: 'KCI',
    lineCode: 'T',
    path: [
      { station: 'DU', pos: 'T01', cumM: 0 },
      { station: 'GGL', pos: 'T02', cumM: 1700 },
      { station: 'PSG', pos: 'T03', cumM: 3736 },
      { station: 'TKO', pos: 'T04', cumM: 5250 },
      { station: 'BOI', pos: 'T05', cumM: 7684 },
      { station: 'RW', pos: 'T06', cumM: 8836 },
      { station: 'KDS', pos: 'T07', cumM: 11340 },
      { station: 'PI', pos: 'T08', cumM: 13888 },
      { station: 'BPR', pos: 'T09', cumM: 15688 },
      { station: 'TTI', pos: 'T10', cumM: 17688 },
      { station: 'TNG', pos: 'T11', cumM: 19297 }
    ]
  },

  // ── KCI Tanjung Priok ────────────────────────────────────────────────────
  {
    operator: 'KCI',
    lineCode: 'TP',
    path: [
      { station: 'JAKK', pos: 'TP01', cumM: 0 },
      { station: 'KPB', pos: 'TP02', cumM: 1364 },
      { station: 'AC', pos: 'TP03', cumM: 3549 },
      { station: 'JIS', pos: 'TP04' }, // cumM uncertain -> haversine
      { station: 'TPK', pos: 'TP05' }
    ]
  },

  // ── KCI Soekarno-Hatta (skip-stop; SHIA/A06 not yet in DB) ───────────────
  {
    operator: 'KCI',
    lineCode: 'A',
    path: [
      { station: 'MRI', pos: 'A01' },
      { station: 'SUDB', pos: 'A02' },
      { station: 'DU', pos: 'A03' },
      { station: 'RW', pos: 'A04' },
      { station: 'BPR', pos: 'A05' }
    ]
  },

  // ── MRT Jakarta North-South ──────────────────────────────────────────────
  {
    operator: 'MRTJ',
    lineCode: 'M',
    path: [
      { station: 'LBB', pos: 'M01' },
      { station: 'FTM', pos: 'M02' },
      { station: 'CPR', pos: 'M03' },
      { station: 'HJN', pos: 'M04' },
      { station: 'BLA', pos: 'M05' },
      { station: 'BLM', pos: 'M06' },
      { station: 'SSM', pos: 'M07' },
      { station: 'SNY', pos: 'M08' },
      { station: 'IST', pos: 'M09' },
      { station: 'BNH', pos: 'M10' },
      { station: 'STB', pos: 'M11' },
      { station: 'DKA', pos: 'M12' },
      { station: 'BHI', pos: 'M13' }
    ]
  },

  // ── LRT Jakarta (Velodrome–Pegangsaan Dua) ───────────────────────────────
  {
    operator: 'LRTJ',
    lineCode: 'S',
    path: [
      { station: 'PGD', pos: 'S01' },
      { station: 'BVU', pos: 'S02' },
      { station: 'BVS', pos: 'S03' },
      { station: 'PUM', pos: 'S04' },
      { station: 'EQS', pos: 'S05' },
      { station: 'VEL', pos: 'S06' }
    ]
  },

  // ── LRT Jabodebek Bekasi (shares DKA..CWG trunk with Cibubur) ────────────
  {
    operator: 'LRTJBDB',
    lineCode: 'BK',
    path: [
      { station: 'DKA', pos: 'BK01' },
      { station: 'SET', pos: 'BK02' },
      { station: 'RAS', pos: 'BK03' },
      { station: 'KUA', pos: 'BK04' },
      { station: 'PAN', pos: 'BK05' },
      { station: 'CKK', pos: 'BK06' },
      { station: 'CIL', pos: 'BK07' },
      { station: 'CWG', pos: 'BK08' },
      { station: 'HAL', pos: 'BK09' },
      { station: 'JBU', pos: 'BK10' },
      { station: 'CK1', pos: 'BK11' },
      { station: 'CK2', pos: 'BK12' },
      { station: 'BEK', pos: 'BK13' },
      { station: 'JTM', pos: 'BK14' }
    ]
  },

  // ── LRT Jabodebek Cibubur ────────────────────────────────────────────────
  {
    operator: 'LRTJBDB',
    lineCode: 'CB',
    path: [
      { station: 'DKA', pos: 'CB01' },
      { station: 'SET', pos: 'CB02' },
      { station: 'RAS', pos: 'CB03' },
      { station: 'KUA', pos: 'CB04' },
      { station: 'PAN', pos: 'CB05' },
      { station: 'CKK', pos: 'CB06' },
      { station: 'CIL', pos: 'CB07' },
      { station: 'CWG', pos: 'CB08' },
      { station: 'TMI', pos: 'CB09' },
      { station: 'KAM', pos: 'CB10' },
      { station: 'CRC', pos: 'CB11' },
      { station: 'HAR', pos: 'CB12' }
    ]
  }
]
