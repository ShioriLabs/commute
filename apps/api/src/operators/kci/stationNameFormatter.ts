// List of stations that has no-space names, i.e Klender Baru is written as KLENDERBARU on the API
const WELL_KNOWN_STATION_NAMES: Record<string, string> = {
  KLDB: "Klender Baru",
  GST: "Gang Sentiong",
  DRN: "Duren Kalibata",
  LNA: "Lenteng Agung"
}

export function tryGetFormattedName(code: string, stationName: string) {
  const wellKnownName = WELL_KNOWN_STATION_NAMES[code]
  if (wellKnownName) return wellKnownName

  return `${stationName[0]}${stationName.toLowerCase().substring(1)}`
}
