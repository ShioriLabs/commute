import { fareQueryParams, type FareCriteria } from './fare-criteria'

// Canonical URL for a fare pair.
//
// Fare UI renders on two surfaces — the /fare route and the search sheet's route
// mode — but only /fare is decorated by the SEO middleware
// (functions/_middleware.ts) and rendered by the OG image worker. So a share
// URL must be *constructed* from the station pair, never scraped from
// window.location.href: doing the latter from the search sheet would emit a
// /search URL that previews as a bare, untitled link.
export function buildFareShareUrl(
  fromId: string | null | undefined,
  toId: string | null | undefined,
  origin: string,
  criteria?: FareCriteria,
  journeyKey?: string | null
): string | null {
  const path = buildFarePath(fromId, toId, criteria, journeyKey)
  if (!path) return null
  return new URL(path, origin).toString()
}

// Root-relative form of the same target, for in-app navigation.
//
// Use this with react-router's <Link>, never a bare <a href>: the app runs in
// SPA mode (ssr: false in react-router.config.ts), so a plain anchor triggers a
// full document load and the user watches root.tsx's HydrateFallback spinner
// while the whole bundle re-downloads. <Link> keeps it a client-side transition.
export function buildFarePath(
  fromId: string | null | undefined,
  toId: string | null | undefined,
  criteria?: FareCriteria,
  /*
   * The route the sender was looking at, from utils/journey-key.ts.
   *
   * Written only when a link is actually being shared, and never mirrored into
   * the address bar as the rider taps between options — the same asymmetry
   * `operator` has (see fare-criteria.ts). Mirroring would make every tap a
   * history entry, and would leave a stale key in the URL a rider then copies
   * by hand from the address bar.
   *
   * `from`/`to` stay in the URL beside it, so the SEO middleware and the OG
   * worker — both keyed on the pair alone — keep working untouched.
   */
  journeyKey?: string | null
): string | null {
  if (!fromId || !toId) return null
  // URLSearchParams percent-encodes, which matters because station ids are
  // `OPERATOR-CODE` and future operators may not stay alphanumeric.
  const params = new URLSearchParams({ from: fromId, to: toId })
  // Carried so a shared link reproduces the number the sender saw — QRIS on the
  // Dukuh Atas corridor is Rp 3.000 against stored value's Rp 1. Defaults emit
  // nothing (see fareQueryParams), so an ordinary link keeps the exact
  // `?from=&to=` shape the OG worker and SEO middleware already key on.
  if (criteria) {
    for (const [key, value] of fareQueryParams(criteria)) params.set(key, value)
  }
  if (journeyKey) params.set('j', journeyKey)
  return `/fare?${params.toString()}`
}

// Destination-only entry point, for the station page's "Petunjuk Arah" button:
// the destination is known, the origin gets picked on arrival (/fare auto-opens
// the origin picker for a to-only URL). Deliberately separate from
// buildFarePath, which stays both-required — shares and SEO decoration must
// never emit a half pair.
export function buildFareDestinationPath(toId: string | null | undefined): string | null {
  if (!toId) return null
  return `/fare?${new URLSearchParams({ to: toId }).toString()}`
}
