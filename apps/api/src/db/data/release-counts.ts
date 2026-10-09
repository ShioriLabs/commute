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
 * its stated WFH drop. The releases agree with each other to within ~5–10% per
 * station (Sudimara ~12%). Protest-day counts are deliberately absent: they run
 * 30–40% high.
 */
export interface ReleaseCount {
  stationId: string
  /** Riders counted from the start of service up to this hour. */
  count: number
  cutoffHour: 11 | 13
  /** What the release counted: riders getting on (origin) or off (destination). */
  kind: 'boarding' | 'alighting'
  published: string
}

export const RELEASE_COUNTS: ReleaseCount[] = [
  { stationId: 'KCI-SDM', count: 14_390, cutoffHour: 11, kind: 'boarding', published: '14.390 penumpang hingga 11.00' },
  { stationId: 'KCI-TNG', count: 12_000, cutoffHour: 13, kind: 'boarding', published: '~12 ribu hingga 13.00 (rekonstruksi)' },
  { stationId: 'KCI-BKST', count: 5_300, cutoffHour: 13, kind: 'boarding', published: '~5,3 ribu hingga 13.00 (rekonstruksi)' },
  { stationId: 'KCI-GDD', count: 19_504, cutoffHour: 11, kind: 'alighting', published: '19.504 penumpang hingga 11.00' },
  { stationId: 'KCI-JUA', count: 15_621, cutoffHour: 11, kind: 'alighting', published: '15.621 penumpang hingga 11.00' },
  // The DPR station. ~18.4k is the normal day; the 23,994 protest-day count is not used.
  { stationId: 'KCI-PLM', count: 18_400, cutoffHour: 11, kind: 'alighting', published: '13.060 hingga 11.00 saat WFH (−29%), ~18,4 ribu hari normal' },
  // KCI lists Tebet among its office-district arrival stations.
  { stationId: 'KCI-TEB', count: 19_400, cutoffHour: 13, kind: 'alighting', published: '~19,4 ribu hingga 13.00 (rekonstruksi)' }
]

export const RELEASE_COUNTS_BY_STATION_ID: ReadonlyMap<string, ReleaseCount>
  = new Map(RELEASE_COUNTS.map(r => [r.stationId, r]))
