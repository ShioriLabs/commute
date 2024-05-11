import { RegionCode } from 'constant'

export default interface Station {
  name: string
  originalName?: string // In case the station name was renamed, put the original here
  code: string
  region: string
  regionCode: RegionCode
}
