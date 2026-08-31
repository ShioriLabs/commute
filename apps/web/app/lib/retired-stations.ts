// Stations we still hold a full record for, but that no longer see service.
//
// Distinct from UNSERVED_STATIONS (~/lib/unserved-stations), which is for stops
// the API has never had a record of: listing a station there suppresses its
// fetches and swaps the whole page for an empty state. A retired station still
// has a name, lines, coordinates and facilities worth showing, and riders reach
// its page by searching the old name, so the page stays and gets a banner on
// top saying where the trains went.
//
// These stations stay SEARCHABLE on purpose. People will keep looking Karet up
// by name for years; a search that finds nothing reads as "we don't have it"
// rather than "it moved", and finding this page is what tells them.
export interface RetiredStation {
  /** Banner copy. Kept short: the page below it still does the explaining. */
  message: string
  /** Where riders should go instead, when there is one unambiguous answer. */
  redirect?: {
    label: string
    to: string
  }
}

export const RETIRED_STATIONS: Record<string, RetiredStation> = {
  // September 2026: KAI Commuter moved all Karet operations to Sudirman Baru/
  // BNI City, which absorbs it as a concourse. Removed from TOPOLOGY, so it is
  // unroutable, but the row and the page stay.
  'KCI-KAT': {
    message: 'Mulai September 2026, seluruh operasional Stasiun Karet dipindahkan ke Stasiun BNI City. Commuter Line sudah tidak berhenti di sini',
    redirect: {
      label: 'Lihat BNI City',
      to: '/stations/KCI/SUDB'
    }
  }
}

export function getRetiredStation(operator: string, code: string): RetiredStation | null {
  // Route params are not case-normalised, so fold case rather than let a
  // lowercase URL silently drop the notice.
  return RETIRED_STATIONS[`${operator.toUpperCase()}-${code.toUpperCase()}`] ?? null
}
