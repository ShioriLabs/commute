import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { stampServiceWorker } from './stamp-service-worker'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SW_PATH = path.resolve(HERE, '..', 'public', 'service-worker.js')
const MANIFEST_PATH = path.resolve(HERE, '..', 'public', 'maps', 'fdtj', 'manifest.json')

const readWorker = () => readFileSync(SW_PATH, 'utf8')

describe('stampServiceWorker', () => {
  it('rewrites the build constant and leaves everything else byte-identical', () => {
    const source = 'const A = 1\nconst TILE_BUILD = \'aaaaaaaa\'\nconst B = 2\n'

    expect(stampServiceWorker(source, 'deadbeef'))
      .toBe('const A = 1\nconst TILE_BUILD = \'deadbeef\'\nconst B = 2\n')
  })

  // A no-op stamp is the failure mode that recreates the original bug: the
  // build would look successful while the worker kept naming its cache after a
  // superseded hash, so no client would ever see the new tiles.
  it('throws rather than silently doing nothing when the constant is missing', () => {
    expect(() => stampServiceWorker('const CACHE_NAME = \'pwa-cache-v5\'\n', 'deadbeef'))
      .toThrow(/no `const TILE_BUILD/)
  })

  it('is idempotent, so an unchanged re-tile produces no diff', () => {
    const once = stampServiceWorker(readWorker(), 'deadbeef')

    expect(stampServiceWorker(once, 'deadbeef')).toBe(once)
  })

  // Runs against the real file so renaming or reformatting the constant fails
  // here, at desk, rather than during a re-tile hours later.
  it('matches the shipped service worker', () => {
    const stamped = stampServiceWorker(readWorker(), 'deadbeef')

    expect(stamped).toContain('const TILE_BUILD = \'deadbeef\'')
    expect(stamped).not.toBe(readWorker())
  })

  it('leaves the worker already stamped with the shipped build hash', () => {
    const { build } = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))

    expect(stampServiceWorker(readWorker(), build)).toBe(readWorker())
  })
})
