// The camera flight's easing curve, evaluated in JS.
//
// The flight is a rAF lerp over a transform the renderer owns, not a CSS
// transition on a DOM node, so its curve has to be sampled by hand rather than
// handed to the browser as a cubic-bezier.
//
// It is deliberately NOT --ease-ios-spring, the token every entrance in the app
// shares. That curve was tried here and is too abrupt for a camera: it peaks at
// 3.6x average speed only a fifth of the way in, so the map lurches to full
// speed almost immediately and then crawls the last stretch. An entrance can
// afford that — it travels a few dozen pixels and the eye reads the arrival,
// not the path. A pan across the city is the opposite: the rider is tracking
// where the map came FROM, and a lurch loses them.
//
// So the map keeps the family resemblance — front-loaded, hard late
// deceleration — with the leading edge taken off.

/**
 * Control points of the camera curve: cubic-bezier(0.45, 0.25, 0.2, 1).
 *
 * Monotonic, so it cannot overshoot a clamped destination and snap back — see
 * the test that pins this. Compared with --ease-ios-spring it peaks at 2.65x
 * average speed instead of 3.63x, and reaches that peak a third of the way in
 * rather than a fifth: the camera builds up rather than jumping. It is still
 * decisively front-loaded, ~81% done by the halfway point, which is what keeps
 * a tap feeling answered.
 */
const P1X = 0.45
const P1Y = 0.25
const P2X = 0.2
const P2Y = 1

// Polynomial coefficients of the Bezier, precomputed once. A CSS timing
// function is a unit cubic Bezier with endpoints pinned at (0,0) and (1,1), so
// only the two middle control points vary and both axes reduce to
// `((a*t + b)*t + c)*t`.
const CX = 3 * P1X
const BX = 3 * (P2X - P1X) - CX
const AX = 1 - CX - BX

const CY = 3 * P1Y
const BY = 3 * (P2Y - P1Y) - CY
const AY = 1 - CY - BY

const sampleX = (t: number) => ((AX * t + BX) * t + CX) * t
const sampleY = (t: number) => ((AY * t + BY) * t + CY) * t
const slopeX = (t: number) => (3 * AX * t + 2 * BX) * t + CX

/**
 * Eased 0..1 for a linear 0..1 progress, on the camera curve.
 *
 * The curve is parameterised by t, not by x, so getting y for a given progress
 * means solving x(t) = progress first. Newton-Raphson converges in a handful of
 * iterations here because the curve is monotonic in x; the loop bails on a flat
 * slope so a degenerate curve cannot divide by ~0 and fly off.
 *
 * Endpoints are returned exactly rather than solved: the caller uses p >= 1 to
 * decide the flight is over and drop it, so the final frame must land on the
 * destination transform bit-for-bit and not a rounding error away from it.
 */
export function easeCameraFlight(p: number): number {
  if (p <= 0) return 0
  if (p >= 1) return 1

  let t = p
  for (let i = 0; i < 8; i++) {
    const error = sampleX(t) - p
    if (Math.abs(error) < 1e-7) break
    const d = slopeX(t)
    if (Math.abs(d) < 1e-7) break
    t -= error / d
  }
  return sampleY(t)
}
