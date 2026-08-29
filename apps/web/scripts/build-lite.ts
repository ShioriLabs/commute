/*
 * Builds the "Commute Lite" bundle - the map/fare surface, for a host that
 * isn't commute.shiorilabs.id.
 *
 * Two hosts, selected by --host:
 *
 *   apache (default)  A zip FDTJ extracts into a subdomain document root on
 *                     shared hosting - no Node, no Cloudflare, no build step on
 *                     their side. This is the fallback path, kept so they can
 *                     self-host if they ever want to.
 *   pages             A directory deployed to Cloudflare Pages, which is where
 *                     the deployment actually lives. Same infrastructure as the
 *                     main app, so the _headers caching rules apply and updates
 *                     ride the same release as everything else.
 *
 * The surface is identical either way - that half is VITE_LITE, and it does not
 * care what serves it. What differs is host plumbing: Apache needs the
 * .htaccess and none of the Cloudflare files, Pages needs the Cloudflare files
 * and none of the .htaccess. See LITE_HOST in scripts/lite-flag.ts.
 *
 * Pipeline:
 *   1. Guard the API URL. A bundle silently pointed at localhost is the single
 *      most likely packaging mistake and the one FDTJ cannot diagnose.
 *   2. Run `react-router build` with VITE_LITE=1. That flag empties the
 *      prerender list (react-router.config.ts), swaps the index route to the
 *      map (app/routes.ts), and skips service worker registration
 *      (app/root.tsx). With --host=apache it also drops the Cloudflare plugin
 *      (vite.config.ts).
 *   3. Stage build/client into build/lite, then prune per host.
 *   4. Patch manifest.json branding; for Apache, inject .htaccess and README.
 *   5. Assert the post-conditions. For Apache, zip.
 *
 * NOTE this overwrites build/client, so any production build sitting there is
 * clobbered. Run `pnpm build` afterwards if you need it back.
 *
 * Run: pnpm build:lite         (the zip)
 *      pnpm build:lite:pages   (the Pages directory)
 *      LITE_API_BASE_URL overrides the API origin for either.
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

type LiteHost = 'apache' | 'pages'

// Pruned from every lite bundle, whatever serves it.
const PRUNE_ALWAYS = [
  // Shipped without a service worker: registration is compiled out in the lite
  // build (app/root.tsx), so the file would be dead weight that a stray
  // registration could still find. True on Pages too for now - see the plan's
  // deferred follow-up; when the SW comes back for Pages this moves into
  // PRUNE_APACHE and the root.tsx gate moves onto the host axis.
  'service-worker.js',
  // ~5 MB of prerendered per-station OG cards, read only by the crawler
  // middleware, which no lite bundle runs. Nothing in app/ references them.
  path.join('img', 'og')
]

// Cloudflare deploy config. Inert on Apache, and leaving it in the archive
// invites someone to edit a file that is never read. On Pages it is exactly
// what makes the deployment work, so it stays.
const PRUNE_APACHE = [
  'wrangler.json',
  '_headers',
  '.assetsignore'
]

const prunePathsFor = (host: LiteHost) =>
  host === 'apache' ? [...PRUNE_ALWAYS, ...PRUNE_APACHE] : PRUNE_ALWAYS

/**
 * `--host=pages` | `--host=apache`, defaulting to apache.
 *
 * Rejects anything else rather than falling back: a typo'd host silently
 * producing the wrong bundle shape is the mistake this whole script exists to
 * prevent.
 */
function parseHost(argv: string[]): LiteHost {
  const flag = argv.find(arg => arg.startsWith('--host'))
  if (!flag) return 'apache'
  const value = flag.includes('=') ? flag.split('=')[1] : argv[argv.indexOf(flag) + 1]
  if (value === 'pages' || value === 'apache') return value
  fail(`Unknown --host ${value ?? '(missing)'}. Expected 'pages' or 'apache'.`)
}

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

function runBuild(host: LiteHost): void {
  console.log(`Building lite bundle for ${host} against ${API_BASE_URL} ...`)
  execFileSync('pnpm', ['exec', 'react-router', 'build'], {
    cwd: WEB_ROOT,
    stdio: 'inherit',
    // LITE_HOST is read by scripts/lite-flag.ts (configs, Node side);
    // VITE_LITE_HOST is the same value bundled for app/lib/build-mode.ts. Both
    // are set here so the two halves cannot disagree.
    env: {
      ...process.env,
      VITE_LITE: '1',
      VITE_LITE_HOST: host,
      LITE_HOST: host,
      VITE_API_BASE_URL: API_BASE_URL
    }
  })
}

