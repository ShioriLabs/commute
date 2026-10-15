import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'

/*
 * Reading ward's snapshot files (apps/ward, docs/adr/ward-collector.md).
 *
 * <dir> holds daily archives (snap-YYYYMMDD.ndjson.zst, from
 * `pnpm --filter @commute/ward pull`) and/or hourly files
 * (snap-YYYYMMDD-HH.ndjson.gz). When a day has an archive its hourly files are
 * ignored. Files are streamed line by line so memory stays flat however many
 * days are read.
 */

export type Tuple = [string, string, string, number, number, number, number]
export type Snap = { k: 's', t: number, v: Tuple[] }
export type Gap = { k: 'gap', from: number, to: number, why: string }
export type StartRecord = { k: 'start' }
export type SnapshotRecord = Snap | Gap | StartRecord
export type Dir = 'F' | 'R'
export type Obs = { t: number, route: string, next: string }

export interface DayFiles {
  /** WIB day, YYYYMMDD. */
  day: string
  files: string[]
}

/** One entry per day, oldest first; a day's archive replaces its hourly files. */
export function dayFiles(dir: string): DayFiles[] {
  const archives = new Map<string, string>()
  const hourly = new Map<string, string[]>()
  for (const name of fs.readdirSync(dir)) {
    const archive = /^snap-(\d{8})\.ndjson\.zst$/.exec(name)
    if (archive) archives.set(archive[1]!, name)
    const hour = /^snap-(\d{8})-\d{2}\.ndjson\.gz$/.exec(name)
    if (hour) hourly.set(hour[1]!, [...(hourly.get(hour[1]!) ?? []), name])
  }
  return [...new Set([...archives.keys(), ...hourly.keys()])].sort().map(day => ({
    day,
    files: (archives.has(day) ? [archives.get(day)!] : hourly.get(day)!.sort()).map(name => path.join(dir, name))
  }))
}

/** Files to read, oldest first, optionally only the last `days` days. */
export function inputFiles(dir: string, days?: number): string[] {
  const all = dayFiles(dir)
  return (days ? all.slice(-days) : all).flatMap(d => d.files)
}

export function lines(file: string) {
  const child = file.endsWith('.zst')
    ? spawn('zstd', ['-dc', '--long=27', file])
    : spawn('zcat', [file])
  return readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
}
