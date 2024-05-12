// List of stations that has no-space names, i.e Klender Baru is written as KLENDERBARU on the API
const WELL_KNOWN_STATION_NAMES: Record<string, string> = {
  KLDB: "Klender Baru",
  GST: "Gang Sentiong",
  DRN: "Duren Kalibata",
  LNA: "Lenteng Agung",
  PSM: "Pasar Minggu",
  PSMB: "Pasar Minggu Baru"
}

export function tryGetFormattedName(code: string, stationName: string) {
  const wellKnownName = WELL_KNOWN_STATION_NAMES[code]
  if (wellKnownName) return wellKnownName

  // Return station name with capitalized each word name
  return stationName.split(/[ .]/g)
    .map((word) => {
      if (word === 'UNIV') return 'Universitas'
      return `${word[0]}${word.toLowerCase().substring(1)}`}
    )
    .join(" ")
    .trim()
}