function stage(host: LiteHost): void {
  rmSync(STAGE_DIR, { recursive: true, force: true })
  mkdirSync(STAGE_DIR, { recursive: true })
  cpSync(CLIENT_DIR, STAGE_DIR, { recursive: true })

  for (const relative of prunePathsFor(host)) {
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

/**
 * What built this bundle. Stamped so a problem reported months from now is
 * diagnosable rather than guessable: which build, which map, which API.
 */
function provenance(): { packaged: string, app: string, tiles: string, api: string } {
  return {
    packaged: new Date().toISOString().slice(0, 10),
    app: JSON.parse(readFileSync(path.join(WEB_ROOT, 'package.json'), 'utf8')).version,
    tiles: JSON.parse(
      readFileSync(path.join(STAGE_DIR, 'maps', 'fdtj', 'manifest.json'), 'utf8')
    ).build,
    api: API_BASE_URL
  }
}

/**
 * Files the host needs that the build does not emit.
 *
 * Apache gets the .htaccess (its whole cache/rewrite policy, since _headers is
 * inert there) and the install README. Pages needs neither: _headers and
 * wrangler.json survive the prune and do the same job.
 */
function injectHostFiles(host: LiteHost): void {
  const stamp = provenance()

  if (host === 'pages') {
    // No README to carry the stamp on this path, so it gets its own file.
    // Served as a real URL, which makes "what is actually deployed right now"
    // answerable with curl rather than a dashboard.
    writeFileSync(
      path.join(STAGE_DIR, 'build-info.json'),
      `${JSON.stringify(stamp, null, 2)}\n`
    )
    return
  }

  cpSync(path.join(ASSET_DIR, '.htaccess'), path.join(STAGE_DIR, '.htaccess'))

  const block = [
    '<!--',
    'Build provenance',
    `  packaged:  ${stamp.packaged}`,
    `  app:       v${stamp.app}`,
    `  map tiles: ${stamp.tiles}`,
    `  API:       ${stamp.api}`,
    '-->'
  ].join('\n')

  const readme = readFileSync(path.join(ASSET_DIR, 'README-FDTJ.md'), 'utf8')
    .replace('<!-- BUILD_PROVENANCE -->', block)
  writeFileSync(path.join(STAGE_DIR, 'README-FDTJ.md'), readme)
}

/**
 * Post-conditions.
 *
 * A packaging script that can silently ship a wrong archive has the longest
 * feedback loop of anything here - the next reader is a volunteer on shared
 * hosting with no way to debug it. So the checks are assertions, not logs.
 */
function verify(host: LiteHost): void {
  const problems: string[] = []
  const absent = (relative: string) => {
    if (existsSync(path.join(STAGE_DIR, relative))) problems.push(`should have been pruned: ${relative}`)
  }
  const present = (relative: string) => {
    if (!existsSync(path.join(STAGE_DIR, relative))) problems.push(`missing: ${relative}`)
  }

  for (const relative of prunePathsFor(host)) absent(relative)
  present('index.html')
  present('manifest.json')
  present(path.join('maps', 'fdtj', 'manifest.json'))

  if (host === 'apache') {
    present('.htaccess')
    present('README-FDTJ.md')
  } else {
    // The two files that make a Pages deployment behave: _headers carries the
    // tile caching policy, wrangler.json the SPA fallback. Silently shipping
    // without them looks fine until every tile is refetched and every deep link
    // 404s.
    present('_headers')
    present('wrangler.json')
    present('build-info.json')
    absent('.htaccess')
  }

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

/** Extracted so main() can size the archive without recomputing the name. */
function zipName(): string {
  const version = JSON.parse(
    readFileSync(path.join(WEB_ROOT, 'package.json'), 'utf8')
  ).version
  return `commute-lite-v${version}-${new Date().toISOString().slice(0, 10)}.zip`
}

function archive(): string {
  const zipPath = path.join(WEB_ROOT, 'build', zipName())

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
  const host = parseHost(process.argv.slice(2))

  guardApiUrl()
  runBuild(host)
  stage(host)
  patchManifest()
  injectHostFiles(host)
  verify(host)

  const summary = [
    '',
    // Pages deploys the staged directory itself, so there is nothing to zip.
    host === 'pages'
      ? `  ${path.relative(WEB_ROOT, STAGE_DIR)}`
      : `  ${path.relative(WEB_ROOT, archive())}`
  ]

  if (host === 'pages') {
    summary.push(`  ${countFiles(STAGE_DIR)} files, ${mib(directorySize(STAGE_DIR))}`)
    summary.push(`  API: ${API_BASE_URL}`)
    summary.push('')
    summary.push(`  Deploy: pnpm dlx wrangler pages deploy ${path.relative(WEB_ROOT, STAGE_DIR)}`)
  } else {
    const zipPath = path.join(WEB_ROOT, 'build', zipName())
    summary.push(
      `  ${countFiles(STAGE_DIR)} files, ${mib(directorySize(STAGE_DIR))} unpacked, ${mib(statSync(zipPath).size)} zipped`
    )
    summary.push(`  API: ${API_BASE_URL}`)
  }
  summary.push('')
  console.log(summary.join('\n'))
}

main()
