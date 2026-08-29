// The lite-build flag, Node side.
//
// Read by the three configs that are evaluated in Node rather than bundled —
// vite.config.ts, react-router.config.ts, and app/routes.ts. App code cannot
// use this module (it has no process.env); it reads app/lib/build-mode.ts
// instead. The two must agree, which is why both key off the same variable name
// and the same '1' comparison.
//
// `process.env` rather than Vite's loadEnv: the flag is set by
// scripts/build-lite.ts in the child process environment, never in a .env file.
// That makes it impossible to leave set in a checked-out .env and quietly ship a
// lite bundle to production.
export const IS_LITE_BUILD = process.env.VITE_LITE === '1'

/**
 * Which host serves the lite bundle. Meaningless unless IS_LITE_BUILD.
 *
 * The second axis. IS_LITE_BUILD answers "what surface is this" — index route,
 * link scoping, branding — and those answers are the same wherever it lands.
 * This answers "what serves it", which is not: Apache needs the .htaccess and
 * none of the Cloudflare files, Pages needs _headers and wrangler.json and
 * none of the .htaccess. Conflating the two is what made the lite build
 * Apache-only in the first place.
 *
 * Defaults to 'apache' so the zip — the path that already existed and that
 * FDTJ can still self-host — is what you get from a bare `pnpm build:lite`.
 */
export const LITE_HOST: 'apache' | 'pages' = process.env.LITE_HOST === 'pages' ? 'pages' : 'apache'
