#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { r2Config } from './config.ts'
import { type ArchiveStore, createR2Store, sha256File } from './r2.ts'

/*
 * Laptop side: download the daily archives missing locally from R2 and check
 * each against the sha256 recorded at upload. Analysis then runs on the local
 * copies (apps/api `analyze:headways --dir <out>`).
 */

export async function pullArchives(
  store: ArchiveStore,
  outDir: string,
  log: (message: string) => void
): Promise<{ downloaded: string[], failed: string[] }> {
  fs.mkdirSync(outDir, { recursive: true })
  const result = { downloaded: [] as string[], failed: [] as string[] }
  for (const object of await store.list('raw/')) {
    const name = path.basename(object.key)
    const dest = path.join(outDir, name)
    if (fs.existsSync(dest) && fs.statSync(dest).size === object.size) continue

    const partial = `${dest}.partial`
    await store.download(object.key, partial)
    const expected = (await store.head(object.key))?.meta.sha256
    const actual = await sha256File(partial)
    if (!expected || expected !== actual) {
      fs.rmSync(partial)
      result.failed.push(name)
      log(`${name}: sha256 mismatch (expected ${expected}, got ${actual}); discarded`)
      continue
    }
    fs.renameSync(partial, dest)
    result.downloaded.push(name)
    log(`${name}: ${(object.size / 1e6).toFixed(1)}MB`)
  }
  if (result.downloaded.length === 0 && result.failed.length === 0) log('up to date')
  return result
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } })
  if (!values.out) throw new Error('--out <dir> is required')
  const result = await pullArchives(createR2Store(r2Config()), values.out, console.log)
  process.exit(result.failed.length === 0 ? 0 : 1)
}
