// JPM Dukuh Atas as dots: the geometry for the homepage's gated-transfer beat.
//
// The one rule the flat octilinear map cannot draw is SURCHARGED_CORRIDORS[0]
// (apps/constants/src/index.ts). The JPM itself is a PUBLIC building: from the
// river's south bank you can walk in and reach LRT Jabodebek Dukuh Atas without
// paying anything. What is gated is the CROSSING — from the north bank the only
// way over the river runs through KCI Sudirman's paid area, so that approach
// costs a tap (Rp1 card / Rp3.000 QRIS Tap) even without riding a train. Same
// destination, two prices, decided by which bank you start on. The explanation
// is geometric, so this beat is geometric.
//
// Provenance, because a later reader will be tempted to "fix" this: the free
// south-bank entry is FIELD-VERIFIED (the user has walked it), NOT something
// the operators document. Published sources only ever describe the northern,
// gated approach, so searching will appear to contradict this paragraph. It
// does not — they simply never cover the southern one. Do not rewrite this
// from news articles alone.
//
// The gated side IS documented: KAI Commuter (3 Jan 2026) confirms a dedicated
// "gate akses JPM Dukuh Atas/arah LRT Jabodebek" charging Rp1 on a card. One
// condition we deliberately do NOT model: that Rp1 only holds if the rider
// clears the station within 15 minutes, after which the normal Rp3.000 applies.
// We have no dwell time to evaluate it with, and internalWalkM is 140 m, so the
// discounted fare is right for any normal walk. Revisit alongside the fare-cap
// rework, not on its own.
//
// Every dot carries TWO positions. `flat` is its seat on the octilinear lattice
// — spread along the KCI-SUD -> LRTJBDB-DKA run the map already draws — and
// `solid` is its place in the structure. The shader lerps between them, so the
// map's own connection dots unfold into the building as the reader scrolls.
// Both arrays are WORLD space; the anchor (the corridor's lattice midpoint) is
// baked into `solid` here so the shader stays a plain mix().
//
// The lattice draws this corridor as 3.0 units due south (180°); in reality it
// is 331 m at bearing 141°. The morph uses both: the structure starts at the
// lattice's bearing because at morph 0 it IS the lattice run, and rotates into
// the true bearing as it unfolds — the map's abstraction opening into geography.
//
// v12.5 GEOMETRY, mirrored from scratch/jpm/jpm_proto.py (the source of truth;
// iterate THERE, then port). The footprint is the user's as-built vector,
// registered onto the aerial by a measured transform; the outline ships in
// ./jpm-footprint.ts (generated) and the plate/roof interiors are
// reconstructed here by point-in-polygon fill, so the bundle carries ~250
// points instead of thousands. The 3D reads are photo-grounded:
//   * the white roof is FLAT and CONTINUOUS over the whole structure, with a
//     single sculpted fold from building height down to the walkway canopy at
//     the canal end; the west end stays HIGH (the arm meets the LRT concourse
//     on its 3F);
//   * two continuous fascia ribbons (roof edge + deck parapet) wrap the whole
//     outline; the building facades carry full-height truss diagonals and one
//     sparse dark-glass row; the thin walkway carries a crisscross truss;
//   * a deep box girder runs under the crossing deck, with a V-pier at the
//     road span and a pier arcade under the building;
//   * THE GATES ARE NOT ON THE BRIDGE: the amber gate line sits at platform
//     level inside Sudirman's station building, at the foot of the descent.
import type { NetworkScene, Vec3 } from './network-scene'
import { JPM_OUTLINE_XZ, JPM_OUTLINE_ZONE, JPM_OUTLINE_H } from './jpm-footprint'

const M = 1 / 12 // metres -> world units (1 u ~= 12 m)
// True heights read as flat at this dot size, so they are exaggerated 2.2x —
// the same deliberate lie the CSW prototype documented.
const VX = 2.2

const SPAN = 331 * M // KCI-SUD -> LRTJBDB-DKA, from GTFS
const BEARING_SOLID = 141
const BEARING_FLAT = 180
const LATTICE_RUN = 3.0 // the same corridor as the lattice draws it

