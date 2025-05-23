export interface Station {
  id: string
  name: string
  formattedName: string | null
  code: string
  region: string
  regionCode: 'CGK' | 'BDO' | 'YIA' | 'NUL'
  operator: {
    code: 'KCI' | 'MRTJ' | 'NUL'
    name: string
  }
  createdAt: Date
  updatedAt: Date
  timetableSynced: number
}
