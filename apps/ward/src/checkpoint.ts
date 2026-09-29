#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { type CheckpointConfig, checkpointConfig } from './config.ts'
import {
  archiveFileName, archiveKey, daysBetween, hourFilesByDay, pendingDays, uploadedDay, uploadedMarkerName, wibDay
} from './days.ts'
import { type ArchiveStore, createR2Store, sha256File } from './r2.ts'

/*
 * Nightly checkpoint: every complete WIB day's hourly gz files become one
 * `snap-YYYYMMDD.ndjson.zst`, which is uploaded to R2 and verified there
 * before anything local is deleted.
 *
 * Why recompress: the collector gzips each line on its own (crash-safe
 * appends), so gzip never sees that consecutive snapshots are near-identical.
 * zstd with a long window does — measured on 2026-09-29 15:00 WIB: 14.9MB of
 * gz -> 1.48MB of zstd -19 --long=27, ~10x smaller.
 *
 * Every step is safe to re-run. An archive is only "done" once its
 * `.uploaded` marker exists, which is written after R2 returns the right size
 * and sha256. A failure at any point leaves the local files in place, and the
 * next run picks the day up again.
 */

const ZSTD_ARGS = ['-19', '--long=27', '-T1', '-q']
/** Where a day's hourly files go when one of them was unreadable, for manual recovery. */
const QUARANTINE_DIR = 'quarantine'

export interface CheckpointDeps {
  store?: ArchiveStore
  log: (message: string) => void
  now: () => number
  ping?: (url: string) => Promise<void>
}

export interface CheckpointOptions {
  dryRun: boolean
}

