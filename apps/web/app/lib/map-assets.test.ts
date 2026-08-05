import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MAP_BUILD, MAP_MANIFEST_URL, MAP_PREVIEW_URL } from './map-assets'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(HERE, '..', '..')
const APP_DIR = path.join(WEB_ROOT, 'app')
const MANIFEST_PATH = path.join(WEB_ROOT, 'public', 'maps', 'fdtj', 'manifest.json')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    // Shipped code only. Tests name the path deliberately — to seed a cache, to
    // assert a route matched — and never issue a real request with it.
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return []
    return [full]
  })
}

describe('map asset urls', () => {
  it('stamps the preview with the shipped build hash', () => {
    const { build } = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))

    expect(MAP_BUILD).toBe(build)
    expect(MAP_PREVIEW_URL).toBe(`/maps/fdtj/preview.webp?v=${build}`)
  })

  // The manifest is the version pointer, served max-age=300. Stamping it with
  // the build it exists to reveal would be circular, and would break the
  // warm-up whose whole job is priming the entry map.tsx's SWR call reads.
  it('leaves the manifest url unstamped', () => {
    expect(MAP_MANIFEST_URL).toBe('/maps/fdtj/manifest.json')
  })

  // public/_headers serves the preview `immutable, max-age=31536000`, so any
  // unstamped request pins a year-long HTTP disk entry that survives "Clear
  // site data". One bare literal anywhere is enough to keep that entry warm for
  // every user, so the guard is mechanical rather than a code-review habit.
  it('is the only place that names the preview path', () => {
    const offenders = sourceFiles(APP_DIR)
      .filter(file => path.basename(file) !== 'map-assets.ts')
      .filter(file => readFileSync(file, 'utf8').includes('/maps/fdtj/preview.webp'))
      .map(file => path.relative(WEB_ROOT, file))

    expect(offenders).toEqual([])
  })
})
