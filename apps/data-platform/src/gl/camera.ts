// Perspective camera with a damped ease toward a target pose. The renderer owns
// the single per-frame view-projection matrix; overlays project through the
// SAME matrix (via project()) so DOM labels never drift from their GL dots.
import * as twgl from 'twgl.js'

const { m4 } = twgl

export type Vec3Tuple = [number, number, number]

export interface Pose {
  eye: Vec3Tuple
  target: Vec3Tuple
  up: Vec3Tuple
  fovY: number // radians
}

export interface ProjectResult {
  x: number // CSS px
  y: number // CSS px
  depth: number // clip-space z (>1 or <-1 => outside frustum)
  visible: boolean // in front of camera and within viewport-ish
}

// Exponential smoothing time constant. Higher = slower, more cinematic.
const DEFAULT_TAU_MS = 180

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export interface Camera {
  setTarget(pose: Pose): void
  snap(pose: Pose): void
  update(dtMs: number): void
  /** Rebuilds and returns the current view-projection matrix for `aspect`. */
  viewProj(aspect: number): Float32Array
  /** Projects a world point to CSS pixels using the last viewProj. */
  project(world: Vec3Tuple, viewportW: number, viewportH: number): ProjectResult
  readonly pose: Pose
}

export function createCamera(initial: Pose, tauMs: number = DEFAULT_TAU_MS): Camera {
  const live: Pose = {
    eye: [...initial.eye] as Vec3Tuple,
    target: [...initial.target] as Vec3Tuple,
    up: [...initial.up] as Vec3Tuple,
    fovY: initial.fovY
  }
  let goal: Pose = clonePose(initial)
  let lastViewProj = m4.identity() as Float32Array

  function clonePose(p: Pose): Pose {
    return {
      eye: [...p.eye] as Vec3Tuple,
      target: [...p.target] as Vec3Tuple,
      up: [...p.up] as Vec3Tuple,
      fovY: p.fovY
    }
  }

  function setTarget(pose: Pose): void {
    goal = clonePose(pose)
  }

  function snap(pose: Pose): void {
    goal = clonePose(pose)
    live.eye = [...pose.eye] as Vec3Tuple
    live.target = [...pose.target] as Vec3Tuple
    live.up = [...pose.up] as Vec3Tuple
    live.fovY = pose.fovY
  }

  function update(dtMs: number): void {
    // Frame-rate independent exponential approach: t = 1 - e^(-dt/tau).
    const t = 1 - Math.exp(-dtMs / tauMs)
    for (let i = 0; i < 3; i++) {
      live.eye[i] = lerp(live.eye[i]!, goal.eye[i]!, t)
      live.target[i] = lerp(live.target[i]!, goal.target[i]!, t)
      live.up[i] = lerp(live.up[i]!, goal.up[i]!, t)
    }
    live.fovY = lerp(live.fovY, goal.fovY, t)
  }

  function viewProj(aspect: number): Float32Array {
    const proj = m4.perspective(live.fovY, aspect, 0.1, 500)
    // m4.lookAt returns a camera (world) matrix; invert for the view matrix.
    const camWorld = m4.lookAt(live.eye, live.target, live.up)
    const view = m4.inverse(camWorld)
    lastViewProj = m4.multiply(proj, view) as Float32Array
    return lastViewProj
  }

  function project(world: Vec3Tuple, viewportW: number, viewportH: number): ProjectResult {
    // clip = viewProj * [x,y,z,1]
    const m = lastViewProj
    const x = world[0]
    const y = world[1]
    const z = world[2]
    const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
    const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
    const cz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
    const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!
    if (cw <= 0) {
      // Behind the camera.
      return { x: 0, y: 0, depth: Infinity, visible: false }
    }
    const ndcX = cx / cw
    const ndcY = cy / cw
    const ndcZ = cz / cw
    const px = (ndcX * 0.5 + 0.5) * viewportW
    const py = (1 - (ndcY * 0.5 + 0.5)) * viewportH
    const visible = ndcX >= -1.2 && ndcX <= 1.2 && ndcY >= -1.2 && ndcY <= 1.2 && ndcZ <= 1
    return { x: px, y: py, depth: ndcZ, visible }
  }

  return {
    setTarget,
    snap,
    update,
    viewProj,
    project,
    get pose() {
      return live
    }
  }
}

// Build a pose that frames a world-space box (centered at `center`, half-extent
// hx/hz on the ground plane) at pitch `pitchDeg` above the plane. 90° = straight
// top-down (the OG flat schematic look); lower values tilt to a bird's-eye.
// `fovY` in radians; `fit` pads the framing (1 = tight).
export function framingPose(
  center: Vec3Tuple,
  hx: number,
  hz: number,
  pitchDeg: number,
  fovY: number,
  aspect: number,
  fit = 1.15
): Pose {
  // Distance so the larger of the horizontal/vertical extents fits the frustum.
  const halfV = Math.max(hz, hx / aspect) * fit
  const dist = halfV / Math.tan(fovY / 2)
  const pitch = (pitchDeg * Math.PI) / 180
  // Camera sits back along +Z and up along +Y by the pitch angle, looking at center.
  const eye: Vec3Tuple = [
    center[0],
    center[1] + Math.sin(pitch) * dist,
    center[2] + Math.cos(pitch) * dist
  ]
  // Near-vertical (top-down) looks straight down -Y, where up=[0,1,0] is parallel
  // to the view direction and lookAt degenerates. Use world -Z as screen-up there
  // (north points up), and interpolate the up vector across the transition so the
  // camera doesn't snap-roll as a beat eases from top-down to tilted.
  const flatBlend = smoothstepEdge(pitchDeg, 78, 89) // 0 below 78°, 1 by 89°
  const up: Vec3Tuple = [
    0,
    1 - flatBlend, // +Y fades out as we approach top-down
    -flatBlend //     -Z fades in
  ]
  return { eye, target: [...center] as Vec3Tuple, up, fovY }
}

function smoothstepEdge(x: number, e0: number, e1: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
