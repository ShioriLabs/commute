/*
 * API response types for the fare and station-detail beats, re-exported from
 * @commute/schemas.
 *
 * These were hand-copied subsets, on the reasoning that the page only renders a
 * few fields. That cost more than it saved: the copies drifted from the API
 * (`StationDetail` still had `region` and an `operator` object; the fare legs
 * still had `lineName`/`lineColor`), and because they were local declarations
 * TypeScript happily agreed with the stale shape. Re-exporting means a reshape
 * breaks the build here instead of rendering `undefined` on the page.
 *
 * The aliases keep this app's own vocabulary — `StationDetail` reads better than
 * `Station` next to `StationCard` — while the definitions stay shared.
 */

export type {
  Amenity as StationAmenity,
  FareLeg,
  FareResult,
  FareRideLeg,
  FareStation as FareStationRef,
  FareTransferLeg,
  Line as StationLine,
  OperatorWithLines as OperatorSummary,
  Station as StationDetail,
  Transfer as StationTransfer
} from '@commute/schemas'

import type { Line, OperatorWithLines } from '@commute/schemas'

/*
 * Line keys (`KCI:C`) are what responses carry; `/operators` is the dictionary
 * that resolves them to a name and colour. Built once and passed to whichever
 * panel renders a roundel.
 */
export type LineDictionary = Map<string, Line>

export function buildLineDictionary(operators: readonly OperatorWithLines[]): LineDictionary {
  const dictionary: LineDictionary = new Map()
  for (const operator of operators) {
    for (const line of operator.lines) {
      dictionary.set(`${operator.code}:${line.lineCode}`, line)
    }
  }
  return dictionary
}

/** `KCI:C` -> `C`, the bare code a roundel shows. */
export function lineCodeOf(key: string): string {
  return key.split(':')[1] ?? key
}