// The beat's authored orbit, which the build-time painter's sort must match.
// There is no depth buffer: instances draw in array order, so the array is
// packed back-to-front for THIS view. Slightly wrong while morphing or during
// the entry lerp, which is acceptable — the structure is translucent there.
//
// The yaw is OBLIQUE to both long axes on purpose. The building runs along the
// canal and the LRT station runs along the corridor — perpendicular to each
// other — so any view square to one looks straight down the other and turns it
// into confetti (the scratch bench's yaw sweeps proved this twice). 174 was
// v10's pick; the v12 solid (plate + roof) self-occludes into a dot cloud
// there, and the pose sweep (scratch pose-sheet.png) moved it to 150: from
// the SSE the building reads in elevation (bands + truss), the fold and the
// L-landing both show, and the gate still lands in the open right half. The
// dense-foreground worry that killed 264 no longer applies — the map is
// fully muted while this beat holds. 142 nudges the heading further left
// (lower yaw = camera swings left around the subject) to open the oblique a
// little more without losing the elevation read.
export const JPM_YAW = 142
export const JPM_PITCH = 28 // flattest tilt on the page; far below the 78-89 roll band

// Global thinner on every authored dot radius, applied once where the radii are
// packed. The per-emit values stay as authored (0.16 struts vs 0.2 deck) so
// their RELATIVE weights survive; this only sets the overall grain. Tracks
// PLATE_STEP: the step halved from 0.3, so this halves from 0.72 to keep each
// dot covering the same fraction of its cell. Raise both together to go coarser,
// lower both to go finer — moving one alone either gaps or blobs the surface.
const JPM_DOT_SCALE = 0.36

export const JPM_LEVELS = {
  canal: -0.12, // water, a slight dip below the field
  peron: -3 * M * VX, // KCI Sudirman platforms, in the TRENCH (below street)
  street: 0,
  l2: 9 * M * VX, // JPM main concourse, Lantai 2
  l3: 14 * M * VX, // partial retail floor, Lantai 3
  canopy: 13.5 * M * VX, // the walkway/landing canopy — the roof's low state
  roofb: 16.6 * M * VX, // the building roof — the roof's high state
  lrt: 17 * M * VX, // LRT platforms — the highest station on its line
  lrttop: 24 * M * VX // LRT capsule-roof crest
} as const

// Structure greys, matching the map's register (station dot #cbd0da, field
// lattice greys). Operator colours come from NETWORK so they cannot drift.
const C_DECK = '#9aa3b5'
const C_GLASS = '#4d5666'
const C_STRUCT = '#7b8496'
const C_GATE = '#f5b400' // the paid-area gate line — the story's subject

// App-density knobs. Finer grain = smaller dots AND more of them: shrinking the
// radius alone just opens gaps, and tightening the step alone makes the dots
// overlap into blobs. Keep the two in lockstep — JPM_DOT_SCALE moves with these
// steps so per-dot coverage stays roughly constant while the grain gets denser.
// Fill cost is quadratic in the step: plate 0.15 = 1692 pts, roof 0.18 = 1177
// (measured against the real footprint), which puts the beat near ~4.2k
// instances — the hi-fi bench ran 3,538 and the instanced pass absorbs it.
const PLATE_STEP = 0.15
const ROOF_STEP = 0.18

export interface JpmScene {
  flat: Float32Array // vec3 per instance, world space
  solid: Float32Array // vec3 per instance, world space (anchor baked in)
  colors: Float32Array // vec3, 0..1 RGB
  radii: Float32Array
  levels: Float32Array // 0..1 height rank, staggers the unfold
  count: number
  /** The paid gate in world space, for the overlay anchor. */
  gate: Vec3
  /** Solid-state AABB centre, for framing. */
  center: Vec3
  /**
   * The structure's two ends in world space, for the endpoint labels. Taken
   * from the deck centreline rather than from stationWorld: the lattice puts
   * the station dots where the FLAT map draws them, which is not where the
   * built structure actually terminates.
   */
  ends: { lrt: Vec3, kci: Vec3 }
  /**
   * Midpoint of the deck centreline, above the roof — where the /fares leg
   * floats. Measured ALONG the path rather than as the AABB centre, so it lands
   * on the span itself and not in the air beside a bend.
   */
  span: Vec3
}

