/*
 * Packages the self-hosted "Commute Lite" bundle.
 *
 * The output is a zip that FDTJ extracts into a subdomain document root on
 * shared hosting - no Node, no Cloudflare, no build step on their side. Entry
 * point is the map; links off the map/fare surface leave for the full app.
 *
 * Pipeline:
 *   1. Guard the API URL. A bundle silently pointed at localhost is the single
 *      most likely packaging mistake and the one they cannot diagnose.
 *   2. Run `react-router build` with VITE_LITE=1. That flag drops the
 *      Cloudflare plugin (vite.config.ts), empties the prerender list
 *      (react-router.config.ts), swaps the index route to the map
 *      (app/routes.ts), and skips service worker registration (app/root.tsx).
 *   3. Stage build/client into build/lite, then prune what only Cloudflare or
 *      the crawler middleware needs.
 *   4. Patch manifest.json branding, inject .htaccess and the README.
 *   5. Assert the post-conditions, then zip.
 *
 * NOTE this overwrites build/client, so any production build sitting there is
 * clobbered. Run `pnpm build` afterwards if you need it back.
 *
 * Run: pnpm build:lite   (LITE_API_BASE_URL overrides the API origin)
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { directorySize, zipDirectory } from './zip-dir'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(SCRIPT_DIR, '..')
const CLIENT_DIR = path.join(WEB_ROOT, 'build', 'client')
const STAGE_DIR = path.join(WEB_ROOT, 'build', 'lite')
const ASSET_DIR = path.join(SCRIPT_DIR, 'assets', 'lite')

// Production API. Overridable for a staging package, but never blank: the
// client bakes this in at build time and cannot be repointed afterwards.
const API_BASE_URL = process.env.LITE_API_BASE_URL ?? 'https://api.commute.shiorilabs.id'

/*
 * Branding.
 *
 * Commute's own, deliberately: FDTJ hosts this deployment, they do not rebrand
 * it. Keep in step with the branding constants in app/lib/build-mode.ts, which
 * cover the client-rendered half (title, OG tags).
 */
const LITE_BRANDING = {
  name: 'Commute',
  shortName: 'Commute',
  // Distinct from id.shiorilabs.commute so an install from FDTJ's origin is its
  // own app rather than reading as an update to the full one. Two origins would
  // imply that anyway; the id is what the install prompt actually keys on.
  id: 'id.shiorilabs.commute.lite',
  // Says what this bundle is rather than what Commute is, since the lite
  // surface is the map and the fare page, not the whole app.
  description: 'Peta Integrasi Transportasi Jabodetabek'
}

// Cloudflare deploy config and crawler-middleware assets. None of it does
// anything on Apache, and leaving it in the archive invites someone to edit a
// file that is never read.
const PRUNE_PATHS = [
  'wrangler.json',
  '_headers',
  '.assetsignore',
  // Shipped without a service worker: registration is compiled out in the lite
  // build (app/root.tsx), so the file would be dead weight that a stray
  // registration could still find.
  'service-worker.js',
  // ~5 MB of prerendered per-station OG cards, read only by the Cloudflare
  // Pages crawler middleware. Nothing in app/ references them.
  path.join('img', 'og')
]

function fail(message: string): never {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

function countFiles(dir: string): number {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    total += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1
  }
  return total
}

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function guardApiUrl(): void {
  if (/localhost|127\.0\.0\.1|\[::1\]/.test(API_BASE_URL)) {
    fail(
      `Refusing to package against ${API_BASE_URL}.\n`
      + '  The API URL is baked into the bundle at build time, so a localhost\n'
      + '  build reaches nothing once extracted. Set LITE_API_BASE_URL.'
    )
  }
  try {
    void new URL(API_BASE_URL)
  } catch {
    fail(`LITE_API_BASE_URL is not a valid URL: ${API_BASE_URL}`)
  }
}

function runBuild(): void {
  console.log(`Building lite bundle against ${API_BASE_URL} ...`)
  execFileSync('pnpm', ['exec', 'react-router', 'build'], {
    cwd: WEB_ROOT,
    stdio: 'inherit',
    env: { ...process.env, VITE_LITE: '1', VITE_API_BASE_URL: API_BASE_URL }
  })
}

function stage(): void {
  rmSync(STAGE_DIR, { recursive: true, force: true })
  mkdirSync(STAGE_DIR, { recursive: true })
  cpSync(CLIENT_DIR, STAGE_DIR, { recursive: true })

  for (const relative of PRUNE_PATHS) {
    const target = path.join(STAGE_DIR, relative)
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true })
      console.log(`  pruned ${relative}`)
    }
  }

  // The shipped robots.txt advertises commute.shiorilabs.id/sitemap.xml, which
  // this deployment does not serve. Replace rather than drop, so the site stays
  // explicitly indexable.
  writeFileSync(
    path.join(STAGE_DIR, 'robots.txt'),
    'User-agent: *\nAllow: /\n'
  )
}

