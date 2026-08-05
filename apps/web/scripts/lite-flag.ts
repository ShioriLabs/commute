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
