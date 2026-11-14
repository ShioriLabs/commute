/*
 * Puts everything under data/ into the LOCAL R2 bucket `wrangler dev` reads,
 * laid out as src/app.ts expects. Local only: production uploads are done by
 * hand (README.md).
 *
 *   pnpm --filter @commute/shirase seed:local
 *
 * One process through wrangler's getPlatformProxy, which binds the same
 * persisted local state `wrangler dev` uses. Not `wrangler r2 object put` per
 * file: that is ~1,300 processes (256 glyph ranges per font), and running them
 * in parallel fails, because local R2 does not take concurrent writers.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPlatformProxy } from 'wrangler'

const SHIRASE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(SHIRASE_DIR, 'data')

const files = (dir) => {
  try {
    return readdirSync(dir).map(name => path.join(dir, name)).filter(p => statSync(p).isFile())
  } catch {
    return []
  }
}

/** [key, file] for every object, in the bucket layout src/app.ts reads. */
const objects = [
  ...files(DATA_DIR).filter(f => f.endsWith('.pmtiles')).map(f => [path.basename(f), f]),
  ...files(path.join(DATA_DIR, 'sprites')).map(f => [`sprites/${path.basename(f)}`, f]),
  ...readdirSafe(path.join(DATA_DIR, 'fonts')).flatMap(stack =>
    files(path.join(DATA_DIR, 'fonts', stack))
      .filter(f => f.endsWith('.pbf'))
      .map(f => [`fonts/${stack}/${path.basename(f)}`, f]))
]

function readdirSafe(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

process.chdir(SHIRASE_DIR)
const { env, dispose } = await getPlatformProxy({ configPath: path.join(SHIRASE_DIR, 'wrangler.toml') })
try {
  console.log(`Putting ${objects.length} objects into local ${'shirase-tiles'}`)
  let done = 0
  for (const [key, file] of objects) {
    await env.TILES.put(key, readFileSync(file))
    if (++done % 250 === 0) console.log(`  ${done}/${objects.length}`)
  }
  console.log(`Done: ${done} objects`)
} finally {
  await dispose()
}
