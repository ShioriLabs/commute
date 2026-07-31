/*
 * Pure geometry helpers shared by the map extraction scripts
 * (build-map-skeleton.ts and build-map-geometry.ts).
 *
 * These run in Node only. Anything that must execute inside page.evaluate()
 * (e.g. rgbToHsl) cannot live here: Playwright serializes the evaluated
 * function alone, so imported bindings would not exist in the browser context.
 */

/** Perpendicular distance from p to the segment ab. */
export function pointSegmentDistance(p: number[], a: number[], b: number[]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Douglas-Peucker, iterative so a 4000-point sample can't blow the stack. */
export function simplify(points: number[][], epsilon: number): number[][] {
  if (points.length <= 2) return points

  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  const stack: [number, number][] = [[0, points.length - 1]]

  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    let maxDistance = 0
    let index = -1
    for (let i = first + 1; i < last; i++) {
      const distance = pointSegmentDistance(points[i], points[first], points[last])
      if (distance > maxDistance) {
        maxDistance = distance
        index = i
      }
    }
    if (index !== -1 && maxDistance > epsilon) {
      keep[index] = true
      stack.push([first, index], [index, last])
    }
  }

  return points.filter((_, i) => keep[i])
}

/** Worst per-channel difference between two #RRGGBB colours. */
export function channelDistance(a: string, b: string): number {
  let worst = 0
  for (let i = 1; i < 7; i += 2) {
    worst = Math.max(worst, Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)))
  }
  return worst
}
