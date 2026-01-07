import type { Line } from './line'

interface TransferBase {
  id: string
  distance: number
  notes: string | null
}

interface InternalTransfer extends TransferBase {
  dataType: 'INTERNAL'
  toStation: TransferInternalStation
}

interface ExternalTransfer extends TransferBase {
  dataType: 'EXTERNAL'
  toStation: TransferExternalStation
}

export type Transfer = InternalTransfer | ExternalTransfer

export interface TransferInternalStation {
  stationId: string
  name: string
  operatorName: string
  lines: Line[]
}

export interface TransferExternalStation {
  name: string
  operatorName: string
}
