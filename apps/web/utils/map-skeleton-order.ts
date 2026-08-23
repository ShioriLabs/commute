// Turns the flat stroke list in app/data/map-skeleton.json into the draw order the map's
// loading animation plays (components/map-skeleton.tsx): the network grows outward from
// Manggarai, which previewCamera() puts under the viewport center on every screen size, so
// the draw always radiates from the middle of the user's screen.
//
// Three things have to happen for that to read as *growth* rather than lines merely
// arriving in distance order. A stroke drawn with stroke-dashoffset always grows from its
// own first point, so a corridor whose path data happens to start at its far end would
// grow inward, against the gesture — hence orient(). And a corridor that runs straight
// through Manggarai has to become two strokes, or one of its halves grows backwards no
// matter which end you start from — hence the split.
//
// Pure and in utils/ for the reason given in the header of map-morph-camera.ts: apps/web
// has no jsdom test environment, so this is the only part of the animation a test can
// cover. The build script deliberately does not bake this in — the anchor is a runtime
// concept that belongs next to the camera, and keeping the JSON a plain stroke list means
// retuning the choreography never requires regenerating the asset.

export interface SkeletonStroke {
  c: string
  w: number
  cx: number
  cy: number
  d: string
}

export interface OrderedStroke {
  c: string
  w: number
  d: string
  delayMs: number
}

export interface SkeletonStation {
  x: number
  y: number
  r: number
  c: string
}

export interface OrderedStation extends SkeletonStation {
  delayMs: number
}

export interface SkeletonSpawn {
  /** Line colour in app/data/map-skeleton.json this applies to. */
  c: string
  x: number
  y: number
  /**
   * Absorb every stroke that chains onto this one, end to end, and draw the result as a
   * single path. Set it when the spawn is the terminus of a whole line; leave it off when
   * the spawn only heads one *section* of a line that continues past it.
   */
  chain?: boolean
}

type Point = [number, number]

// Lines that grow from their own terminus instead of from Manggarai, because that is where
// the line actually begins — Manggarai is merely the closest point of it, which for a line
// that only passes nearby produces a draw starting in the middle of nowhere.
//
// Coordinates are tap-target midpoints from app/data/points.json, hardcoded for the same
// reason FDTJ_ANCHOR_X/Y are in map-morph-camera.ts (points.json is imported as ?url to
// keep it out of the bundle) and cross-checked against it by the test.
export const FDTJ_SPAWNS: readonly SkeletonSpawn[] = [
  // MRTJ-BHI, Bundaran HI — northern terminus of MRT Jakarta, so it draws south-west.
  // Chained: the PDF splits MRT into three strokes meeting at Istora and Fatmawati, and
  // without this the two the spawn does not touch start on their own, so the line visibly
  // sprouts from Istora at the same moment it sprouts from Bundaran HI.
  { c: '#CA2B51', x: 3635.36081619927, y: 3493.8723452556296, chain: true },
  // LRTJBDB-DKA, Dukuh Atas — both LRT Jabodebek branches start here and fan out. One
  // stroke each today; chained so a future edition splitting them cannot reintroduce the
  // MRT problem silently.
  { c: '#026C3E', x: 3835.3879440387554, y: 3871.541068789468, chain: true },
  { c: '#1251A2', x: 3835.3879440387554, y: 3871.541068789468, chain: true },
  // KCI-JNG, Jatinegara — head of the Cikarang loop's Pasar Senen arc, so it runs towards
  // Kampung Bandan and closes the loop there rather than unzipping away from it.
  //
  // Deliberately NOT chained. This arc is contiguous with the Cikarang main line, so
  // chaining would swallow the whole line into one sweep out of Jatinegara — and the main
  // line's western branch is precisely what the arc is supposed to meet at Kampung Bandan.
  { c: '#00BDEF', x: 5985.446268073702, y: 4119.887766850177 }
]

