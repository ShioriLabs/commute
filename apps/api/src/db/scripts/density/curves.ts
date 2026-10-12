/*
 * Pure 24-hour curve maths for the density generator. A Curve is 24 hourly
 * weights, index 0 = 00:00–00:59 WIB. Every function returns a NEW normalised
 * curve (sum 1) and never mutates its input.
 */
export type Curve = number[]

/** Morning/afternoon split for "share of the day before 13:00", the cut-off KCI releases use. */
export const AM_SPLIT_HOUR = 13

const total = (c: Curve) => c.reduce((a, b) => a + b, 0)

export function normalize(c: Curve): Curve {
  const t = total(c)
  return t === 0 ? c.map(() => 0) : c.map(x => x / t)
}

/*
 * Scale everything before `beforeHour` so it carries `targetShare` of the day,
 * and everything after so the rest carries 1 − targetShare. Within each part
 * the shape is preserved: this corrects WEIGHT, not timing. (A 1h time shift
 * was tested against KCI's releases and rejected; see the spec.)
 */
function setShareBefore(c: Curve, beforeHour: number, targetShare: number): Curve {
  const n = normalize(c)
  const head = total(n.slice(0, beforeHour))
  const tail = 1 - head
  if (head === 0 || tail === 0) return n
  return n.map((x, h) => h < beforeHour ? x * targetShare / head : x * (1 - targetShare) / tail)
}

export function reweightMorning(c: Curve, beforeHour: number, targetShare: number): Curve {
  return setShareBefore(c, beforeHour, targetShare)
}

export function withAmShare(c: Curve, amShare: number, splitHour = AM_SPLIT_HOUR): Curve {
  return setShareBefore(c, splitHour, amShare)
}

/*
 * Move the part before `splitHour` earlier by `hoursEarlier` (fractional hours
 * interpolate linearly between neighbouring bins). Mass shifted before 00:00
 * is folded into hour 0, so nothing is lost. Negative values shift later.
 * Only the morning moves: far origins board earlier, but the evening peak is
 * set by when offices empty, which ride time doesn't change.
 */
export function shiftAm(c: Curve, hoursEarlier: number, splitHour = AM_SPLIT_HOUR): Curve {
  const n = normalize(c)
  const out = new Array(24).fill(0) as Curve
  for (let h = 0; h < 24; h++) {
    if (h >= splitHour) {
      out[h] = out[h]! + n[h]!
      continue
    }
    const target = h - hoursEarlier
    const lo = Math.floor(target)
    const frac = target - lo
    const put = (bin: number, w: number) => {
      const at = Math.min(Math.max(bin, 0), splitHour - 1)
      out[at] = out[at]! + w
    }
    put(lo, n[h]! * (1 - frac))
    if (frac > 0) put(lo + 1, n[h]! * frac)
  }
  return normalize(out)
}
