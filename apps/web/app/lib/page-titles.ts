/*
 * Tab titles for the station, line, hub and timetable pages.
 *
 * Shared by the app and functions/_middleware.ts, because Google runs the SPA:
 * the title it indexes is whatever the route's meta() and document.title leave
 * behind, not the crawler title the middleware rewrote into the shell. When the
 * two disagreed, every station ranked as "Rawa Buaya - Commute", without the
 * "Jadwal KRL" people actually type. One function per page keeps both sides on
 * the same words.
 *
 * Kept free of imports, so the Pages Function bundle stays dependency-free.
 */

/*
 * Per-operator search vocabulary. `mode` is the short term people search
 * ("KRL", not "Commuter Line"); `vehicle` is the vehicle noun and `stop` the
 * stop noun. Unknown operators fall back to generic rail words.
 */
export interface OperatorVocab {
  mode: string
  vehicle: string
  stop: string
}

const OPERATOR_VOCAB: Record<string, OperatorVocab> = {
  KCI: { mode: 'KRL', vehicle: 'kereta', stop: 'Stasiun' },
  MRTJ: { mode: 'MRT', vehicle: 'kereta', stop: 'Stasiun' },
  LRTJ: { mode: 'LRT', vehicle: 'kereta', stop: 'Stasiun' },
  LRTJBDB: { mode: 'LRT', vehicle: 'kereta', stop: 'Stasiun' },
  TJ: { mode: 'TransJakarta', vehicle: 'bus', stop: 'Halte' },
  APCGK: { mode: 'Kalayang', vehicle: 'kereta', stop: 'Stasiun' }
}
const GENERIC_VOCAB: OperatorVocab = { mode: 'kereta', vehicle: 'kereta', stop: 'Stasiun' }

export function vocabFor(operator: string): OperatorVocab {
  return OPERATOR_VOCAB[operator.toUpperCase()] ?? GENERIC_VOCAB
}

const SUFFIX = ' - Commute'

/**
 * "Jadwal KRL Stasiun Rawa Buaya - Commute". Before the station has loaded,
 * the route only knows the code: "Jadwal KRL RW - Commute".
 */
export function stationPageTitle(operator: string, name: string | null, code: string): string {
  const { mode, stop } = vocabFor(operator)
  return name
    ? `Jadwal ${mode} ${stop} ${name}${SUFFIX}`
    : `Jadwal ${mode} ${code.toUpperCase()}${SUFFIX}`
}

/** "Jadwal Lengkap KRL Stasiun Rawa Buaya - Commute" */
export function timetablePageTitle(operator: string, name: string | null, code: string): string {
  const { mode, stop } = vocabFor(operator)
  return name
    ? `Jadwal Lengkap ${mode} ${stop} ${name}${SUFFIX}`
    : `Jadwal Lengkap ${mode} ${code.toUpperCase()}${SUFFIX}`
}

/**
 * "Jadwal & Rute KRL Lin Tangerang - Commute". TransJakarta line names are
 * their termini ("Blok M - Kota"), so the route number leads:
 * "Jadwal & Rute TransJakarta 1 Blok M - Kota - Commute".
 */
export function linePageTitle(operator: string, lineCode: string, name: string | null): string {
  const { mode } = vocabFor(operator)
  const code = lineCode.toUpperCase()
  if (!name) return `Jadwal & Rute ${mode} ${code}${SUFFIX}`
  return operator.toUpperCase() === 'TJ'
    ? `Jadwal & Rute ${mode} ${code} ${name}${SUFFIX}`
    : `Jadwal & Rute ${mode} ${name}${SUFFIX}`
}

export type HubTitleKind = 'hub' | 'integrated' | 'directional'

const HUB_KIND_LABEL: Record<HubTitleKind, string> = {
  hub: 'Pumpunan Moda',
  integrated: 'Stasiun Terintegrasi',
  directional: 'Halte'
}

/** The hub page's heading, also its crawler <h1>: "Jadwal Kereta Dukuh Atas". */
export function hubHeading(name: string, kind: HubTitleKind): string {
  return kind === 'directional' ? `Jadwal Bus Halte ${name}` : `Jadwal Kereta ${name}`
}

/**
 * "Jadwal Kereta Dukuh Atas - Pumpunan Moda - Commute". A directional halte
 * drops the kind label, since "Jadwal Bus Halte X - Halte" says it twice.
 */
export function hubPageTitle(name: string, kind: HubTitleKind): string {
  const heading = hubHeading(name, kind)
  return kind === 'directional'
    ? `${heading}${SUFFIX}`
    : `${heading} - ${HUB_KIND_LABEL[kind] ?? HUB_KIND_LABEL.integrated}${SUFFIX}`
}
