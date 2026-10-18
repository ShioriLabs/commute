import { StationExitRepository, ownedExit, type ExitRef, type PinnedTransfer } from 'db/repositories/station-exits'

export interface TransferExits {
  fromExit?: ExitRef
  toExit?: ExitRef
}

/** What a walk between two stations leaves by and enters by, where pinned. */
export type TransferExitResolver = (fromStationId: string, toStationId: string) => TransferExits

const NONE: TransferExits = {}

/** Names no doors; what a journey falls back to when the pins could not be loaded. */
export const NO_EXITS: TransferExitResolver = () => NONE

/*
 * Exact direction first, then the reverse row with its two exits swapped, so a
 * walk pinned once serves both ways. An exit is only offered for the station it
 * belongs to.
 *
 * The fallback is per ROW, not per door: a row pinned for this direction wins
 * even if it names only one door, and the reverse row's other door is not
 * borrowed. Doors can differ by direction (the way out is not always the way
 * in), so mixing two rows would invent a pairing nobody surveyed.
 */
export function transferExitResolver(rows: readonly PinnedTransfer[]): TransferExitResolver {
  const pinned = new Map<string, TransferExits>()
  for (const row of rows) {
    if (!row.toStationId) continue
    const fromExit = row.fromExit && ownedExit(row.fromExit.id, row.fromStationId) ? row.fromExit : undefined
    const toExit = row.toExit && ownedExit(row.toExit.id, row.toStationId) ? row.toExit : undefined
    if (!fromExit && !toExit) continue
    pinned.set(`${row.fromStationId}>${row.toStationId}`, { ...(fromExit && { fromExit }), ...(toExit && { toExit }) })
  }

  return (fromStationId, toStationId) => {
    const exact = pinned.get(`${fromStationId}>${toStationId}`)
    if (exact) return exact
    const reverse = pinned.get(`${toStationId}>${fromStationId}`)
    if (!reverse) return NONE
    return { ...(reverse.toExit && { fromExit: reverse.toExit }), ...(reverse.fromExit && { toExit: reverse.fromExit }) }
  }
}

/*
 * Per isolate, like the graph and the place index: pins change only with a
 * seed, and a seed ships with an API_VERSION bump. Held as a promise so
 * concurrent first requests share one load.
 *
 * ORDER MATTERS when pins change: apply the seed to remote D1 BEFORE the deploy
 * that bumps API_VERSION. An isolate that loads first would hold an empty
 * resolver for its lifetime and write exit-less bodies under the new version.
 */
let cached: Promise<TransferExitResolver> | null = null
export function getTransferExitResolver(d1: D1Database): Promise<TransferExitResolver> {
  cached ??= new StationExitRepository(d1).getPinnedTransfers()
    .then(transferExitResolver)
    .catch((error: unknown) => {
      cached = null // a failed load must not be memoised
      throw error
    })
  return cached
}
