import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckpointConfig } from './config.ts'
import { runCheckpoint } from './checkpoint.ts'
import { archiveKey, uploadedMarkerName } from './days.ts'
import type { ArchiveMeta, ArchiveStore, RemoteObject } from './r2.ts'

/*
 * Runs the real zcat/zstd binaries (the VPS has them; install.sh apt-installs
 * zstd) against a temp dir. R2 is an in-memory fake.
 */

const NOW = Date.UTC(2026, 9, 2, 3) // 2026-10-02 10:00 WIB

let dataDir: string
const log = vi.fn()

function writeHour(day: string, hour: string, records: object[]) {
  const file = path.join(dataDir, `snap-${day}-${hour}.ndjson.gz`)
  // One gzip member per line, exactly like the collector.
  for (const r of records) fs.appendFileSync(file, zlib.gzipSync(JSON.stringify(r) + '\n'))
}

const snapshot = (t: number) => ({ k: 's', t, v: [['MYS-1', '1', 'H00132P-X', -6.2, 106.8, 1, t]] })

function fakeStore(options: { corruptSha?: boolean } = {}) {
  const objects = new Map<string, { bytes: Buffer, meta: ArchiveMeta }>()
  const store: ArchiveStore & { objects: typeof objects, puts: number } = {
    objects,
    puts: 0,
    async put(key, filePath, meta) {
      store.puts++
      objects.set(key, { bytes: fs.readFileSync(filePath), meta })
    },
    async head(key): Promise<RemoteObject | undefined> {
      const object = objects.get(key)
      if (!object) return undefined
      const sha256 = options.corruptSha ? 'not-the-sha' : object.meta.sha256
      return { key, size: object.bytes.length, meta: { ...object.meta, sha256 } }
    },
    async list(prefix) {
      return [...objects].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length, meta: o.meta }))
    },
    async download(key, filePath) {
      fs.writeFileSync(filePath, objects.get(key)!.bytes)
    }
  }
  return store
}

const config = (overrides: Partial<CheckpointConfig> = {}): CheckpointConfig => ({
  dataDir,
  keepArchiveDays: 30,
  ...overrides
})

const deps = (store?: ArchiveStore, ping?: (url: string) => Promise<void>) => ({ store, log, now: () => NOW, ping })

