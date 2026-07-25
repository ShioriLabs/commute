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
  = 'hero' | 'jadwal' | 'topologi' | 'tarif' | 'stasiun' | 'rute' | 'api'
    | 'cakupan' | 'footer'

export interface Beat {
  id: BeatId
  /** Element the beat is anchored to (drives IntersectionObserver + progress). */
  selector: string
  pose: Pose
  /** Emphasis strength at this beat (0 = none, 1 = full). */
  highlight: number
  /** WHICH subject the emphasis applies to. */
  highlightSet: HighlightId
  /**
   * Subjects to step through WITHIN this beat, in order, as the reader scrolls
   * across it. When set, it supersedes `highlightSet` while the beat is being
   * traversed. Every other beat spotlights one fixed subject, so this stays
   * undefined for them and the single-set path is unchanged.
   */
  highlightCycle?: readonly HighlightId[]
  /** Wordmark reveal in the dot field (0 = dark, 1 = lit). */
  logo: number
}

const DEG = Math.PI / 180

/** The IMAX-ish band the map is rendered into on mobile. See MapLayout. */
export const BAND_ASPECT = 1.43

/**
 * How the map is framed for a given beat.
 *
 * Two separate facts, which used to be one. `aspect` and `frameH` describe the
 * CANVAS; `copyBeside` describes the PAGE. They coincided while the canvas was
 * always the full viewport — landscape implied a two-column layout — but the
 * mobile band makes the canvas landscape while the copy sits BELOW it, so
 * inferring one from the other sends every beat's plate-dodging shift the wrong
 * way (the map swerves around a plate that is no longer beside it).
 */
export interface MapLayout {
  /** Canvas width / height. */
  aspect: number
  /** Canvas width in CSS px — how much room a plate-dodging shift has to play with. */
  frameW: number
  /** Canvas height in CSS px — what actually starves a short band. */
  frameH: number
  /** True when the copy sits in a column beside the map (the md: two-column grid). */
  copyBeside: boolean
}

/** Full-viewport framing: the desktop background, and mobile's hero + footer. */
export function viewportLayout(w: number, h: number): MapLayout {
  return {
    aspect: w / Math.max(h, 1),
    frameW: w,
    frameH: h,
    // The beats' two-column grid is the md: breakpoint (768px), and the poses'
    // shifts exist to dodge that second column.
    copyBeside: w >= 768
  }
}

/** The mobile band: landscape canvas, copy stacked underneath it. */
export function bandLayout(w: number): MapLayout {
  return { aspect: BAND_ASPECT, frameW: w, frameH: w / BAND_ASPECT, copyBeside: false }
}

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

/**
 * @param full  Framing for the beats that own the whole viewport (hero, footer).
 * @param band  Framing for the content beats. On mobile this is the IMAX band;
 *              on desktop callers pass `full` again and nothing changes.
 */
