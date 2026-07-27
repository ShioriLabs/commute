import useSWR from 'swr'
import type { Manifest } from '../../lib/map-renderer'

export const MAP_BASE_URL = '/maps/fdtj/'
const MANIFEST_URL = `${MAP_BASE_URL}manifest.json`

/**
 * The map's manifest, shared between MapCanvas and whatever route hosts it.
 *
 * Both call this with the same SWR key, so a route that needs the manifest for
 * its own chrome (the attribution's version string) or to decide on a load
 * failure costs no extra request — SWR dedupes on the URL.
 */
export function useMapManifest() {
  const { data, error, isLoading } = useSWR<Manifest>(
    MANIFEST_URL,
    (url: string) => fetch(url).then(r => r.json())
  )
  return { manifest: data, error, isLoading }
}