// A spawn claims a stroke only when it sits at one of its *endpoints*, never merely near
// the line. Proximity alone would misfire badly: the Cikarang main line runs straight
// through Jatinegara on its way to Bekasi, so it would be caught by the loop's spawn and
// redrawn backwards. On the real map the endpoint matches land at 2-72 units and the
// nearest non-match is 414, so this threshold is not delicately placed.
const SPAWN_RADIUS = 150

// How close two endpoints must be to count as the same junction when chaining. The real
// joins are 0 and 40 units (the 40 is a slight overlap at Fatmawati, where the two strokes
// share a little track rather than meeting cleanly), and the nearest same-colour pair that
// must NOT join is far outside this.
const JOIN_RADIUS = 60

// The build script emits integer coordinates as `M12 34L56 78`, and nothing else.
export function parsePath(d: string): Point[] {
  const points: Point[] = []
  for (const match of d.matchAll(/(-?\d+) (-?\d+)/g)) {
    points.push([Number(match[1]), Number(match[2])])
  }
  return points
}

export function serializePath(points: readonly Point[]): string {
  return 'M' + points.map(([x, y]) => `${x} ${y}`).join('L')
}

function distanceSquared(p: Point, x: number, y: number): number {
  return (p[0] - x) ** 2 + (p[1] - y) ** 2
}

/*
 * Line colours are compared with a tolerance because each FDTJ edition is
 * re-rasterised from the source PDF, and colour-profile rounding moves channels
 * by a step or two without any design change: the 2026-06a -> 2026-08 rebuild
 * shifted every line (#00BDEF -> #00BDEE, #EF3637 -> #EE3637, …). Exact string
 * equality made the spawn table silently stop matching, which shows up as lines
 * drawing from the wrong end rather than as an error.
 *
 * 8 per channel is far tighter than the gap between any two FDTJ line colours
 * (the closest pair differs by ~30), so this cannot merge distinct lines.
 */
const COLOUR_TOLERANCE = 8

function channels(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return null
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)]
}

export function sameColour(a: string, b: string): boolean {
  if (a === b) return true
  const ca = channels(a)
  const cb = channels(b)
  if (!ca || !cb) return false
  return ca.every((v, i) => Math.abs(v - cb[i]!) <= COLOUR_TOLERANCE)
}

/**
 * Splits a polyline at its closest vertex to the anchor when that vertex is interior, so a
 * corridor passing through Manggarai grows away from it in both directions at once. Each
 * half keeps the shared vertex, so the geometry drawn is unchanged.
 */
function splitAtNearest(points: Point[], x: number, y: number): Point[][] {
  let nearest = 0
  let best = Infinity
  for (let i = 0; i < points.length; i++) {
    const d = distanceSquared(points[i], x, y)
    if (d < best) {
      best = d
      nearest = i
    }
  }
  if (nearest === 0 || nearest === points.length - 1) return [points]
  return [points.slice(0, nearest + 1), points.slice(nearest)]
}

/** Whether the spawn sits at either end of this stroke — never merely near the line. */
function touchesSpawn(points: readonly Point[], spawn: SkeletonSpawn): boolean {
  const limit = SPAWN_RADIUS ** 2
  return [points[0], points[points.length - 1]]
    .some(end => distanceSquared(end, spawn.x, spawn.y) <= limit)
}

/** The spawn for this line, if one sits at either end of this particular stroke. */
function findSpawn(
  colour: string,
  points: readonly Point[],
  spawns: readonly SkeletonSpawn[]
): SkeletonSpawn | null {
  return spawns.find(spawn => sameColour(spawn.c, colour) && touchesSpawn(points, spawn)) ?? null
}

/**
 * Walks outward from `head`, absorbing same-colour polylines that meet it end to end, and
 * returns them concatenated into one.
 *
 * This exists because the source PDF has no concept of a line: it emits whatever stroke
 * fragments the draughtsman drew. MRT Jakarta arrives as three separate paths, and every
 * fragment a spawn does not personally touch would otherwise fall back to the global
 * anchor and start growing on its own, so one line appears to have several origins.
 */
