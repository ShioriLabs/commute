/*
 * Writes the tile build hash into public/service-worker.js.
 *
 * The worker is a plain static file — no bundler, no imports, copied verbatim
 * into build/client — so the hash cannot reach it by any route but textual
 * substitution. That is the same shape as the manifest.json write this sits
 * beside in build-map-tiles.ts: a build script writing a tracked source file,
 * committed alongside the tiles it describes.
 *
 * Why it has to reach the worker at all: the worker names its tile cache after
 * this hash. While the name was hand-edited it simply never moved, so a re-tile
 * shipped new bytes that no client would ever see — cacheFirst matches with
 * `ignoreSearch`, which makes the `?v=` stamp on the page's requests invisible
 * to CacheStorage. Changing the worker's bytes is also what triggers the
 * update -> install -> activate cycle that delivers the new tiles at all.
 *
 * Extracted as a pure function because build-map-tiles.ts calls main() at module
 * scope and so cannot be imported by a test.
 */

const TILE_BUILD_RE = /^const TILE_BUILD = '[0-9a-f]*'$/m

export function stampServiceWorker(source: string, build: string): string {
  if (!TILE_BUILD_RE.test(source)) {
    throw new Error(
      'service-worker.js has no `const TILE_BUILD = \'...\'` line to stamp. '
      + 'If it was renamed or reformatted, update TILE_BUILD_RE to match — a '
      + 'silent no-op here is exactly how the cache name and the tiles drifted '
      + 'apart in the first place.'
    )
  }
  return source.replace(TILE_BUILD_RE, `const TILE_BUILD = '${build}'`)
}
