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
  'SUDIRMAN BARU': 'BNI City'
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

  // Return station name with capitalized each word name
  return stationName.split(/[ ]/g)
    .map((word) => {
      if (word === 'UNIV.') return 'Universitas'
      return `${word[0]}${word.toLowerCase().substring(1)}`
    }
    )
    .join(' ')
    .trim()
}

export function getLineInfoFromAPIName(lineName: string) {
  return WELL_KNOWN_LINE_KEY[lineName]
}

export function getLineInfoByLineCode(lineCode: string) {
  return LINES.find(line => line.lineCode === lineCode)
}
