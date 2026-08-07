import { useSearchParams } from 'react-router'

// `?embed=true` marks pages loaded in the TransportForJakarta iframe (and any
// future embed of the same shape): a host-controlled fixed-height container,
// not the full viewport. dvh exists to dodge the mobile browser toolbar, but
// that never reaches into a fixed-height iframe box — and dvh's value doesn't
// reliably recompute when the iframe goes from a host-side `display:none` to
// visible with no real window resize (transportforjakarta.or.id's Elementor
// tabs do exactly that). Plain vh has neither problem here. See fare.tsx.
export function useIsEmbed(): boolean {
  const [searchParams] = useSearchParams()
  return searchParams.get('embed') === 'true'
}
