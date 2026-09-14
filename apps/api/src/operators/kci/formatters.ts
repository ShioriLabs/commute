import { Line } from 'models/line'
import { APT_CGK_LINE, BOGOR_LINE, CIKARANG_LINE, LINES, RANGKASBITUNG_LINE, TANGERANG_LINE, TANJUNG_PRIOK_LINE } from './lines'

// List of stations that has no-space names, i.e Klender Baru is written as KLENDERBARU on the API
const WELL_KNOWN_STATION_NAMES: Record<string, string> = {
  'KLDB': 'Klender Baru',
  'GST': 'Gang Sentiong',
  'DRN': 'Duren Kalibata',
  'LNA': 'Lenteng Agung',
  'PSM': 'Pasar Minggu',
  'PSMB': 'Pasar Minggu Baru',
  'BST': 'Bandara Soekarno-Hatta',
  'KPB': 'Kampung Bandan',
  'PRP': 'Parung Panjang',
  'SUDB': 'BNI City',
  // For schedules station, since they don't have codes
  'BANDARASOEKARNOHATTA': 'Bandara Soekarno-Hatta',
  'KAMPUNGBANDAN': 'Kampung Bandan',
  'PARUNGPANJANG': 'Parung Panjang',
  'SUDIRMAN BARU': 'BNI City',
  'JAKARTAKOTA': 'Jakarta Kota',
  'TANAHABANG': 'Tanah Abang',
  'TANJUNGPRIUK': 'Tanjung Priok',
  'KAMPUNGBANDAN VIA MRI': 'Kampung Bandan',
  'KAMPUNGBANDAN VIA PSE': 'Kampung Bandan',
  'ANGKE VIA MRI': 'Angke',
  'CIKARANG VIA MRI': 'Cikarang'
}

/*
 * Station codes KCI renamed upstream, as `our code -> the feed's code`.
 *
 * The feed stopped serving TTI and GGL in September 2026 and now answers to THI
 * and GRG for the same two stations. Our ids stay put: `KCI-TTI` and `KCI-GGL`
 * are referenced by edges, transfers, topology, headways, station numbering and
 * the data-platform network dump, so renaming them costs eight source files and
 * a data migration to gain nothing a two-line lookup does not.
 *
 * Only the FETCH code changes. Everything written to the database keeps our
 * code, which is why `syncTimetable` maps on the way out and never on the way
 * back in.
 *
 * Why this must exist at all: `syncTimetable` is reached through a route that
 * first checks the station exists locally, so neither name works without it —
 * our code is no longer served upstream, and the feed's code is not a station we
 * hold. Both stations silently stopped refreshing, which is how line Tangerang
 * ended up with a board old enough to still split each train across two
 * tripNumbers and fail trip generation entirely.
 *
 * If KCI renames more stations, add them here. A rename is invisible in the
 * data: `syncStations` writes `sta_id` verbatim, so a renamed station arrives as
 * a NEW row while the old one keeps its schedules and quietly goes stale.
 */
const FEED_STATION_CODES: Record<string, string> = {
  TTI: 'THI', // Tanah Tinggi
  GGL: 'GRG' // Grogol
}

/**
 * The code to ask the KCI feed for, given one of our station codes.
 *
 * Identity for every station KCI has not renamed, so callers can map
 * unconditionally.
 */
export function toFeedStationCode(stationCode: string): string {
  return FEED_STATION_CODES[stationCode] ?? stationCode
}

// For mapping API line names to our line codes
const WELL_KNOWN_LINE_KEY: Record<string, Line> = {
  'COMMUTER LINE CIKARANG': CIKARANG_LINE,
  'COMMUTER LINE BOGOR': BOGOR_LINE,
  'COMMUTER LINE BST': APT_CGK_LINE,
  'COMMUTER LINE TANJUNGPRIUK': TANJUNG_PRIOK_LINE,
  'COMMUTER LINE TANGERANG': TANGERANG_LINE,
  'COMMUTER LINE RANGKASBITUNG': RANGKASBITUNG_LINE
}

export function tryGetFormattedName(code: string, stationName: string) {
  const wellKnownName = WELL_KNOWN_STATION_NAMES[code]
  if (wellKnownName) return wellKnownName

  // Return station name with capitalized each word name. Split on runs of
  // whitespace and drop empty tokens so leading/trailing/double spaces don't
  // leak literal "undefined" fragments.
  return stationName.split(/\s+/g)
    .filter(word => word.length > 0)
    .map(word => word === 'UNIV.' ? 'Universitas' : `${word[0]}${word.toLowerCase().substring(1)}`)
    .join(' ')
}

export function getLineInfoFromAPIName(lineName: string) {
  return WELL_KNOWN_LINE_KEY[lineName]
}

export function getLineInfoByLineCode(lineCode: string) {
  return LINES.find(line => line.lineCode === lineCode)
}
