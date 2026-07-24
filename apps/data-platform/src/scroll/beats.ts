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

  // Hero: whole-network, straight top-down — the OG flat schematic look. The
  // tilt is reserved for the topology beat, where it reads as a deliberate reveal.
  const hero = framingPose(
    [scene.bounds.center.x, 0, scene.bounds.center.z],
    hx,
    hz,
    90, // top-down
    38 * DEG,
    aspect,
    1.35
  )

  // Topology: tilt to ~45° bird's-eye and frame the highlighted Cikarang chain —
  // the one beat that leaves the flat plane.
  const chainCenter = centroid(scene, HIGHLIGHT_CHAIN)
  const mrt = scene.stationWorld.get('KCI-MTR')!
  const sudb = scene.stationWorld.get('KCI-SUDB')!
  const chainSpan = Math.hypot(mrt.x - sudb.x, mrt.z - sudb.z)
  const topologi = framingPose(
    [chainCenter.x, 0, chainCenter.z],
    chainSpan / 2,
    chainSpan / 2,
    46, // ~45° bird's-eye tilt
    40 * DEG,
    aspect,
    1.9 // pull back so surrounding context stays visible
  )

  // Schedule: Manggarai close-up, still top-down (Phase 3 adds the departures
  // flyout here).
  const mri = scene.stationWorld.get('KCI-MRI')!
  const jadwal = framingPose([mri.x, 0, mri.z], 10, 10, 90, 42 * DEG, aspect, 1.6)

  // API + footer: ease back out to the top-down establishing shot.
  const api = framingPose(
    [scene.bounds.center.x, 0, scene.bounds.center.z],
    hx,
    hz,
    90, // top-down
    38 * DEG,
    aspect,
    1.5
  )

  return [
    { id: 'hero', selector: '[data-beat=\'hero\']', pose: hero, highlight: 0 },
    { id: 'jadwal', selector: '[data-beat=\'jadwal\']', pose: jadwal, highlight: 0 },
    { id: 'topologi', selector: '[data-beat=\'topologi\']', pose: topologi, highlight: 1 },
    { id: 'api', selector: '[data-beat=\'api\']', pose: api, highlight: 0 },
    { id: 'footer', selector: '[data-beat=\'footer\']', pose: api, highlight: 0 }
  ]
}
