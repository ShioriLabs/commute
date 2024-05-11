import { REGIONS } from 'constant'
import Station from 'models/station'

const STATION_REGION_LOOKUP: Record<number, typeof REGIONS[keyof typeof REGIONS]> = {
  0: REGIONS.CGK,
  2: REGIONS.BDO,
  6: REGIONS.YIA,
} as const

export async function syncStations() {
  const response = await fetch('https://api-partner.krl.co.id/krlweb/v1/krl-station')
  const json = await response.json()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return json.data.filter((station: any) => station.fg_enable === 1).map((station: any): Station => {
    const region = STATION_REGION_LOOKUP[station.group_wil as number] ?? REGIONS.NUL
    return {
      code: station.sta_id,
      name: station.sta_name,
      originalName: station.sta_name,
      region: region.name,
      regionCode: region.code,
    }
  }) as Station[]
}
