import { useLayoutEffect, useRef, useState } from 'react'
import { previewCamera, type PreviewCamera } from 'utils/map-morph-camera'

// The camera the map's first frame is drawn with, measured against a container box.
//
// Shared by every layer the morph overlay stacks — the preview image and the skeleton
// (components/map-morph.tsx, components/map-skeleton.tsx) — so they provably measure the
// same box and land on the same frame. That alignment is what makes the overlay's fade
// invisible; two layers measuring independently could drift by a subpixel and shimmer.
export function useMapCamera(): [React.RefObject<HTMLDivElement | null>, PreviewCamera | null] {
  const ref = useRef<HTMLDivElement>(null)
  const [camera, setCamera] = useState<PreviewCamera | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const measure = () => setCamera(previewCamera(el.clientWidth, el.clientHeight))
    measure()
    // Transforms don't change layout size, so measuring while the overlay is
    // squashed onto the card still reads the fullscreen box.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, camera]
}
