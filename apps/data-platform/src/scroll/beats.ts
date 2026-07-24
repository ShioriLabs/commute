// Declarative per-beat configuration for the scroll director. Each beat maps a
// page section to a camera pose (how the persistent map frames itself there) and
// a highlight target (topology emphasis). Poses are built from the live scene so
// they track the real network geometry.
import { framingPose, type Pose } from '../gl/camera'
import {
  HIGHLIGHT_CHAIN,
  MRT_FARE_FROM,
  MRT_FARE_TO,
  type HighlightId,
  type NetworkScene,
  type Vec3
} from '../scene/network-scene'

export type BeatId
  = 'hero' | 'jadwal' | 'topologi' | 'tarif' | 'stasiun' | 'api' | 'footer'

export interface Beat {
  id: BeatId
  /** Element the beat is anchored to (drives IntersectionObserver + progress). */
  selector: string
  pose: Pose
  /** Emphasis strength at this beat (0 = none, 1 = full). */
  highlight: number
  /** WHICH subject the emphasis applies to. */
  highlightSet: HighlightId
  /** Wordmark reveal in the dot field (0 = dark, 1 = lit). */
  logo: number
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

  // Tarif: the priced corridor, Blok M -> Dukuh Atas. It runs SW->NE, so a yaw
  // turns that diagonal into a screen diagonal instead of letting it fight the
  // plate edge. Pitch stays at 72 — BELOW the 78-89 up-vector blend band —
  // because a yawed pose inside that band rolls the horizon on entry (see
  // orbit() in gl/camera.ts).
  const fareFrom = scene.stationWorld.get(MRT_FARE_FROM)!
  const fareTo = scene.stationWorld.get(MRT_FARE_TO)!
  const TARIF_YAW = 20
  const tarifYawRad = TARIF_YAW * DEG
  // Measure the corridor in the CAMERA's frame, not world XZ: yawed, its screen
  // width and height are the projections of the endpoint delta onto the camera's
  // right and forward axes. Feeding the raw span as both half-extents would
  // over-frame the short axis and crop the long one.
  const dx = fareTo.x - fareFrom.x
  const dz = fareTo.z - fareFrom.z
  const tarifHx = Math.abs(dx * Math.cos(tarifYawRad) - dz * Math.sin(tarifYawRad)) / 2
  const tarifHz = Math.abs(dx * Math.sin(tarifYawRad) + dz * Math.cos(tarifYawRad)) / 2
  // Desktop: copy sits left, so push the corridor into the open right half along
  // the camera's own right vector (yaw makes screen-right != +X).
  const tarifShift = twoColumn ? Math.hypot(dx, dz) * 0.22 : 0
  // Mobile: the copy stacks full-width, so there is no open half to move into.
  // Push the subject DOWN-screen instead, out from under the plate. At pitch 72
  // screen-down is roughly the camera's forward axis on the ground plane.
  const tarifDrop = twoColumn ? 0 : Math.hypot(dx, dz) * 0.18
  // NOT scaled by `narrow`. That factor tightens beats whose subject is small
  // relative to the viewport; this subject is a long diagonal that needs the full
  // frame, and shrinking it on portrait pushed both endpoints off-screen.
  const tarif = framingPose(
    [
      (fareFrom.x + fareTo.x) / 2 - Math.cos(tarifYawRad) * tarifShift - Math.sin(tarifYawRad) * tarifDrop,
      0,
      (fareFrom.z + fareTo.z) / 2 + Math.sin(tarifYawRad) * tarifShift - Math.cos(tarifYawRad) * tarifDrop
    ],
    tarifHx,
    tarifHz,
    72,
    40 * DEG,
    aspect,
    twoColumn ? 1.25 : 1.15,
    TARIF_YAW
  )

  // Info stasiun: Rasuna Said close-up — same top-down register as jadwal, so
  // the two station beats read as the same kind of look. Copy sits right here,
  // so bias the station toward the open left half.
  const ras = scene.stationWorld.get('LRTJBDB-RAS')!
  const stasiunShift = twoColumn ? 4 : 0
  const stasiun = framingPose(
    [ras.x + stasiunShift, 0, ras.z],
    9,
    9,
    90,
    42 * DEG,
    aspect,
    1.6 * narrow
  )

  // API: still on Rasuna Said, but pulled back from the stasiun close-up so the
  // beat reads as easing out while keeping the anchor findable — the response
  // panel hangs off that roundel, and framing the whole network here would bury
  // it in the dense core. Copy sits left, so bias the station right.
  // Smaller shift than the other beats: the panel opens to the RIGHT of the
  // roundel, so the roundel needs to sit left of centre to leave it room.
  // Mobile needs no shift: below md: the panel docks into the page rather than
  // anchoring to the roundel, so nothing has to be dodged.
  const apiShift = twoColumn ? 3 : 0
  const api = framingPose(
    [ras.x - apiShift, 0, ras.z],
    24,
    24,
    90, // top-down
    40 * DEG,
    aspect,
    1.5 * narrow
  )

  // Footer: no longer an establishing shot. The camera drops to the wordmark
  // sitting in the empty field below the network, which pushes the network up
  // and out of frame — the map making room for the page's own name. Framed on
  // the logo's extent so the letters fill the width at any aspect.
  // NOT scaled by `narrow`: like the tarif corridor this subject is wide, and
  // shrinking it on portrait would crop the letters. Portrait instead gets a
  // tighter pad, since framingPose fits hx/aspect there and the default leaves
  // the wordmark marooned in empty field.
  const wm = scene.wordmark
  const footer = framingPose(
    [wm.center.x, 0, wm.center.z],
    wm.halfX,
    wm.halfZ,
    90, // top-down
    38 * DEG,
    aspect,
    twoColumn ? 1.25 : 1.12
  )

  // Ordered as a geographic sweep so the camera never doubles back: Manggarai ->
  // the Cikarang chain through it -> the MRT corridor west of it -> Rasuna Said
  // in the middle -> pull back on Rasuna Said -> out to the whole network.
  //
  // stasiun and api share both the subject and the highlight set, so no buffer
  // swap happens between them; the beats differ only in framing and in which
  // overlay is anchored to the roundel (the record, then the raw response).
  return [
    { id: 'hero', selector: '[data-beat=\'hero\']', pose: hero, highlight: 0, highlightSet: 'none', logo: 0 },
    { id: 'jadwal', selector: '[data-beat=\'jadwal\']', pose: jadwal, highlight: 0, highlightSet: 'none', logo: 0 },
    { id: 'topologi', selector: '[data-beat=\'topologi\']', pose: topologi, highlight: 1, highlightSet: 'cikarang', logo: 0 },
    { id: 'tarif', selector: '[data-beat=\'tarif\']', pose: tarif, highlight: 1, highlightSet: 'mrt-lbb-bhi', logo: 0 },
    { id: 'stasiun', selector: '[data-beat=\'stasiun\']', pose: stasiun, highlight: 1, highlightSet: 'rasuna', logo: 0 },
    { id: 'api', selector: '[data-beat=\'api\']', pose: api, highlight: 0.45, highlightSet: 'rasuna', logo: 0 },
    { id: 'footer', selector: '[data-beat=\'footer\']', pose: footer, highlight: 0, highlightSet: 'none', logo: 1 }
  ]
}