function chainFrom(
  head: Point[],
  pool: readonly { index: number, points: Point[] }[]
): { points: Point[], used: number[] } {
  const chained = [...head]
  const remaining = [...pool]
  const used: number[] = []

  for (;;) {
    const tail = chained[chained.length - 1]
    let pick = -1
    let reversed = false
    let best = JOIN_RADIUS ** 2

    remaining.forEach((candidate, i) => {
      const atStart = distanceSquared(candidate.points[0], tail[0], tail[1])
      const atEnd = distanceSquared(candidate.points[candidate.points.length - 1], tail[0], tail[1])
      if (atStart < best) {
        best = atStart
        pick = i
        reversed = false
      }
      if (atEnd < best) {
        best = atEnd
        pick = i
        reversed = true
      }
    })

    if (pick === -1) return { points: chained, used }
    const [next] = remaining.splice(pick, 1)
    used.push(next.index)
    const oriented = reversed ? [...next.points].reverse() : next.points
    // Drop the joining vertex when the two genuinely share it, so the merged path has no
    // zero-length segment; keep it when they only come close, since that short connector
    // is the real geometry between them.
    chained.push(...(best === 0 ? oriented.slice(1) : oriented))
  }
}

/** Reverses the polyline if its far end comes first, so drawing always heads outward. */
function orient(points: Point[], x: number, y: number): Point[] {
  const head = distanceSquared(points[0], x, y)
  const tail = distanceSquared(points[points.length - 1], x, y)
  return head <= tail ? points : [...points].reverse()
}

/**
 * Draw order and per-stroke delay.
 *
 * Strokes are grouped by colour+width so a corridor draws as one unit rather than
 * scattering into the handful of separate polylines the PDF happens to have split it
 * into; groups are then ranked by how close they come to the anchor.
 *
 * Deliberately not utils/stagger.ts's staggerDelay(): that is index-with-a-cap for list
 * entrances, where the count is unbounded and only the first few matter. This is a
 * normalized fraction over a spatial ranking, where the whole range has to fit in spanMs
 * however many corridors the map edition happens to have.
 */
