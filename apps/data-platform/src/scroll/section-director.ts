// Maps scroll position to a continuous camera pose + highlight target. Beats are
// anchored to page sections; as the user scrolls, we find which two beats the
// viewport centre sits between and interpolate their poses, so transitions are
// continuous rather than snapping at section edges. The camera's own damping
// smooths residual jitter. Reduced-motion snaps to the nearest beat instead.
import { lerpAngle, orbit, type Camera, type Pose, type Vec3Tuple } from '../gl/camera'
import type { Renderer } from '../gl/renderer'
import type { HighlightId } from '../scene/network-scene'
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
  /** Fired when a cycling beat steps to a new subject (see `highlightCycle`). */
  onHighlightSet?: (id: HighlightId) => void
}): SectionDirector {
  const { camera, renderer, buildBeats, reduceMotion, onActiveBeat, onHighlightSet } = opts

  let anchored: AnchoredBeat[] = []
  let activeBeat: BeatId | null = null

  function setActive(id: BeatId): void {
    if (id === activeBeat) return
    activeBeat = id
    onActiveBeat?.(id)
  }

  // A cycling beat swaps subject as the reader moves across it. `t` is the eased
  // fraction toward the NEXT beat, so it runs 0..1 across the second half of the
  // approach and the first half of the departure; spend the middle band cycling
  // and leave the tails alone, where a swap would fight the emphasis dip.
  //
  // The lead-in is deliberately long. cakupan follows rute, a tilted bird's-eye
  // beat, and the camera is still unwinding that pitch well into the approach —
  // at a 0.15 lead-in the first operator lit while the map was visibly still
  // rotating out of the previous shot, so the highlight looked like it belonged
  // to rute. 0.34 holds the field dark until the camera has actually arrived,
  // then fits the whole cycle into the remaining band.
  const CYCLE_LEAD_IN = 0.34
  const CYCLE_TAIL = 0.08

  function cycledSet(beat: AnchoredBeat, t: number): HighlightId {
    const cycle = beat.highlightCycle
    if (!cycle || cycle.length === 0) return beat.highlightSet
    const span = 1 - CYCLE_LEAD_IN - CYCLE_TAIL
    const eased = Math.min(1, Math.max(0, (t - CYCLE_LEAD_IN) / span))
    const i = Math.min(cycle.length - 1, Math.floor(eased * cycle.length))
    return cycle[i]!
  }

  function onCycleStep(id: HighlightId): void {
    if (id === lastCycleStep) return
    lastCycleStep = id
    onHighlightSet?.(id)
  }

  let lastCycleStep: HighlightId | null = null

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

  /**
   * The beats that are actually on the page right now, paired with their anchors
   * and guaranteed to ascend — the invariant every branch below depends on.
   *
   * The "anchor line" is the viewport centre: a beat's anchor is the scroll
   * position at which its section centre crosses it.
   *
   * A beat can be declared but not rendered: `jpm-dka` is `hidden md:block`,
   * because the SUD -> DKA sweep is a desktop affordance. A `display:none`
   * element has an all-zero rect, so beatAnchorY() returns -innerHeight/2 — a
   * NEGATIVE anchor sitting mid-list. That silently broke the bracketing scan on
   * mobile: past the jpm anchor it matched `jpm-dka -> stasiun` (a0 = -422)
   * instead of `jpm -> stasiun`, landing straight in that pair's departing ramp,
   * so the structure folded flat the moment the reader scrolled past the copy.
   *
   * Filtered here rather than in rebuild() on purpose: rebuild() only runs on
   * start() and refresh() (resize), but applyBand() toggles `data-map-band` on
   * every beat change, which relayouts without a resize. evaluate() already
   * measures every beat each frame, so the rect it needs is in hand.
   *
   * The rect is the render test, not offsetParent, which also reports null for
   * position:fixed elements. The monotonic guard is belt-and-braces: it makes
   * "anchors ascend" explicit, so any future ordering surprise degrades to a
   * skipped beat instead of a wrong one.
   */
  function liveBeats(): { beat: AnchoredBeat, anchor: number }[] {
    const out: { beat: AnchoredBeat, anchor: number }[] = []
    for (const beat of anchored) {
      const rect = beat.el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      const anchor = rect.top + window.scrollY + rect.height / 2 - window.innerHeight / 2
      const prev = out[out.length - 1]
      if (prev && anchor <= prev.anchor) continue
      out.push({ beat, anchor })
    }

    // The last beat's anchor can sit at or past the furthest the page can
    // actually scroll. The footer is the standing case: it is the final section
    // and one viewport tall, so its CENTRE lands exactly at maxScroll and the
    // transition into it can only reach t=1 on the document's very last pixel —
    // the wordmark reveal never finishes. Page geometry cannot fix this from the
    // other side either: adding height to any earlier section pushes the footer
    // down with it (measured — headroom stayed 0), and trailing space after it
    // leaves bare ink below the mark, because the map is viewport-fixed and has
    // nothing left to draw there.
    //
    // So pull the tail anchors back into reach instead. The last one is seated a
    // short way ABOVE maxScroll, not exactly on it, so the transition completes
    // while the reader is still scrolling rather than on the final pixel; any
    // earlier beats that would then collide are stepped back to keep the list
    // strictly ascending.
    const maxScroll = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight
    )
    // Enough travel for the incoming beat to resolve, capped so a short page
    // cannot push the seat above the beat before it.
    const TAIL_INSET = Math.min(200, Math.round(window.innerHeight * 0.25))
    for (let i = out.length - 1; i >= 0; i--) {
      const seat = maxScroll - TAIL_INSET - (out.length - 1 - i)
      if (out[i]!.anchor <= seat) break
      const floor = i > 0 ? out[i - 1]!.anchor + 1 : 0
      out[i]!.anchor = Math.max(floor, seat)
    }
    return out
  }

  function evaluate(): void {
    if (anchored.length === 0) return
    const y = window.scrollY

    // Rendered beats only, anchors ascending — see liveBeats().
    const live = liveBeats()
    if (live.length === 0) return
    const anchors = live.map(e => e.anchor)
    const beats = live.map(e => e.beat)

    // Clamp before first / after last.
    if (y <= anchors[0]!) {
      setActive(beats[0]!.id)
      apply(beats[0]!.pose, beats[0]!.highlight, beats[0]!.highlightSet, beats[0]!.logo, beats[0]!.jpm)
      return
    }
    const last = beats.length - 1
    if (y >= anchors[last]!) {
      setActive(beats[last]!.id)
      apply(beats[last]!.pose, beats[last]!.highlight, beats[last]!.highlightSet, beats[last]!.logo, beats[last]!.jpm)
      return
    }

    // Find the pair [i, i+1] bracketing y and the eased fraction between them.
    for (let i = 0; i < last; i++) {
      const a0 = anchors[i]!
      const a1 = anchors[i + 1]!
      if (y >= a0 && y <= a1) {
        const raw = (y - a0) / Math.max(a1 - a0, 1)
        const t = smoothstep(raw)
        const from = beats[i]!
        const to = beats[i + 1]!
        const near = t < 0.5 ? from : to
        setActive(near.id)
        if (reduceMotion) {
          // Snap to whichever beat is closer. The morph snaps with it: there is
          // no scroll fraction here to scrub, so the structure must resolve to
          // a definite state (solid on the beat, flat off it), never freeze
          // mid-unfold.
          apply(near.pose, near.highlight, near.highlightSet, near.logo, near.jpm)
        } else {
          const pose = lerpPose(from.pose, to.pose, t)
          // Between beats that spotlight DIFFERENT subjects, dip the emphasis to
          // zero at the midpoint and swap the set there. Crossfading instead
          // would teleport the highlight from one subject to the other, because
          // a single mix drives whichever set is currently uploaded.
          // A cycling beat picks its subject from scroll position rather than
          // holding one. `near` only becomes the cycling beat once t crosses 0.5
          // (approaching) and stays it until t crosses 0.5 again (departing), so
          // the beat "owns" the second half of one span and the first half of the
          // next. Re-map those two half-spans onto a single 0..1 pass, or the
          // first operators would flash past before the reader has arrived.
          const nearSet = near.highlightCycle
            ? cycledSet(near, near === to ? (t - 0.5) : (t + 0.5))
            : near.highlightSet
          if (near.highlightCycle) onCycleStep(nearSet)

          const swapping = from.highlightSet !== to.highlightSet
          const hl = swapping
            ? lerp(from.highlight, to.highlight, t) * Math.abs(t - 0.5) * 2
            : lerp(from.highlight, to.highlight, t)
          // The wordmark reveal is deliberately NOT a straight lerp. Lerping it
          // starts lighting the letters the instant you leave the previous beat,
          // so the logo is already half-visible while that beat is still the one
          // being read. Hold it dark for the first 60% of the approach, then ramp
          // over the last 40%, so it belongs to the footer it introduces.
          const logoT = from.logo === to.logo
            ? t
            : Math.max(0, (t - 0.6) / 0.4)
          // The JPM unfold is scroll-driven, in its own phase on each side of
          // the beat. Approaching: hold flat for the first 60% so the structure
          // doesn't start rising while the camera is still flying in from
          // tarif's near-top-down pose (same reasoning as the wordmark hold and
          // cakupan's CYCLE_LEAD_IN). Departing: fold over the first 40%, done
          // BEFORE the midpoint hands the highlight to the next beat. Both ends
          // are continuous — morph is exactly 1 at the jpm anchor from either
          // side and exactly 0 at its neighbours' anchors — so scrubbing
          // backwards reverses the unfold with no pop at the handoff.
          //
          // One shared lead-in, no mobile branch. A 0.25 mobile value lived here
          // briefly; it was tuning around the unrendered-beat bug that liveBeats()
          // now fixes, where the morph was pinned near 0 for the whole mobile beat
          // regardless of this constant.
          const jpmT = from.jpm === to.jpm
            ? from.jpm
            : to.jpm > from.jpm
              ? Math.max(0, (t - 0.6) / 0.4)
              : Math.max(0, 1 - t / 0.4)
          apply(pose, hl, nearSet, lerp(from.logo, to.logo, logoT), jpmT)
        }
        return
      }
    }
  }

  function apply(
    pose: Pose,
    highlight: number,
    highlightSet: HighlightId,
    logo: number,
    jpm: number
  ): void {
    if (reduceMotion) camera.snap(pose)
    else camera.setTarget(pose)
    // Cheap when unchanged; only re-uploads on an actual subject change.
    renderer.setHighlightSet(highlightSet)
    renderer.setHighlightMix(highlight)
    renderer.setLogoMix(logo)
    renderer.setJpmMorph(jpm)
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