export interface CheckpointResult {
  archived: string[]
  uploaded: string[]
  pruned: string[]
  failed: { day: string, error: string }[]
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('error', reject)
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`))))
  })
}

/*
 * zcat the day's hourly files, in order, into zstd. Counts snapshot lines on
 * the way through for the archive metadata.
 *
 * zcat exiting non-zero means a truncated gzip member (the collector was
 * killed mid-append). Everything up to that point is still archived, but the
 * error is returned so the caller moves the hourly files to quarantine/
 * instead of deleting the only full copy.
 */
async function compressDay(dataDir: string, hourFiles: string[], outPath: string): Promise<{ snapshots: number, zcatError?: string }> {
  const partial = `${outPath}.partial`
  const zcat = spawn('zcat', hourFiles.map(f => path.join(dataDir, f)), { stdio: ['ignore', 'pipe', 'pipe'] })
  const zstd = spawn('zstd', [...ZSTD_ARGS, '-f', '-o', partial, '-'], { stdio: ['pipe', 'ignore', 'pipe'] })

  let zcatStderr = ''
  let zstdStderr = ''
  zcat.stderr.on('data', chunk => (zcatStderr += chunk))
  zstd.stderr.on('data', chunk => (zstdStderr += chunk))

  let snapshots = 0
  let tail = ''
  zcat.stdout.on('data', (chunk: Buffer) => {
    const text = tail + chunk.toString('utf8')
    const lines = text.split('\n')
    tail = lines.pop() ?? ''
    for (const line of lines) if (line.startsWith('{"k":"s"')) snapshots++
  })
  zcat.stdout.pipe(zstd.stdin)

  const exit = (child: ReturnType<typeof spawn>) => new Promise<number | null>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
  })
  const [zcatCode, zstdCode] = await Promise.all([exit(zcat), exit(zstd)])
  if (tail.startsWith('{"k":"s"')) snapshots++
  if (zstdCode !== 0) throw new Error(`zstd exited ${zstdCode}: ${zstdStderr.trim()}`)

  await run('zstd', ['-t', '-q', partial])
  fs.renameSync(partial, outPath)
  return { snapshots, zcatError: zcatCode === 0 ? undefined : `zcat exited ${zcatCode}: ${zcatStderr.trim()}` }
}

export async function runCheckpoint(
  config: CheckpointConfig,
  options: CheckpointOptions,
  deps: CheckpointDeps
): Promise<CheckpointResult> {
  const { log, now, store } = deps
  if (!options.dryRun && !store) throw new Error('an archive store is required unless --dry-run')

  const archiveDir = path.join(config.dataDir, 'archive')
  fs.mkdirSync(archiveDir, { recursive: true })
  const result: CheckpointResult = { archived: [], uploaded: [], pruned: [], failed: [] }

  const hourNames = fs.readdirSync(config.dataDir)
  const byDay = hourFilesByDay(hourNames)
  const days = pendingDays(hourNames, fs.readdirSync(archiveDir), now())
  if (days.length === 0) log('nothing to checkpoint')

  for (const day of days) {
    const hours = byDay.get(day) ?? []
    const archivePath = path.join(archiveDir, archiveFileName(day))
    const markerPath = path.join(archiveDir, uploadedMarkerName(day))
    try {
      // Already verified in R2 on an earlier run; only the delete is left.
      if (fs.existsSync(markerPath)) {
        for (const f of hours) fs.rmSync(path.join(config.dataDir, f))
        log(`${day}: already uploaded, removed ${hours.length} leftover hourly files`)
        continue
      }

      let snapshots: number | undefined
      // Hourly files to delete once R2 is verified.
      let toDelete = hours
      if (!fs.existsSync(archivePath)) {
        const compressed = await compressDay(config.dataDir, hours, archivePath)
        snapshots = compressed.snapshots
        const gzBytes = hours.reduce((sum, f) => sum + fs.statSync(path.join(config.dataDir, f)).size, 0)
        const zstBytes = fs.statSync(archivePath).size
        log(`${day}: ${hours.length} hourly files, ${snapshots} snapshots, ${(gzBytes / 1e6).toFixed(1)}MB gz -> ${(zstBytes / 1e6).toFixed(1)}MB zst`)
        if (compressed.zcatError && options.dryRun) {
          // Leave nothing behind that a real run would reuse without re-detecting the damage.
          fs.rmSync(archivePath)
          log(`${day}: WARNING ${compressed.zcatError}; dry run, archive discarded`)
          continue
        }
        if (compressed.zcatError) {
          // Moved now, not after upload, so a retry of a failed upload can't
          // mistake them for ordinary leftovers and delete the only full copy.
          const quarantine = path.join(config.dataDir, QUARANTINE_DIR)
          fs.mkdirSync(quarantine, { recursive: true })
          for (const f of hours) fs.renameSync(path.join(config.dataDir, f), path.join(quarantine, f))
          toDelete = []
          log(`${day}: WARNING ${compressed.zcatError}; archived what was readable, hourly files moved to ${QUARANTINE_DIR}/`)
        }
        result.archived.push(day)
      }

      if (options.dryRun) continue

      const sha256 = await sha256File(archivePath)
      const size = fs.statSync(archivePath).size
      const key = archiveKey(day)
      const existing = await store!.head(key)
      if (existing?.size !== size || existing.meta.sha256 !== sha256) {
        await store!.put(key, archivePath, { sha256, hours: hours.length, snapshots: snapshots ?? -1 })
      }
      const remote = await store!.head(key)
      if (remote?.size !== size || remote.meta.sha256 !== sha256) {
        throw new Error(`R2 verification failed for ${key}: local ${size}B ${sha256}, remote ${remote?.size}B ${remote?.meta.sha256}`)
      }
      fs.writeFileSync(markerPath, `${JSON.stringify({ key, sha256, size, at: new Date(now()).toISOString() })}\n`)
      result.uploaded.push(day)
      log(`${day}: uploaded and verified ${key}`)

      for (const f of toDelete) fs.rmSync(path.join(config.dataDir, f))
    } catch (err) {
      result.failed.push({ day, error: (err as Error).message })
      log(`${day}: FAILED ${(err as Error).message}; local files kept, will retry next run`)
    }
  }

  if (!options.dryRun) {
    // Local archives are a convenience copy once R2 has them; keep ~a month.
    const today = wibDay(now())
    for (const name of fs.readdirSync(archiveDir)) {
      const day = uploadedDay(name)
      if (!day || daysBetween(day, today) <= config.keepArchiveDays) continue
      fs.rmSync(path.join(archiveDir, archiveFileName(day)), { force: true })
      fs.rmSync(path.join(archiveDir, name))
      result.pruned.push(day)
      log(`${day}: pruned local archive (in R2)`)
    }
    // A .zst.partial left by a crashed run is garbage; its day is still pending.
    for (const name of fs.readdirSync(archiveDir)) {
      if (name.endsWith('.partial')) fs.rmSync(path.join(archiveDir, name))
    }
  }

  // Only a fully clean run pings, so a dead-man's switch notices both "never
  // ran" and "ran but keeps failing".
  if (result.failed.length === 0 && !options.dryRun && config.pingUrl && deps.ping) await deps.ping(config.pingUrl)
  return result
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      'data-dir': { type: 'string' }
    }
  })
  const dryRun = values['dry-run'] ?? false
  const config = checkpointConfig(process.env, { dataDir: values['data-dir'], dryRun })
  const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`)
  const result = await runCheckpoint(config, { dryRun }, {
    store: config.r2 ? createR2Store(config.r2) : undefined,
    log,
    now: () => Date.now(),
    ping: async (url) => {
      try {
        await fetch(url, { signal: AbortSignal.timeout(10_000) })
      } catch (err) {
        log(`ping failed: ${(err as Error).message}`)
      }
    }
  })
  process.exit(result.failed.length === 0 ? 0 : 1)
}
