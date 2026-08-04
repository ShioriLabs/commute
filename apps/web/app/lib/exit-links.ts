// Where an in-app link goes, given which build is running.
//
// The lite bundle (see app/lib/build-mode.ts) hosts two surfaces: the map and
// the fare page. It still *contains* every other route — the route tree is not
// pruned, because a pruned tree turns every <Link> in the shared sheets into a
// link to nowhere, which is worse than the problem it solves. So scope is
// enforced here, at the link layer: anything outside the hosted surface becomes
// an absolute link to the full app, and the lite map reads as a funnel into it
// rather than a truncated copy of it.
//
// In the normal build every function here returns 'internal' unconditionally,
// Rollup folds IS_LITE, and the whole lite branch is eliminated. That is what
// lets the shared components call this without a second thought.
import { FULL_APP_ORIGIN, IS_LITE } from './build-mode'

// Route prefixes the lite bundle serves as real pages.
//
// Deliberately a list of prefixes rather than a lookup against the route tree:
// the full tree is registered in lite, so "is this route registered" answers
// yes for everything and tells us nothing about what FDTJ agreed to host.
const LITE_SURFACES = ['/map', '/fare']

/**
 * Whether `path` is a page the lite bundle serves itself.
 *
 * `/` counts: in lite it renders the map (app/routes.ts swaps the index route),
 * so it is the most-hosted page there is.
 */
export function isLiteSurface(path: string): boolean {
  // Compare pathnames only. `/fare?from=X&to=Y` is the fare page, and the map's
  // departure picker builds exactly that shape.
  const pathname = path.split('?')[0].split('#')[0]
  if (pathname === '/') return true
  return LITE_SURFACES.some(surface => pathname === surface || pathname.startsWith(`${surface}/`))
}

export type ExitTarget =
  | { kind: 'internal', to: string }
  | { kind: 'external', href: string }

/**
 * Pure core: takes the flag rather than reading it, so tests can cover both
 * builds without stubbing import.meta.env and resetting the module registry.
 * Mirrors how sheet-route-dismiss.ts keeps `resolveDismiss` pure.
 */
export function resolveExitFor(to: string, isLite: boolean): ExitTarget {
  if (!isLite) return { kind: 'internal', to }
  if (isLiteSurface(to)) return { kind: 'internal', to }
  return { kind: 'external', href: new URL(to, FULL_APP_ORIGIN).href }
}

/** `resolveExitFor` against the current build. */
export function resolveExit(to: string): ExitTarget {
  return resolveExitFor(to, IS_LITE)
}

/**
 * Where the map's escape hatches point — the back button and the "go home"
 * links on the manifest-error and WebGL-fatal screens.
 *
 * Not `resolveExit('/')`: in lite `/` IS the map, so that would resolve to
 * 'internal' and the escape hatch would reload the page the user is trying to
 * escape. These sites want "leave for the app that has a home page", which is a
 * different question from "is this path hosted here".
 */
export const HOME_EXIT: ExitTarget = IS_LITE
  ? { kind: 'external', href: FULL_APP_ORIGIN }
  : { kind: 'internal', to: '/' }