function patchManifest(): void {
  const manifestPath = path.join(STAGE_DIR, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

  manifest.name = LITE_BRANDING.name
  manifest.short_name = LITE_BRANDING.shortName
  manifest.id = LITE_BRANDING.id
  manifest.description = LITE_BRANDING.description
  // start_url stays '/', which in this build renders the map (app/routes.ts).

  // Patched rather than replaced by a second file: the icon array is the bulk
  // of this manifest and must not fork.
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

function injectHostFiles(): void {
  cpSync(path.join(ASSET_DIR, '.htaccess'), path.join(STAGE_DIR, '.htaccess'))

  const tileBuild = JSON.parse(
    readFileSync(path.join(STAGE_DIR, 'maps', 'fdtj', 'manifest.json'), 'utf8')
  ).build
  const version = JSON.parse(
    readFileSync(path.join(WEB_ROOT, 'package.json'), 'utf8')
  ).version

  // Stamped so a problem reported months from now is diagnosable rather than
  // guessable: which build, which map, which API.
  const provenance = [
    '<!--',
    'Build provenance',
    `  packaged:  ${new Date().toISOString().slice(0, 10)}`,
    `  app:       v${version}`,
    `  map tiles: ${tileBuild}`,
    `  API:       ${API_BASE_URL}`,
    '-->'
  ].join('\n')

  const readme = readFileSync(path.join(ASSET_DIR, 'README-FDTJ.md'), 'utf8')
    .replace('<!-- BUILD_PROVENANCE -->', provenance)
  writeFileSync(path.join(STAGE_DIR, 'README-FDTJ.md'), readme)
}

/**
 * Post-conditions.
 *
 * A packaging script that can silently ship a wrong archive has the longest
 * feedback loop of anything here - the next reader is a volunteer on shared
 * hosting with no way to debug it. So the checks are assertions, not logs.
 */
function verify(): void {
  const problems: string[] = []
  const absent = (relative: string) => {
    if (existsSync(path.join(STAGE_DIR, relative))) problems.push(`should have been pruned: ${relative}`)
  }
  const present = (relative: string) => {
    if (!existsSync(path.join(STAGE_DIR, relative))) problems.push(`missing: ${relative}`)
  }

  for (const relative of PRUNE_PATHS) absent(relative)
  present('.htaccess')
  present('README-FDTJ.md')
  present('index.html')
  present('manifest.json')
  present(path.join('maps', 'fdtj', 'manifest.json'))

  // Prerendering is off in lite, so no settings/**/index.html should exist to
  // collide with the SPA rewrite.
  const settingsDir = path.join(STAGE_DIR, 'settings')
  if (existsSync(settingsDir) && countFiles(settingsDir) > 0) {
    problems.push('settings/ contains prerendered pages; prerender should be empty in lite')
  }

  // The tiles are the deliverable. A truncated copy still "builds".
  const tileCount = countFiles(path.join(STAGE_DIR, 'maps', 'fdtj'))
  if (tileCount < 250) problems.push(`maps/fdtj has only ${tileCount} files, expected ~258`)

  // The whole point of the SW decision: nothing may try to register one.
  const assetsDir = path.join(STAGE_DIR, 'assets')
  for (const entry of readdirSync(assetsDir)) {
    if (!entry.endsWith('.js')) continue
    if (readFileSync(path.join(assetsDir, entry), 'utf8').includes('service-worker.js')) {
      problems.push(`${entry} still references service-worker.js`)
    }
  }

  // The build-time API bake, confirmed in the emitted bytes rather than assumed
  // from the env var we passed in.
  const bakedIn = readdirSync(assetsDir).some(entry =>
    entry.endsWith('.js') && readFileSync(path.join(assetsDir, entry), 'utf8').includes(API_BASE_URL)
  )
  if (!bakedIn) problems.push(`no bundle references ${API_BASE_URL}; the API URL may not have been baked in`)

  if (problems.length > 0) {
    fail(`Package failed verification:\n    - ${problems.join('\n    - ')}`)
  }
  console.log('  post-conditions OK')
}

function archive(): string {
  const version = JSON.parse(
    readFileSync(path.join(WEB_ROOT, 'package.json'), 'utf8')
  ).version
  const stamp = new Date().toISOString().slice(0, 10)
  const zipName = `commute-lite-v${version}-${stamp}.zip`
  const zipPath = path.join(WEB_ROOT, 'build', zipName)

  rmSync(zipPath, { force: true })
  // Written in-process rather than shelling out to `zip`: that binary is absent
  // often enough (CI images, WSL, plain Windows) that depending on it would
  // make packaging fail on machines where everything else works. Paths are
  // stored relative to the staging root, so "extract here" lands the document
  // root where FDTJ expects it.
  zipDirectory(STAGE_DIR, zipPath)
  return zipPath
}

function main(): void {
  guardApiUrl()
  runBuild()
  stage()
  patchManifest()
  injectHostFiles()
  verify()

  const zipPath = archive()
  console.log([
    '',
    `  ${path.relative(WEB_ROOT, zipPath)}`,
    `  ${countFiles(STAGE_DIR)} files, ${mib(directorySize(STAGE_DIR))} unpacked, ${mib(statSync(zipPath).size)} zipped`,
    `  API: ${API_BASE_URL}`,
    ''
  ].join('\n'))
}

main()
