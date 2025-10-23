import { TransferDataType } from '@commute/constants'
import type { ColumnType, Insertable, Selectable, Updateable } from 'kysely'

export interface TransferSchema {
  id: string
  dataType: ColumnType<TransferDataType, string, string>
  fromStationId: string
  toStationId: string | null // for internal data
  toStationData: ColumnType<ExternalTransferStationData | null, string | ExternalTransferStationData | null, string | ExternalTransferStationData | null> // for external data
  distance: number
  notes: string | null
  createdAt: ColumnType<Date, string | undefined, never>
  updatedAt: ColumnType<Date, string | undefined, string | undefined>
}

export type Transfer = Selectable<TransferSchema>
export type NewTransfer = Insertable<TransferSchema>
export type UpdatingTransfer = Updateable<TransferSchema>

export interface ExternalTransferStationData {
  name: string
  operatorName: string
}
