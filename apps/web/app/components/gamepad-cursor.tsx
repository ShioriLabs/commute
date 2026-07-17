import { useEffect, useState } from 'react'
import { useGamepad } from '~/contexts/gamepad'

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

// A glowing ring that tracks the focused element's bounding rect while a
// controller is connected. Rendered as a fixed-position screen-space overlay
// (same technique as the map tap ripple) so it floats above everything.
export default function GamepadCursor() {
  const { connected } = useGamepad()
  const [rect, setRect] = useState<Rect | null>(null)

  useEffect(() => {
    if (!connected) {
      setRect(null)
      return
    }

    const track = () => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) {
        setRect(null)
        return
      }
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) {
        setRect(null)
        return
      }
      setRect({ left: r.left, top: r.top, width: r.width, height: r.height })
    }

    // Re-measure on focus changes and on scroll/resize (the focused element
    // moves under the ring otherwise).
    document.addEventListener('focusin', track)
    document.addEventListener('focusout', track)
    window.addEventListener('scroll', track, true)
    window.addEventListener('resize', track)
    track()

    return () => {
      document.removeEventListener('focusin', track)
      document.removeEventListener('focusout', track)
      window.removeEventListener('scroll', track, true)
      window.removeEventListener('resize', track)
    }
  }, [connected])

  if (!connected || !rect) return null

  // Pad the ring slightly outside the target and center it on the padded box.
  const pad = 6
  return (
    <div
      className="gamepad-cursor"
      style={{
        left: rect.left - pad,
        top: rect.top - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2
      }}
      aria-hidden
    />
  )
}
