/*
 * WIB (UTC+7, no DST) calendar math. Every file name and day boundary in ward
 * is WIB, regardless of the host's zone, so a VPS in another region still cuts
 * days at Jakarta midnight — when TJ's service day actually turns over.
 */

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYYMMDD` of the WIB calendar day containing `ms`. */
export function wibDay(ms: number): string {
  const d = new Date(ms + WIB_OFFSET_MS)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

/** WIB hour (0-23) containing `ms`. */
export function wibHour(ms: number): number {
  return new Date(ms + WIB_OFFSET_MS).getUTCHours()
}

/** Hourly snapshot file name for `ms`: snap-YYYYMMDD-HH.ndjson.gz. */
export function hourFileName(ms: number): string {
  return `snap-${wibDay(ms)}-${pad(wibHour(ms))}.ndjson.gz`
}

/** Daily archive file name: snap-YYYYMMDD.ndjson.zst. */
export function archiveFileName(day: string): string {
  return `snap-${day}.ndjson.zst`
}

/** R2 key for a day's archive: raw/YYYY/MM/snap-YYYYMMDD.ndjson.zst. */
export function archiveKey(day: string): string {
  return `raw/${day.slice(0, 4)}/${day.slice(4, 6)}/${archiveFileName(day)}`
}

const HOUR_FILE = /^snap-(\d{8})-(\d{2})\.ndjson\.gz$/
const ARCHIVE_FILE = /^snap-(\d{8})\.ndjson\.zst$/
const UPLOADED_MARKER = /^snap-(\d{8})\.ndjson\.zst\.uploaded$/

/** Marker written next to an archive once R2 has a verified copy. */
export function uploadedMarkerName(day: string): string {
  return `${archiveFileName(day)}.uploaded`
}

/** Groups hourly files by WIB day, each day's hours sorted. */
export function hourFilesByDay(fileNames: string[]): Map<string, string[]> {
  const byDay = new Map<string, string[]>()
  for (const name of fileNames) {
    const match = HOUR_FILE.exec(name)
    if (!match) continue
    const list = byDay.get(match[1]!) ?? []
    list.push(name)
    byDay.set(match[1]!, list)
  }
  for (const list of byDay.values()) list.sort()
  return byDay
}

/** Day of an archive file name, or undefined. */
export function archiveDay(fileName: string): string | undefined {
  return ARCHIVE_FILE.exec(fileName)?.[1]
}

/** Day of an uploaded marker, or undefined. */
export function uploadedDay(fileName: string): string | undefined {
  return UPLOADED_MARKER.exec(fileName)?.[1]
}

/*
 * Days a checkpoint run still has work for, oldest first (a VPS that missed
 * several nights catches up in order):
 *   - any day strictly before today (WIB) that still has hourly files —
 *     either not archived yet, or archived and uploaded but the delete didn't
 *     finish;
 *   - any archive without an uploaded marker — a dry run, or an upload that
 *     failed after compressing.
 * "Done" is the marker, never the mere existence of an archive.
 */
export function pendingDays(hourFileNames: string[], archiveDirNames: string[], nowMs: number): string[] {
  const today = wibDay(nowMs)
  const uploaded = new Set(archiveDirNames.map(uploadedDay).filter((d): d is string => d !== undefined))
  const days = new Set<string>()
  for (const day of hourFilesByDay(hourFileNames).keys()) if (day < today) days.add(day)
  for (const name of archiveDirNames) {
    const day = archiveDay(name)
    if (day && !uploaded.has(day)) days.add(day)
  }
  return [...days].sort()
}

/** Whole days between two YYYYMMDD strings (b - a). */
export function daysBetween(a: string, b: string): number {
  const toMs = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)))
  return Math.round((toMs(b) - toMs(a)) / 86_400_000)
}