export function buildBeats(scene: NetworkScene, full: MapLayout, band: MapLayout = full): Beat[] {
  const hx = (scene.bounds.max.x - scene.bounds.min.x) / 2
  const hz = (scene.bounds.max.z - scene.bounds.min.z) / 2

  // framingPose fits the larger of hz and hx/aspect, so `fit` scales camera
  // distance linearly. Two things can starve the frame and the pad has to answer
  // whichever is worse:
  //
  //  - a NARROW frame, where the hx/aspect term dominates and pushes the camera
  //    back until the network reads as empty space (the portrait viewport), and
  //  - a SHORT frame, where there simply aren't many pixels of height to fill
  //    (the 273px mobile band, whose aspect is a comfortable 1.43 but which is a
  //    third the height of a desktop window).
  //
  // Keying on aspect alone gets the band exactly backwards: it reads 1.43 as
  // roomy, relaxes the pad to 0.85 and pulls the camera further back, which is
  // how the whole-network beats ended up as a faint smudge. Letting the wide
  // network crop is the right trade either way — dots on screen beat a complete
  // but invisible map.
  // The height floor is 0.62, not the aspect term's 0.36. `fit` multiplies a pad
  // that is already 1.0-tight, so the two terms are not interchangeable: at 0.34
  // topologi framed at fit 0.46 and cropped its own chain down to the middle two
  // stations. 0.62 puts the band's close-ups at ~0.84 — pulled in enough that the
  // dots read at a third of the screen height, loose enough to keep the whole
  // subject. Desktop still resolves to 1.00 on both terms and is unaffected.
  // The aspect term's floor scales with WIDTH. 0.36 was tuned for a 390px phone,
  // where cropping the network is the right trade; a portrait tablet shares that
  // sub-1 aspect but is twice as wide, and holding it to the phone's floor pulled
  // the camera in so hard that topologi cropped its own chain down to the middle
  // two stations at 834x1112. Interpolating the floor 0.36..0.75 across 390..1024
  // keeps the phone framing identical and lets a wide portrait frame breathe.
  const aspectFloor = (w: number): number =>
    Math.min(0.75, Math.max(0.36, 0.36 + ((w - 390) / 634) * 0.39))
  const narrowFor = (l: MapLayout): number => Math.min(
    // 1 at >=16:10; floor is width-dependent (see above).
    Math.min(1, Math.max(aspectFloor(l.frameW), (l.aspect - 0.45) / 1.15)),
    // 1 at >=760px tall, 0.62 at the 273px band.
    Math.min(1, Math.max(0.62, (l.frameH - 140) / 620))
  )
  const narrow = narrowFor(band)
  const narrowFull = narrowFor(full)

  // Whether a plate sits BESIDE the map, which is the only reason any pose is
  // shifted off-centre. Not derived from aspect: see MapLayout.
  const twoColumn = band.copyBeside
  const twoColumnFull = full.copyBeside

  // How much of a beat's plate-dodging shift to actually apply.
  //
  // Those shifts push a subject into the open column so the copy plate can't
  // cover it, and they were all tuned on a wide window. Held flat they overshoot
  // as soon as the two-column layout gets narrow — the subject clears the plate
  // and keeps going, straight off the opposite edge. At 834px this pushed the
  // rute beat's Cikoko interchange to x=916 (82px past the frame, so the journey
  // strip's leader line pointed at a roundel that wasn't there) and drove two of
  // the four topologi chain stations to negative x, where the map simply stopped
  // drawing their labels.
  //
  // Easing the shift in across 768..1200 keeps the wide framing these were
  // tuned against while letting a narrow two-column layout shift only as far as
  // it can afford. The 0.25 floor is set by the tightest case (rute at 768).
  const shiftScale = Math.min(1, Math.max(0.25, (band.frameW - 768) / 432))

  // Hero: whole-network, straight top-down — the OG flat schematic look. The
  // tilt is reserved for the topology beat, where it reads as a deliberate reveal.
  // Copy sits in the left half on desktop, so push the network right of centre.
  // Top-down and unyawed, so moving the target -X moves the subject +X on screen.
  // Hero keeps the FULL viewport on every device — it is the establishing shot,
  // and the band would letterbox the one beat that has no overlay to bound.
  const heroShift = twoColumnFull ? hx * 0.34 : 0
  const hero = framingPose(
    [scene.bounds.center.x - heroShift, 0, scene.bounds.center.z],
    hx,
    hz,
    90, // top-down
    38 * DEG,
    full.aspect,
    1.35 * narrowFull
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
  // Scaled by available width — see shiftScale. Unscaled, this drove Sudirman
  // Baru and Sudirman off the left edge on a tablet.
  const topoShift = twoColumn ? chainSpan * 0.3 * shiftScale : 0
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
    band.aspect,
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
    band.aspect,
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
  // the camera's own right vector (yaw makes screen-right != +X). At 0.22 the
  // corridor's lower half still ran under the plate — it's a diagonal, so the end
  // nearest the copy column reaches furthest left.
  const tarifShift = twoColumn ? Math.hypot(dx, dz) * 0.34 : 0
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
    // Pad the framed box so the corridor's ends don't sit flush against the
    // frame edge: it ran off the bottom of the viewport past Blok M at a tight
    // fit, because a yawed diagonal uses more screen height than its hz suggests.
    tarifHx * 1.15,
    tarifHz * 1.15,
    72,
    40 * DEG,
    band.aspect,
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
    band.aspect,
    1.6 * narrow
  )

  // Rute: the router's own answer for Pancoran -> Pasar Minggu. The route is an L
  // — the LRT runs due east, the KRL due south — so unyawed it sits perfectly
  // axis-aligned and reads as stiff next to the rest of the page.
  //
  // Yawed, both legs become screen diagonals meeting at a corner instead of a
  // right angle squared to the frame.
  //
  // +45 rather than -45, and the sign is decided by where the route ENDS, not by
  // the bounding box. -45 gives the nicer ratio on paper (13.4x8.5 landscape vs
  // 8.5x13.4 portrait) but sends the KRL leg down-and-RIGHT, terminating at screen
  // +6.7 — straight through the copy plate. At +45 the route runs top-right to
  // down-LEFT and ends at screen -1.8, staying in the open half the whole way. A
  // subject that fits the frame but lands under the copy is not framed.
  //
  // Tilted to a bird's-eye rather than left flat, so the journey reads as a path
  // ACROSS a plane instead of a diagram drawn on one — this is the beat about
  // travelling, and it earns its own register.
  //
  // 58 is chosen, not tuned by eye. It must sit BELOW 78: orbit() blends the up
  // vector across 78-89, and a yawed pose inside that band rolls the horizon on
  // entry (the reason tarif sits at 72). It should also stay clear of topologi's
  // 46, which owns the steep-tilt look. 58 splits tarif's near-flat 72 and that
  // 46, so the three tilted beats stay distinguishable from each other.
  const RUTE_PITCH = 58
  const RUTE_YAW = 45
  const ruteYawRad = RUTE_YAW * DEG
  const ruteIds = ['LRTJBDB-PAN', 'LRTJBDB-CKK', 'KCI-CW', 'KCI-DRN', 'KCI-PSMB', 'KCI-PSM']
  const rutePts = ruteIds.map(id => scene.stationWorld.get(id)!).filter(Boolean)
  const ruteCx = (Math.min(...rutePts.map(p => p.x)) + Math.max(...rutePts.map(p => p.x))) / 2
  const ruteCz = (Math.min(...rutePts.map(p => p.z)) + Math.max(...rutePts.map(p => p.z))) / 2
  // Measure in the CAMERA's frame, not world XZ: yawed, the subject's screen
  // width and height are its extent projected onto the camera's right and
  // forward axes. Feeding raw world extents would frame a box the shape of the
  // unrotated L and crop the rotated one (same reasoning as tarif above).
  const ruteScreen = rutePts.map(p => ({
    sx: (p.x - ruteCx) * Math.cos(ruteYawRad) - (p.z - ruteCz) * Math.sin(ruteYawRad),
    sy: (p.x - ruteCx) * Math.sin(ruteYawRad) + (p.z - ruteCz) * Math.cos(ruteYawRad)
  }))
  const ruteHx = (Math.max(...ruteScreen.map(p => p.sx)) - Math.min(...ruteScreen.map(p => p.sx))) / 2
  // Tilting foreshortens the camera's forward axis: at pitch P the ground-plane
  // depth a subject occupies on screen is its true depth * sin(P). Framing the
  // untouched depth would reserve room the tilted view no longer needs and push
  // the camera back, shrinking the whole route. (Top-down beats skip this because
  // sin(90) = 1.)
  const ruteDepth = (Math.max(...ruteScreen.map(p => p.sy)) - Math.min(...ruteScreen.map(p => p.sy))) / 2
  const ruteHz = ruteDepth * Math.sin(RUTE_PITCH * DEG)
  // Copy sits in the LEFT column, so the subject belongs in the open RIGHT half.
  // Yawed, screen-right is no longer world +X: shift along the camera's own right
  // vector [cos(yaw), 0, -sin(yaw)], the same way topologi and tarif do —
  // NEGATED here, because moving the target left moves the subject right.
  // Large because tilting compresses the subject toward the horizon, so a given
  // world-space shift buys less screen movement than it does top-down.
  // Clears the copy plate on the left. It cannot also be used to dodge the
  // journey strip: the shift runs along the camera's yawed right vector, so the
  // route slides along its OWN diagonal and the corner stays under the strip no
  // matter how this is tuned. The strip moves instead (see route-strip.ts).
  // Scaled by available width — see shiftScale. This is the tightest case: at a
  // flat 0.62 the Cikoko interchange landed off the right edge on a tablet and
  // the strip's leader line pointed at nothing.
  const ruteShift = twoColumn ? ruteHx * 0.62 * shiftScale : 0
  const rute = framingPose(
    [
      ruteCx - Math.cos(ruteYawRad) * ruteShift,
      0,
      ruteCz + Math.sin(ruteYawRad) * ruteShift
    ],
    ruteHx,
    ruteHz,
    RUTE_PITCH, // bird's-eye, yawed — see the note above
    42 * DEG,
    band.aspect,
    twoColumn ? 1.85 : 1.45,
    RUTE_YAW
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
    band.aspect,
    1.5 * narrow
  )

  // Cakupan: back out to the whole network, one operator lit at a time.
  //
  // Shifted the SAME way as the hero, not mirrored. Mirroring it (copy right,
  // network pushed left) looked symmetrical but the network isn't: MRT Jakarta
  // is a dense north-south run at world x -25..-9, well west of the network
  // centre (-0.5), so pushing everything left drove the whole MRT under the copy
  // plate and cut the line in half. The copy therefore stays in the LEFT column
  // here (see index.html) and the network sits right, exactly as in the hero.
  //
  // Held slightly tighter than the hero so returning here reads as a deliberate
  // second look rather than a rewind to the top of the page.
  const cakupanShift = twoColumn ? hx * 0.34 : 0
  const cakupan = framingPose(
    [scene.bounds.center.x - cakupanShift, 0, scene.bounds.center.z],
    hx,
    hz,
    90, // top-down, same register as the hero
    38 * DEG,
    band.aspect,
    1.22 * narrow // tighter than the hero's 1.35
  )

  // Footer: no longer an establishing shot. The camera drops to the wordmark
  // sitting in the empty field below the network, which pushes the network up
  // and out of frame — the map making room for the page's own name. Framed on
  // the logo's extent so the letters fill the width at any aspect.
  // NOT scaled by `narrow`: like the tarif corridor this subject is wide, and
  // shrinking it on portrait would crop the letters. Portrait instead gets a
  // tighter pad, since framingPose fits hx/aspect there and the default leaves
  // the wordmark marooned in empty field.
  // Also full-viewport, for the same reason as the hero: the wordmark reveal is
  // the page's closing shot and wants every pixel of height it can get. In a
  // 273px band the letters would be unreadable.
  const wm = scene.wordmark
  const footer = framingPose(
    [wm.center.x, 0, wm.center.z],
    wm.halfX,
    wm.halfZ,
    90, // top-down
    38 * DEG,
    full.aspect,
    twoColumnFull ? 1.25 : 1.12
  )

  // Ordered as a geographic sweep so the camera never doubles back: Manggarai ->
  // the Cikarang chain through it -> the MRT corridor west of it -> Rasuna Said
  // in the middle -> south-east down the Pancoran..Pasar Minggu journey -> out to
  // the whole network -> back in to one station's raw JSON -> out to the wordmark.
  //
  // rute follows stasiun because the rasuna run ENDS at Pancoran and the journey
  // STARTS there: the camera hands off between subjects instead of jumping.
  //
  // cakupan sits BEFORE api, not after. Three reasons: it ends the page on the
  // beat that carries the CTA rather than on a roster; it makes the last third a
  // clean out-in-out (whole network -> one station -> wordmark) instead of two
  // consecutive pull-backs; and it stops an unrelated beat from splitting the
  // stasiun/api pair, which exist to show the same station twice.
  //
  // The rasuna set is still interrupted (stasiun -> rute -> ... -> api), so the
  // buffer swap those two were once adjacent to avoid does happen. The director
  // dips emphasis to zero at each midpoint, which reads as the map letting go of
  // the station and picking it back up, not as a glitch.
  return [
    { id: 'hero', selector: '[data-beat=\'hero\']', pose: hero, highlight: 0, highlightSet: 'none', logo: 0 },
    { id: 'jadwal', selector: '[data-beat=\'jadwal\']', pose: jadwal, highlight: 0, highlightSet: 'none', logo: 0 },
    { id: 'topologi', selector: '[data-beat=\'topologi\']', pose: topologi, highlight: 1, highlightSet: 'cikarang', logo: 0 },
    { id: 'tarif', selector: '[data-beat=\'tarif\']', pose: tarif, highlight: 1, highlightSet: 'mrt-lbb-bhi', logo: 0 },
    { id: 'stasiun', selector: '[data-beat=\'stasiun\']', pose: stasiun, highlight: 1, highlightSet: 'rasuna', logo: 0 },
    { id: 'rute', selector: '[data-beat=\'rute\']', pose: rute, highlight: 1, highlightSet: 'rute', logo: 0 },
    {
      id: 'cakupan',
      selector: '[data-beat=\'cakupan\']',
      pose: cakupan,
      highlight: 1,
      highlightSet: 'rail-kci',
      // The one beat whose subject changes as you scroll THROUGH it: each rail
      // operator lights in turn, largest network first. Order matches the roster
      // in overlay/coverage-panel.ts, so the lit lines and the marked row agree.
      highlightCycle: ['rail-kci', 'rail-mrtj', 'rail-lrtj', 'rail-lrtjbdb'],
      logo: 0
    },
    { id: 'api', selector: '[data-beat=\'api\']', pose: api, highlight: 0.45, highlightSet: 'rasuna', logo: 0 },
    { id: 'footer', selector: '[data-beat=\'footer\']', pose: footer, highlight: 0, highlightSet: 'none', logo: 1 }
  ]
}
