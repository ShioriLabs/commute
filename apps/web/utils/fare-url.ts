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
  origin: string
): string | null {
  const path = buildFarePath(fromId, toId)
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
  toId: string | null | undefined
): string | null {
  if (!fromId || !toId) return null
  // URLSearchParams percent-encodes, which matters because station ids are
  // `OPERATOR-CODE` and future operators may not stay alphanumeric.
  const params = new URLSearchParams({ from: fromId, to: toId })
  return `/fare?${params.toString()}`
}
