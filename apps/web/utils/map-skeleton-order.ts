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

type Point = [number, number]

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
  spanMs: number
): OrderedStroke[] {
  const pieces: { c: string, w: number, points: Point[], near: number }[] = []

  for (const stroke of strokes) {
    const points = parsePath(stroke.d)
    if (points.length < 2) continue
    for (const part of splitAtNearest(points, anchorX, anchorY)) {
      if (part.length < 2) continue
      const oriented = orient(part, anchorX, anchorY)
      pieces.push({
        c: stroke.c,
        w: stroke.w,
        points: oriented,
        near: Math.min(...oriented.map(p => distanceSquared(p, anchorX, anchorY)))
      })
    }
  }

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