const hourlyFiles = () => fs.readdirSync(dataDir).filter(f => f.endsWith('.ndjson.gz')).sort()
const archiveDir = () => path.join(dataDir, 'archive')

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ward-checkpoint-'))
  log.mockClear()
  writeHour('20260930', '11', [{ k: 'start', t: 1 }, snapshot(2), snapshot(3)])
  writeHour('20260930', '12', [snapshot(4), { k: 'gap', from: 4, to: 5, why: 'idle' }, snapshot(5)])
  writeHour('20261001', '00', [snapshot(6)])
  writeHour('20261002', '09', [snapshot(7)]) // today: the collector's live file
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('runCheckpoint', () => {
  it('dry run archives complete days losslessly and changes nothing else', async () => {
    const result = await runCheckpoint(config(), { dryRun: true }, deps())

    expect(result.archived).toEqual(['20260930', '20261001'])
    expect(result.uploaded).toEqual([])
    expect(hourlyFiles()).toHaveLength(4)
    const archive = path.join(archiveDir(), 'snap-20260930.ndjson.zst')
    const restored = execFileSync('zstd', ['-dc', '--long=27', archive]).toString()
    const original = execFileSync('zcat', [
      path.join(dataDir, 'snap-20260930-11.ndjson.gz'),
      path.join(dataDir, 'snap-20260930-12.ndjson.gz')
    ]).toString()
    expect(restored).toBe(original)
    expect(fs.existsSync(path.join(archiveDir(), uploadedMarkerName('20260930')))).toBe(false)
  })

  it('uploads, verifies, marks and only then deletes; never touches today', async () => {
    const store = fakeStore()
    const result = await runCheckpoint(config(), { dryRun: false }, deps(store))

    expect(result.uploaded).toEqual(['20260930', '20261001'])
    expect(result.failed).toEqual([])
    expect(store.objects.get(archiveKey('20260930'))?.meta).toMatchObject({ hours: 2, snapshots: 4 })
    expect(hourlyFiles()).toEqual(['snap-20261002-09.ndjson.gz'])
    expect(fs.existsSync(path.join(archiveDir(), uploadedMarkerName('20260930')))).toBe(true)
  })

  it('a dry run followed by a real run still uploads the dry-run archive', async () => {
    await runCheckpoint(config(), { dryRun: true }, deps())
    const store = fakeStore()
    const result = await runCheckpoint(config(), { dryRun: false }, deps(store))
    expect(result.uploaded).toEqual(['20260930', '20261001'])
    expect(result.archived).toEqual([]) // reused, not recompressed
  })

  it('is a no-op when re-run after success', async () => {
    const store = fakeStore()
    await runCheckpoint(config(), { dryRun: false }, deps(store))
    const puts = store.puts
    const result = await runCheckpoint(config(), { dryRun: false }, deps(store))
    expect(result).toEqual({ archived: [], uploaded: [], pruned: [], failed: [] })
    expect(store.puts).toBe(puts)
  })

  it('keeps every local file when R2 verification fails, and retries next run', async () => {
    const result = await runCheckpoint(config(), { dryRun: false }, deps(fakeStore({ corruptSha: true })))

    expect(result.failed.map(f => f.day)).toEqual(['20260930', '20261001'])
    expect(result.failed[0]!.error).toMatch(/verification failed/)
    expect(hourlyFiles()).toHaveLength(4)
    expect(fs.existsSync(path.join(archiveDir(), uploadedMarkerName('20260930')))).toBe(false)

    const retry = await runCheckpoint(config(), { dryRun: false }, deps(fakeStore()))
    expect(retry.uploaded).toEqual(['20260930', '20261001'])
  })

  it('quarantines a day with a truncated gzip instead of deleting the only full copy', async () => {
    const damaged = path.join(dataDir, 'snap-20261001-00.ndjson.gz')
    const bytes = fs.readFileSync(damaged)
    fs.writeFileSync(damaged, Buffer.concat([bytes, zlib.gzipSync(JSON.stringify(snapshot(8)) + '\n').subarray(0, 12)]))

    const store = fakeStore()
    const result = await runCheckpoint(config(), { dryRun: false }, deps(store))

    expect(result.uploaded).toContain('20261001')
    expect(fs.existsSync(path.join(dataDir, 'quarantine', 'snap-20261001-00.ndjson.gz'))).toBe(true)
    expect(log.mock.calls.flat().join('\n')).toMatch(/WARNING zcat exited/)
    // A re-run must not delete the quarantined copy.
    await runCheckpoint(config(), { dryRun: false }, deps(store))
    expect(fs.existsSync(path.join(dataDir, 'quarantine', 'snap-20261001-00.ndjson.gz'))).toBe(true)
  })

  it('prunes local archives past the retention window, keeping R2 as the copy', async () => {
    const store = fakeStore()
    await runCheckpoint(config(), { dryRun: false }, deps(store))
    const result = await runCheckpoint(config({ keepArchiveDays: 1 }), { dryRun: false }, deps(store))
    expect(result.pruned).toEqual(['20260930'])
    expect(fs.readdirSync(archiveDir()).sort()).toEqual(['snap-20261001.ndjson.zst', uploadedMarkerName('20261001')])
    expect(store.objects.has(archiveKey('20260930'))).toBe(true)
  })

  it('pings the dead-man switch only on a fully clean run', async () => {
    const ping = vi.fn(async () => {})
    await runCheckpoint(config({ pingUrl: 'https://hc.example/x' }), { dryRun: false }, deps(fakeStore({ corruptSha: true }), ping))
    expect(ping).not.toHaveBeenCalled()
    await runCheckpoint(config({ pingUrl: 'https://hc.example/x' }), { dryRun: false }, deps(fakeStore(), ping))
    expect(ping).toHaveBeenCalledWith('https://hc.example/x')
  })

  it('refuses a real run without a store', async () => {
    await expect(runCheckpoint(config(), { dryRun: false }, deps())).rejects.toThrow(/store is required/)
  })
})