export function orderSkeleton(
  strokes: readonly SkeletonStroke[],
  anchorX: number,
  anchorY: number,
  spanMs: number,
  spawns: readonly SkeletonSpawn[] = FDTJ_SPAWNS
): OrderedStroke[] {
  const parsed = strokes
    .map(stroke => ({ c: stroke.c, w: stroke.w, points: parsePath(stroke.d) }))
    .filter(stroke => stroke.points.length >= 2)

  const pieces: { c: string, w: number, points: Point[], near: number }[] = []
  const claimed = new Set<number>()

  const emit = (c: string, w: number, points: Point[]) => {
    pieces.push({
      c,
      w,
      points,
      near: Math.min(...points.map(p => distanceSquared(p, anchorX, anchorY)))
    })
  }

  // Chained spawns run first: they absorb their neighbours, so they have to claim those
  // strokes before the fallback below gives any of them an origin of its own.
  for (const spawn of spawns) {
    if (!spawn.chain) continue
    const headIndex = parsed.findIndex((stroke, index) =>
      !claimed.has(index) && sameColour(stroke.c, spawn.c) && touchesSpawn(stroke.points, spawn))
    if (headIndex === -1) continue

    const head = parsed[headIndex]
    claimed.add(headIndex)
    const pool = parsed
      .map((stroke, index) => ({ index, points: stroke.points, c: stroke.c, w: stroke.w }))
      .filter(entry => !claimed.has(entry.index) && sameColour(entry.c, head.c) && entry.w === head.w)

    const { points, used } = chainFrom(orient(head.points, spawn.x, spawn.y), pool)
    for (const index of used) claimed.add(index)
    emit(head.c, head.w, points)
  }

  parsed.forEach((stroke, index) => {
    if (claimed.has(index)) return

    // Where this particular line grows from. Only the split and the orientation follow it;
    // the delay ranking below stays on the global anchor, so the cascade as a whole still
    // blooms outward from Manggarai even though individual lines start at their own ends.
    const spawn = findSpawn(stroke.c, stroke.points, spawns)
    const originX = spawn ? spawn.x : anchorX
    const originY = spawn ? spawn.y : anchorY

    // A spawn is a terminus by construction, so the line runs one way out of it and must
    // not be split. Splitting anyway would cut at whichever vertex happens to be closest,
    // and a spawn that lands just past the first vertex — Jatinegara sits 15 units from
    // the arc's second point but 72 from its first — would shear off a stub and draw it
    // backwards.
    const parts = spawn ? [stroke.points] : splitAtNearest(stroke.points, originX, originY)

    for (const part of parts) {
      if (part.length < 2) continue
      emit(stroke.c, stroke.w, orient(part, originX, originY))
    }
  })

  const groupKey = (piece: { c: string, w: number }) => `${piece.c}|${piece.w}`
  const groupNear = new Map<string, number>()
  for (const piece of pieces) {
    const key = groupKey(piece)
    groupNear.set(key, Math.min(groupNear.get(key) ?? Infinity, piece.near))
  }

  const ranked = [...groupNear.entries()].sort((a, b) => a[1] - b[1])
  const rankOf = new Map(ranked.map(([key], index) => [key, index]))
  // A single group has no spread to distribute, and dividing by zero would give NaN
  // delays that silently disable every animation.
  const divisor = Math.max(1, ranked.length - 1)

  return pieces.map(piece => ({
    c: piece.c,
    w: piece.w,
    d: serializePath(piece.points),
    delayMs: (rankOf.get(groupKey(piece))! / divisor) * spanMs
  }))
}

/** Shortest distance from p to segment ab, and how far along ab the closest point sits. */
function projectOnSegment(p: Point, a: Point, b: Point): { distance: number, along: number } {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return { distance: Math.hypot(p[0] - a[0], p[1] - a[1]), along: 0 }
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared))
  const distance = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
  return { distance, along: t * Math.sqrt(lengthSquared) }
}

/**
 * When each station marker appears: the moment its own line's stroke reaches it.
 *
 * Tying the markers to the drawing rather than giving them a cascade of their own is what
 * makes them read as part of the line being drawn — the alternative, an independent
 * stagger, has dots landing on track that has not been laid yet.
 */
export function orderStations(
  stations: readonly SkeletonStation[],
  strokes: readonly OrderedStroke[],
  strokeMs: number
): OrderedStation[] {
  const lines = strokes.map((stroke) => {
    const points = parsePath(stroke.d)
    let total = 0
    const cumulative = [0]
    for (let i = 1; i < points.length; i++) {
      total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
      cumulative.push(total)
    }
    return { c: stroke.c, delayMs: stroke.delayMs, points, cumulative, total }
  })

  const ordered: OrderedStation[] = []

  for (const station of stations) {
    let best = Infinity
    let delayMs: number | null = null

    for (const line of lines) {
      if (line.c !== station.c || line.total === 0) continue
      for (let i = 0; i < line.points.length - 1; i++) {
        const hit = projectOnSegment([station.x, station.y], line.points[i], line.points[i + 1])
        if (hit.distance >= best) continue
        best = hit.distance
        delayMs = line.delayMs + ((line.cumulative[i] + hit.along) / line.total) * strokeMs
      }
    }

    // A marker whose line is missing from this edition simply does not appear, rather than
    // popping at time zero somewhere the drawing never goes.
    if (delayMs !== null) ordered.push({ ...station, delayMs })
  }

  return ordered
}
