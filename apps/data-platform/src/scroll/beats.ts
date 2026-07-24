// Declarative per-beat configuration for the scroll director. Each beat maps a
// page section to a camera pose (how the persistent map frames itself there) and
// a highlight target (topology emphasis). Poses are built from the live scene so
// they track the real network geometry.
import { framingPose, type Pose } from '../gl/camera'
import { HIGHLIGHT_CHAIN, type NetworkScene, type Vec3 } from '../scene/network-scene'

export type BeatId = 'hero' | 'jadwal' | 'topologi' | 'api' | 'footer'

export interface Beat {
  id: BeatId
  /** Element the beat is anchored to (drives IntersectionObserver + progress). */
  selector: string
  pose: Pose
  /** Topology emphasis target at this beat (0 = none, 1 = full). */
  highlight: number
}

const DEG = Math.PI / 180

function centroid(scene: NetworkScene, ids: readonly string[]): Vec3 {
  let x = 0
  let z = 0
  let n = 0
  for (const id of ids) {
    const w = scene.stationWorld.get(id)
    if (!w) continue
    x += w.x
    z += w.z
    n++
  }
  return n ? { x: x / n, y: 0, z: z / n } : { x: 0, y: 0, z: 0 }
}

export function buildBeats(scene: NetworkScene, aspect: number): Beat[] {
  const hx = (scene.bounds.max.x - scene.bounds.min.x) / 2
  const hz = (scene.bounds.max.z - scene.bounds.min.z) / 2

  // framingPose fits the larger of hz and hx/aspect. On a portrait viewport the
  // width term dominates and pushes the camera far enough back that the network
  // reads as empty space, so tighten the pad as the viewport narrows. Letting the
  // wide network crop on mobile is the right trade: dots on screen beat a
  // complete but invisible map. 1 at >=16:10, ~0.36 at 390x844.
  const narrow = Math.min(1, Math.max(0.36, (aspect - 0.45) / 1.15))

  // The beats' md: breakpoint splits copy and map into two columns. Below it the
  // copy stacks full-width, so the off-centre framing that keeps a plate from
  // covering its subject has nothing to dodge.
  const twoColumn = aspect >= 1

  // Hero: whole-network, straight top-down — the OG flat schematic look. The
  // tilt is reserved for the topology beat, where it reads as a deliberate reveal.
  // Copy sits in the left half on desktop, so push the network right of centre.
  // Top-down and unyawed, so moving the target -X moves the subject +X on screen.
  const heroShift = twoColumn ? hx * 0.34 : 0
  const hero = framingPose(
    [scene.bounds.center.x - heroShift, 0, scene.bounds.center.z],
    hx,
    hz,
    90, // top-down
    38 * DEG,
    aspect,
    1.35 * narrow
  )

  // Topology: tilt to ~45° bird's-eye AND yaw 45° so the octilinear grid runs
  // diagonally — the one beat that leaves the flat plane, and the only framing
  // the top-down beats can't produce. Tighter fit than the establishing shots so
  // the highlighted Cikarang chain fills the frame.
  const chainCenter = centroid(scene, HIGHLIGHT_CHAIN)
  const mrt = scene.stationWorld.get('KCI-MTR')!
  const sudb = scene.stationWorld.get('KCI-SUDB')!
  const chainSpan = Math.hypot(mrt.x - sudb.x, mrt.z - sudb.z)
  // Nudge the framing toward the open half of the layout: the topology copy sits
  // in the right column on desktop, so push the subject left of centre rather
  // than letting the plate bisect the highlighted chain. At yaw 45° screen-left
  // is no longer world -X, so shift along the camera's own right vector
  // (right = [cos(yaw), 0, -sin(yaw)]) to move the subject left on screen.
  const TOPO_YAW = 45
  const yawRad = TOPO_YAW * DEG
  const topoShift = twoColumn ? chainSpan * 0.3 : 0
  const topologi = framingPose(
    [
      chainCenter.x + Math.cos(yawRad) * topoShift,
      0,
      chainCenter.z - Math.sin(yawRad) * topoShift
    ],
    chainSpan / 2,
    chainSpan / 2,
    46, // ~45° bird's-eye tilt
    40 * DEG,
    aspect,
    1.35 * narrow, // tighter crop than the 1.9 establishing framing
    TOPO_YAW // grid on the diagonal
  )

  // Schedule: Manggarai close-up, still top-down (Phase 3 adds the departures
  // flyout here).
  // Copy sits in the left column here, so bias Manggarai toward the open right
  // half. Top-down and unyawed, so screen-right is simply +X. Mobile stacks the
  // copy full-width — there is no open half, so don't shift.
  const mri = scene.stationWorld.get('KCI-MRI')!
  const jadwalShift = twoColumn ? 4 : 0
  const jadwal = framingPose(
    [mri.x - jadwalShift, 0, mri.z],
    10,
    10,
    90,
    42 * DEG,
    aspect,
    1.6 * narrow
  )

  // API + footer: ease back out to the top-down establishing shot.
  const api = framingPose(
    [scene.bounds.center.x, 0, scene.bounds.center.z],
    hx,
    hz,
    90, // top-down
    38 * DEG,
    aspect,
    1.5 * narrow
  )

  return [
    { id: 'hero', selector: '[data-beat=\'hero\']', pose: hero, highlight: 0 },
    { id: 'jadwal', selector: '[data-beat=\'jadwal\']', pose: jadwal, highlight: 0 },
    { id: 'topologi', selector: '[data-beat=\'topologi\']', pose: topologi, highlight: 1 },
    { id: 'api', selector: '[data-beat=\'api\']', pose: api, highlight: 0 },
    { id: 'footer', selector: '[data-beat=\'footer\']', pose: api, highlight: 0 }
  ]
}
