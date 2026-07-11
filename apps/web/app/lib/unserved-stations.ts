// Stations that exist on the map but are not (yet) served by any operator we
// cover, so the API has no record for them. The station page and map sheet
// special-case these instead of showing a generic fetch error.
export interface UnservedStation {
  formattedName: string
  title: string
  message: string
}

export const UNSERVED_STATIONS: Record<string, UnservedStation> = {
  'KCI-GMR': {
    formattedName: 'Gambir',
    title: 'Belum Melayani Commuter Line',
    message: 'Stasiun Gambir saat ini hanya melayani kereta api antarkota dan belum melayani KRL Commuter Line. Stasiun Commuter Line terdekat adalah Gondangdia dan Juanda.'
  }
}

export function getUnservedStation(operator: string, code: string): UnservedStation | null {
  return UNSERVED_STATIONS[`${operator}-${code}`] ?? null
}
