// One step of a phased in/hold/out animation driven by the map's rAF loop.
//
// Extracted for the same reason map-surface-inset.ts was: the loop itself is
// unreachable from a node-only suite, and the rule it encodes is one the loop
// got wrong twice in the same way.
//
// The trap: the loop parks as soon as every animation reports `hold`, and it
// only draws on frames flagged dirty. So the frame that FINISHES an entrance
// has to be flagged as well as the frames easing toward it — it is the frame
// that seats the final value. Flagging only while `progress < 1` parks the loop
// one frame early and leaves the second-to-last frame on screen until an
// unrelated event redraws the map. That is what left a line the rider had
// switched away from lingering until they touched the map.

export type TickPhase = 'in' | 'hold' | 'out'

export interface PhaseStep {
  /** Eased 0..1 for `in`, falling 1..0 for `out`, 1 while holding. */
  progress: number
  /** The phase after this step: an entrance that reached 1 becomes `hold`. */
  phase: TickPhase
  /** Whether this frame must be drawn. */
  dirty: boolean
  /** Whether the animation is finished and its state can be dropped. */
  done: boolean
}

/** easeOutCubic, the curve every fade on the map shares. */
export function easeOut(p: number): number {
  return 1 - Math.pow(1 - p, 3)
}

/**
 * Advance one phase by `elapsed` ms.
 *
 * `dirty` is true for every frame of a running phase INCLUDING the one that
 * completes it, and false only once a phase is genuinely at rest. `hold` is at
 * rest — a held selection over an idle map should let the loop park.
 */
export function phaseStep(phase: TickPhase, elapsed: number, durationMs: number): PhaseStep {
  if (phase === 'hold') {
    return { progress: 1, phase: 'hold', dirty: false, done: false }
  }
  const p = durationMs > 0 ? Math.min(1, elapsed / durationMs) : 1
  if (phase === 'in') {
    return { progress: easeOut(p), phase: p >= 1 ? 'hold' : 'in', dirty: true, done: false }
  }
  return { progress: 1 - p, phase: 'out', dirty: true, done: p >= 1 }
}