interface RawDot {
  flat: [number, number, number]
  solid: [number, number, number]
  color: string
  radius: number
}

// Map structure plan coordinates to world: +z goes to compass bearing `deg`
// (world x = east, z = SOUTH, so bearing 180 is world +z), +x to the walker's
// left. A PURE rotation (det +1) — the first version was accidentally a
// reflection, which swapped the corridor's endpoints (SUD dots seeded on the
// DKA cell) and mirrored the whole plan. Invisible with the symmetric
// placeholder, fatal with real geometry. Kept in lockstep with
// scratch/jpm/jpm_proto.py's _rot.
function rot(x: number, z: number, deg: number): [number, number] {
  const th = ((deg + 180) * Math.PI) / 180
  const ca = Math.cos(th)
  const sa = Math.sin(th)
  return [x * ca - z * sa, x * sa + z * ca]
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export function buildJpmScene(scene: NetworkScene): JpmScene | null {
  // Anchor on the REAL lattice run so the flat state can never drift from the
  // dots the map draws. Missing stations mean a stale network bake; bail rather
  // than float the structure somewhere the corridor isn't.
  const sud = scene.stationWorld.get('KCI-SUD')
  const dka = scene.stationWorld.get('LRTJBDB-DKA')
  if (!sud || !dka) return null
  const mid: Vec3 = { x: (sud.x + dka.x) / 2, y: 0, z: (sud.z + dka.z) / 2 }

  // Lateral spread of the flat seeds. A line dot is r=0.21, so +-0.16 keeps the
  // seeded run inside a single dot's width: at morph 0 the corridor must read as
  // the map's own connection line, not a ribbon the flat map never had.
  const STRUCT_HALF_W = 14
  const FLAT_HALF_W = 0.16

  const dots: RawDot[] = []

  function flatFor(x: number, z: number): [number, number, number] {
    const t = Math.min(1, Math.max(0, z / SPAN + 0.5))
    const lat = Math.max(-1, Math.min(1, x / STRUCT_HALF_W)) * FLAT_HALF_W
    const [fx, fz] = rot(lat, (t - 0.5) * LATTICE_RUN, BEARING_FLAT)
    return [mid.x + fx, 0, mid.z + fz]
  }

  function emit(x: number, y: number, z: number, color: string, radius = 0.2): void {
    const [sx, sz] = rot(x, z, BEARING_SOLID)
    dots.push({
      flat: flatFor(x, z),
      solid: [mid.x + sx, y, mid.z + sz],
      color,
      radius
    })
  }

  function bar(
    x0: number, z0: number, x1: number, z1: number,
    y: number, n: number, color: string, radius = 0.2
  ): void {
    for (let i = 0; i < n; i++) {
      const f = i / Math.max(1, n - 1)
      emit(x0 + (x1 - x0) * f, y, z0 + (z1 - z0) * f, color, radius)
    }
  }

  // `clip` drops any dot whose plan position falls outside the mapped footprint.
  // The building elements ride the hand-authored DECK centreline at fixed
  // lateral offsets, which overshoot where the real outline narrows or ends —
  // most visibly past the building's end, where the last truss bays leaned into
  // open air with no plate behind them and read as a scattered clump. Clipping
  // against inside() keeps the structure only where the footprint says it
  // exists, and self-corrects whenever the footprint is regenerated (a tuned
  // BUILD_END constant would drift instead).
  function ramp(
    x0: number, z0: number, y0: number, x1: number, z1: number, y1: number,
    n: number, color: string, width = 0, wn = 1, clip = false
  ): void {
    const dx = x1 - x0
    const dz = z1 - z0
    const len = Math.hypot(dx, dz) || 1
    const px = -dz / len
    const pz = dx / len
    for (let i = 0; i < n; i++) {
      const f = i / Math.max(1, n - 1)
      for (let k = 0; k < wn; k++) {
        const w = wn === 1 ? 0 : (k / (wn - 1) - 0.5) * width
        const ex = x0 + dx * f + px * w
        const ez = z0 + dz * f + pz * w
        if (clip && !inside(ex, ez)) continue
        emit(ex, y0 + (y1 - y0) * f, ez, color)
      }
    }
  }

  function blob(
    cx: number, cz: number, y: number, rx: number, rz: number,
    color: string, rings = 2, n = 16, height = 0
  ): void {
    const ys = height <= 0 ? [y] : [y, y + height]
    for (const ly of ys) {
      for (let k = 0; k < rings; k++) {
        const f = 1 - k * 0.42
        for (let i = 0; i < n; i++) {
          const a = (2 * Math.PI * i) / n
          emit(cx + rx * f * Math.cos(a), ly, cz + rz * f * Math.sin(a), color)
        }
      }
    }
  }

  const L = JPM_LEVELS

  // The beat draws the JPM ALONE: no station geometry, no canal — the muted
  // map underneath already places the structure geographically, and the real
  // station dots stay lit at the corridor's ends. (Removed at user call; the
  // scratch bench keeps the full context behind build(context=True).)

  // --- the footprint: outline from the generated data, interiors by fill --
  const on = JPM_OUTLINE_XZ.length / 2
  const ox = new Float64Array(on)
  const oz = new Float64Array(on)
  for (let i = 0; i < on; i++) {
    ox[i] = JPM_OUTLINE_XZ[i * 2]! / 10
    oz[i] = JPM_OUTLINE_XZ[i * 2 + 1]! / 10
  }
  let bx0 = Infinity
  let bx1 = -Infinity
  let bz0 = Infinity
  let bz1 = -Infinity
  for (let i = 0; i < on; i++) {
    bx0 = Math.min(bx0, ox[i]!)
    bx1 = Math.max(bx1, ox[i]!)
    bz0 = Math.min(bz0, oz[i]!)
    bz1 = Math.max(bz1, oz[i]!)
  }

  function inside(x: number, z: number): boolean {
    let hit = false
    for (let i = 0, j = on - 1; i < on; j = i++) {
      const xi = ox[i]!
      const zi = oz[i]!
      const xj = ox[j]!
      const zj = oz[j]!
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
        hit = !hit
      }
    }
    return hit
  }

  // Roof height factor for an interior point: its nearest outline vertex's.
  // H varies only along the corridor, so the nearest edge point (about half a
  // deck-width away) carries the right value.
  function hAt(x: number, z: number): number {
    let best = 0
    let bd = Infinity
    for (let i = 0; i < on; i++) {
      const d = (ox[i]! - x) ** 2 + (oz[i]! - z) ** 2
      if (d < bd) {
        bd = d
        best = JPM_OUTLINE_H[i]! / 100
      }
    }
    return best
  }

  // The roof is FLAT (bird's-eye photo): its only height feature is the one
  // sculpted fold between building roof and walkway canopy, via H.
  const roofY = (h: number): number => L.canopy + (L.roofb - L.canopy) * h

  // the L2 plate — 1:1 the registered footprint
  for (let x = Math.ceil(bx0 / PLATE_STEP) * PLATE_STEP; x <= bx1; x += PLATE_STEP) {
    for (let z = Math.ceil(bz0 / PLATE_STEP) * PLATE_STEP; z <= bz1; z += PLATE_STEP) {
      if (inside(x, z)) emit(x, L.l2, z, C_DECK, 0.17)
    }
  }
  // the roof plate — same footprint, continuous surface
  for (let x = Math.ceil(bx0 / ROOF_STEP) * ROOF_STEP; x <= bx1; x += ROOF_STEP) {
    for (let z = Math.ceil(bz0 / ROOF_STEP) * ROOF_STEP; z <= bz1; z += ROOF_STEP) {
      if (inside(x, z)) emit(x, roofY(hAt(x, z)), z, C_DECK, 0.17)
    }
  }

  // fascia ribbons (roof edge + deck parapet), plus the building's sparse
  // glass row and the crossing's box girder — all straight off the outline
  for (let i = 0; i < on; i++) {
    const x = ox[i]!
    const z = oz[i]!
    const zn = JPM_OUTLINE_ZONE.charCodeAt(i) - 48
    const h = JPM_OUTLINE_H[i]! / 100
    emit(x, roofY(h), z, C_DECK)
    emit(x, L.l2 + 0.3, z, C_DECK)
    if (zn === 1) emit(x, L.l2 + 0.3 + (roofY(h) - L.l2 - 0.3) * 0.5, z, C_GLASS, 0.16)
    if (zn === 2) emit(x, L.l2 - 0.22, z, C_DECK)
  }

  // --- the deck centreline (building elements ride it; the plate already
  // draws the walkable surface) --------------------------------------------
  const DECK: [number, number][] = [
    [-5.5, 9.3], [-4.7, 7.5], [-4.3, 6.1], [-2.5, 3.2], [-0.8, 0.6],
    [1.1, -2.1], [2.4, -3.7], [4.3, -5.0], [6.0, -6.3], [7.1, -7.3],
    [7.8, -8.1]
  ]
  const segLens = DECK.slice(0, -1).map((a, i) =>
    Math.hypot(DECK[i + 1]![0] - a[0], DECK[i + 1]![1] - a[1]))
  const pathTotal = segLens.reduce((s, v) => s + v, 0)
  function along(f: number): [number, number, number, number] {
    let want = f * pathTotal
    for (let i = 0; i < segLens.length; i++) {
      const sl = segLens[i]!
      if (want <= sl || i === segLens.length - 1) {
        const g = Math.min(1, want / sl)
        const [ax, az] = DECK[i]!
        const [bx, bz] = DECK[i + 1]!
        return [ax + (bx - ax) * g, az + (bz - az) * g, (bx - ax) / sl, (bz - az) / sl]
      }
      want -= sl
    }
    throw new Error('unreachable')
  }

  // the building rides the path between these fractions (measured)
  const BUILD_START = 0.16
  const BUILD_END = 0.68

  // retail floor (Lantai 3), two rows
  for (let i = 0; i < 13; i++) {
    const f = BUILD_START + 0.01 + ((BUILD_END - BUILD_START - 0.02) * i) / 12
    const [x, z, dx, dz] = along(f)
    for (const off of [-0.35, 0.35]) {
      const ex = x + -dz * off
      const ez = z + dx * off
      if (inside(ex, ez)) emit(ex, L.l3, ez, C_GLASS)
    }
  }
  // full-height truss diagonals on both building facades, alternating
  for (let i = 0; i < 14; i++) {
    const f = BUILD_START + 0.01 + ((BUILD_END - BUILD_START - 0.02) * i) / 13
    const [x, z, dx, dz] = along(f)
    const lean = i % 2 === 0 ? 0.55 : -0.55
    for (const off of [-0.75, 0.75]) {
      ramp(
        x + -dz * off, z + dx * off, L.l2 + 0.08,
        x + -dz * off + dx * lean, z + dx * off + dz * lean,
        L.roofb - 0.12, 5, C_STRUCT, 0, 1, true
      )
    }
  }

  // the thin walkway's CRISSCROSS truss: an X in every bay, both edges
  const XN = 12
  for (let i = 0; i < XN; i++) {
    const f0 = 0.70 + ((0.985 - 0.70) * i) / XN
    const f1 = 0.70 + ((0.985 - 0.70) * (i + 1)) / XN
    const [x0, z0, d0x, d0z] = along(f0)
    const [x1, z1, d1x, d1z] = along(f1)
    for (const off of [-0.55, 0.55]) {
      const ax = x0 - d0z * off
      const az = z0 + d0x * off
      const bx = x1 - d1z * off
      const bz = z1 + d1x * off
      ramp(ax, az, L.l2 + 0.28, bx, bz, L.canopy - 0.06, 4, C_STRUCT, 0, 1, true)
      ramp(ax, az, L.canopy - 0.06, bx, bz, L.l2 + 0.28, 4, C_STRUCT, 0, 1, true)
    }
  }

  // NOTE: everything that used to live below deck level or beyond the mapped
  // footprint has been removed at user call — the pier arcade, the extra
  // column, the V-pier under the road span, the short link into the LRT's
  // south end, and the canal truss chord. The structure now reads only where
  // the registered footprint says it exists; nothing is authored off-lattice.
  // (The scratch bench still carries them all if they ever need to come back.)

  // --- the descent into Sudirman's building. THE GATE LINE lives INSIDE
  // that building at platform level — the bridge itself has no fare gates ---
  ramp(8.2, -10.6, L.l2, 6.8, -11.2, L.peron, 6, C_DECK, 0.7, 2)
  bar(6.5, -11.05, 7.1, -11.5, L.peron + 0.05, 5, C_GATE, 0.24)
  // the gate hall around it
  blob(6.6, -11.3, 0.3, 0.9, 0.7, C_GLASS, 1, 8)

  // Painter's sort for the authored pose: no depth buffer, so pack instances
  // back-to-front along the beat camera's forward vector (largest depth first).
  const yawR = (JPM_YAW * Math.PI) / 180
  const pitchR = (JPM_PITCH * Math.PI) / 180
  const fwd = [
    -Math.sin(yawR) * Math.cos(pitchR),
    -Math.sin(pitchR),
    -Math.cos(yawR) * Math.cos(pitchR)
  ] as const
  dots.sort((a, b) =>
    (b.solid[0] * fwd[0] + b.solid[1] * fwd[1] + b.solid[2] * fwd[2])
    - (a.solid[0] * fwd[0] + a.solid[1] * fwd[1] + a.solid[2] * fwd[2])
  )

  const n = dots.length
  const flat = new Float32Array(n * 3)
  const solid = new Float32Array(n * 3)
  const colors = new Float32Array(n * 3)
  const radii = new Float32Array(n)
  const levels = new Float32Array(n)
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < n; i++) {
    const d = dots[i]!
    flat.set(d.flat, i * 3)
    solid.set(d.solid, i * 3)
    colors.set(hexToRgb(d.color), i * 3)
    radii[i] = d.radius * JPM_DOT_SCALE
    levels[i] = Math.min(1, Math.max(0, d.solid[1] / L.lrt))
    minX = Math.min(minX, d.solid[0])
    maxX = Math.max(maxX, d.solid[0])
    minZ = Math.min(minZ, d.solid[2])
    maxZ = Math.max(maxZ, d.solid[2])
  }

  // The gate bar's centre in structure space is (6.8, -11.28) — keep in step
  // with the C_GATE bar above (peron level, inside Sudirman's building).
  const [gx, gz] = rot(6.8, -11.28, BEARING_SOLID)

  // The two ends, in structure space, taken from the deck centreline: DECK[0]
  // is the west tip where the arm meets the LRT concourse, and the descent's
  // foot is where the walkway lands inside Sudirman. Labelled at deck level
  // (not the gate's peron level) so both plates sit on the visible structure
  // rather than floating under it.
  const [lx, lz] = rot(DECK[0]![0], DECK[0]![1], BEARING_SOLID)
  const [kx, kz] = rot(8.2, -10.6, BEARING_SOLID)

  // Halfway along the deck by ARC LENGTH, not the AABB centre: the path bends,
  // so the box's middle sits off the structure while this lands on the span.
  const [midPx, midPz] = along(0.5)
  const [spx, spz] = rot(midPx, midPz, BEARING_SOLID)
  return {
    flat,
    solid,
    colors,
    radii,
    levels,
    count: n,
    gate: { x: mid.x + gx, y: L.peron + 0.3, z: mid.z + gz },
    center: { x: (minX + maxX) / 2, y: L.l2 * 0.9, z: (minZ + maxZ) / 2 },
    ends: {
      lrt: { x: mid.x + lx, y: L.l2 + 0.6, z: mid.z + lz },
      kci: { x: mid.x + kx, y: L.l2 + 0.6, z: mid.z + kz }
    },
    // Above the building roof, so the panel floats clear of the structure
    // instead of being buried in its dots.
    span: { x: mid.x + spx, y: L.roofb + 1.2, z: mid.z + spz }
  }
}
