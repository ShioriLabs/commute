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
  // Set when the walk stays inside a single paid zone (no fare gate on either
  // side, e.g. a busway underpass between two halte). D1 stores 0/1; consumers
  // coerce to a boolean on read.
  noTap: ColumnType<number, number | undefined, number | undefined>
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
