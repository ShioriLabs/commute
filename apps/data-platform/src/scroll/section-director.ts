// Maps scroll position to a continuous camera pose + highlight target. Beats are
// anchored to page sections; as the user scrolls, we find which two beats the
// viewport centre sits between and interpolate their poses, so transitions are
// continuous rather than snapping at section edges. The camera's own damping
// smooths residual jitter. Reduced-motion snaps to the nearest beat instead.
import { lerpAngle, orbit, type Camera, type Pose, type Vec3Tuple } from '../gl/camera'
import type { Renderer } from '../gl/renderer'
import type { Beat, BeatId } from './beats'

interface AnchoredBeat extends Beat {
  el: HTMLElement
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpVec(a: Vec3Tuple, b: Vec3Tuple, t: number): Vec3Tuple {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

// Interpolate in ORBIT space (yaw/pitch/distance around the target), not on the
// resolved eye vector. A straight line between an on-axis eye and a yawed eye is
// a chord: it passes nearer the target than either endpoint, so the camera would
// dive toward the plane mid-transition instead of orbiting around it. Poses built
// by framingPose() carry their orbit params; anything else falls back to a plain
// vector lerp.
function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const target = lerpVec(a.target, b.target, t)
  const fovY = lerp(a.fovY, b.fovY, t)
  if (a.orbit && b.orbit) {
    return orbit(
      target,
      {
        yaw: lerpAngle(a.orbit.yaw, b.orbit.yaw, t),
        pitch: lerp(a.orbit.pitch, b.orbit.pitch, t),
        dist: lerp(a.orbit.dist, b.orbit.dist, t)
      },
      fovY
    )
  }
  return {
    eye: lerpVec(a.eye, b.eye, t),
    target,
    up: lerpVec(a.up, b.up, t),
    fovY
  }
}

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

export interface SectionDirector {
  start(): void
  stop(): void
  /** Recompute anchor positions (after layout/resize). */
  refresh(): void
}

export function createSectionDirector(opts: {
  camera: Camera
  renderer: Renderer
  /** Rebuilds poses for the current viewport (poses depend on aspect). */
  buildBeats: () => Beat[]
  reduceMotion: boolean
  /** Fired when the dominant (nearest) beat changes. */
  onActiveBeat?: (id: BeatId) => void
}): SectionDirector {
  const { camera, renderer, buildBeats, reduceMotion, onActiveBeat } = opts

  let anchored: AnchoredBeat[] = []
  let activeBeat: BeatId | null = null

  function setActive(id: BeatId): void {
    if (id === activeBeat) return
    activeBeat = id
    onActiveBeat?.(id)
  }

  function rebuild(): void {
    anchored = buildBeats()
      .map((b) => {
        const el = document.querySelector<HTMLElement>(b.selector)
        return el ? { ...b, el } : null
      })
      .filter((b): b is AnchoredBeat => b !== null)
  }

  let running = false
  let ticking = false

  // The "anchor line" is the viewport centre. Each beat's progress point is the
  // scroll position at which its section centre crosses the viewport centre.
  function beatAnchorY(el: HTMLElement): number {
    const rect = el.getBoundingClientRect()
    const centreInDoc = rect.top + window.scrollY + rect.height / 2
    return centreInDoc - window.innerHeight / 2
  }

  function evaluate(): void {
    if (anchored.length === 0) return
    const y = window.scrollY

    // Anchor scroll positions, ascending by document order.
    const anchors = anchored.map(b => beatAnchorY(b.el))

    // Clamp before first / after last.
    if (y <= anchors[0]!) {
      setActive(anchored[0]!.id)
      apply(anchored[0]!.pose, anchored[0]!.highlight)
      return
    }
    const last = anchored.length - 1
    if (y >= anchors[last]!) {
      setActive(anchored[last]!.id)
      apply(anchored[last]!.pose, anchored[last]!.highlight)
      return
    }

    // Find the pair [i, i+1] bracketing y and the eased fraction between them.
    for (let i = 0; i < last; i++) {
      const a0 = anchors[i]!
      const a1 = anchors[i + 1]!
      if (y >= a0 && y <= a1) {
        const raw = (y - a0) / Math.max(a1 - a0, 1)
        const t = smoothstep(raw)
        setActive((t < 0.5 ? anchored[i]! : anchored[i + 1]!).id)
        if (reduceMotion) {
          // Snap to whichever beat is closer.
          const near = t < 0.5 ? anchored[i]! : anchored[i + 1]!
          apply(near.pose, near.highlight)
        } else {
          const pose = lerpPose(anchored[i]!.pose, anchored[i + 1]!.pose, t)
          const hl = lerp(anchored[i]!.highlight, anchored[i + 1]!.highlight, t)
          apply(pose, hl)
        }
        return
      }
    }
  }

  function apply(pose: Pose, highlight: number): void {
    if (reduceMotion) camera.snap(pose)
    else camera.setTarget(pose)
    renderer.setHighlightMix(highlight)
    document.documentElement.setAttribute('data-active-beat-hl', highlight > 0.5 ? '1' : '0')
  }

  function onScroll(): void {
    if (ticking) return
    ticking = true
    requestAnimationFrame(() => {
      ticking = false
      evaluate()
    })
  }

  function start(): void {
    if (running) return
    running = true
    rebuild()
    window.addEventListener('scroll', onScroll, { passive: true })
    evaluate()
  }

  function stop(): void {
    running = false
    window.removeEventListener('scroll', onScroll)
  }

  function refresh(): void {
    rebuild()
    evaluate()
  }

  return { start, stop, refresh }
}
