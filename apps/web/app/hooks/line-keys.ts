/*
 * Parsing operator-qualified line keys (`KCI:C`).
 *
 * Split out of use-lines.ts so it is testable: that module imports SWR and
 * utils/fetcher, and the vitest config resolves neither, so anything importing
 * it cannot be covered. Same reasoning as criteria/labels.ts.
 *
 * Both helpers tolerate a missing key rather than throwing. A line key can
 * genuinely be absent — SWR persists fare responses to IndexedDB
 * (app/lib/idb-cache-provider.ts), so a body cached under an older response
 * shape outlives the deploy that changed it, and a leg from one can reach the
 * renderer with no `line`. Stale service-worker caches do the same thing from
 * the other end, serving pre-direction-group payloads (see
 * LegacyTimetableEntrySchema) to code that expects the current shape.
 * Throwing there takes down the whole result view over
 * a single unlabelled roundel, which is far worse than rendering a blank badge.
 * Same instinct as the `?? '#888888'` colour fallbacks at the call sites.
 */

/** `KCI:C` -> `KCI`. Cheap enough to do inline; no dictionary needed. */
export function operatorOfLineKey(key: string | undefined | null): string | undefined {
  const [operator] = (key ?? '').split(':')
  return operator || undefined
}

/** `KCI:C` -> `C`, the bare code a roundel displays. */
export function codeOfLineKey(key: string | undefined | null): string {
  if (!key) return ''
  const [, code] = key.split(':')
  return code ?? key
}
