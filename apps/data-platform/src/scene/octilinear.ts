// Octilinear (0/45/90°) routing on the baked col/row lattice. Ported from the
// original Canvas2D hero (network-canvas.ts) — the lattice geometry is
// identical; only the projection to pixels/world changes downstream.

export interface GridCell {
  col: number
  row: number
}

/** A unit step on the lattice: each component is -1, 0 or 1. */
export interface Step {
  dc: number
  dr: number
}

function step(a: GridCell, b: GridCell): Step {
  return { dc: Math.sign(b.col - a.col), dr: Math.sign(b.row - a.row) }
}

function sameStep(a: Step | null, b: Step | null): boolean {
  return a !== null && b !== null && a.dc === b.dc && a.dr === b.dr
}

/** The direction of the route's first step, or null for a zero-length route. */
function entryOf(cells: GridCell[]): Step | null {
  return cells.length > 1 ? step(cells[0]!, cells[1]!) : null
}

/** The direction of the route's last step, or null for a zero-length route. */
export function exitStep(cells: GridCell[]): Step | null {
  return cells.length > 1 ? step(cells[cells.length - 2]!, cells[cells.length - 1]!) : null
}

/**
 * How many 45° turns separate two unit steps, 0..4. Used to compare candidate
 * routes when neither ends on exactly the wanted bearing.
 */
function turnCost(a: Step | null, b: Step | null): number {
  if (a === null || b === null) return 4
  const angle = (s: Step): number => Math.atan2(s.dr, s.dc)
  const diff = Math.abs(angle(a) - angle(b))
  const wrapped = Math.min(diff, Math.PI * 2 - diff)
  return Math.round(wrapped / (Math.PI / 4))
}

/** Direction changes strictly inside one route. */
function internalBends(cells: GridCell[]): number {
  let bends = 0
  let prev: Step | null = null
  for (let i = 1; i < cells.length; i++) {
    const d = step(cells[i - 1]!, cells[i]!)
    if (prev !== null && !sameStep(prev, d)) bends++
    prev = d
  }
  return bends
}

// Diagonal leg first, then the straight remainder — the original behaviour.
function diagonalFirst(a: GridCell, b: GridCell): GridCell[] {
  const cells: GridCell[] = []
  let col = a.col
  let row = a.row
  const dc = Math.sign(b.col - col)
  const dr = Math.sign(b.row - row)
  const diag = Math.min(Math.abs(b.col - col), Math.abs(b.row - row))
  cells.push({ col, row })
  for (let i = 0; i < diag; i++) {
    col += dc
    row += dr
    cells.push({ col, row })
  }
  while (col !== b.col) {
    col += dc
    cells.push({ col, row })
  }
  while (row !== b.row) {
    row += dr
    cells.push({ col, row })
  }
  return cells
}

// The same L the other way round: straight remainder first, then the diagonal.
// Covers the same cells count but enters on an axis-aligned step, which is what
// lets a run continue a horizontal or vertical bearing.
function straightFirst(a: GridCell, b: GridCell): GridCell[] {
  const cells: GridCell[] = []
  let col = a.col
  let row = a.row
  const dc = Math.sign(b.col - col)
  const dr = Math.sign(b.row - row)
  const adc = Math.abs(b.col - col)
  const adr = Math.abs(b.row - row)
  const straight = Math.abs(adc - adr)
  cells.push({ col, row })
  if (adc > adr) {
    for (let i = 0; i < straight; i++) {
      col += dc
      cells.push({ col, row })
    }
  } else {
    for (let i = 0; i < straight; i++) {
      row += dr
      cells.push({ col, row })
    }
  }
  while (col !== b.col && row !== b.row) {
    col += dc
    row += dr
    cells.push({ col, row })
  }
  while (col !== b.col) {
    col += dc
    cells.push({ col, row })
  }
  while (row !== b.row) {
    row += dr
    cells.push({ col, row })
  }
  return cells
}

/**
 * Octilinear route between two lattice cells, inclusive of both ends.
 *
 * An L between two cells can be drawn two ways — diagonal leg first or straight
 * leg first — and they differ only in which half comes first. Routing each
 * station pair in isolation (always diagonal-first) manufactured a bend at
 * nearly every station on a densely-stopped run: the FDTJ diagram holds one
 * bearing for many stations, but the lattice kept alternating between a
 * diagonal and an axis step. Measured across the network that was 66 direction
 * changes against FDTJ's 34.
 *
 * Passing `entryDir` — the direction the line is already travelling — lets the
 * route continue that bearing when it can, which drops the total to 52. An
 * exhaustive search for the minimum on this lattice returns 50, so this greedy
 * rule is within 2 of optimal; the rest is inherent to a 120-column octilinear
 * grid. Callers thread `exitStep()` of the previous route in as `entryDir`.
 *
 * `exitDir` is the mirror case, and it matters at the START of a run where no
 * entry bearing exists yet. LRT Jabodebek leaves Dukuh Atas eastward and only
 * then turns down into the Setiabudi/Rasuna Said trunk; with neither hint the
 * fallback put the diagonal first and drew a staircase instead of the printed
 * straight-then-corner. Aligning the route's LAST step with where the line is
 * headed reproduces the diagram's shape.
 *
 * With neither hint this is exactly the old diagonal-first behaviour, so
 * single-pair callers are unaffected.
 */
export function octRoute(
  a: GridCell,
  b: GridCell,
  entryDir: Step | null = null,
  exitDir: Step | null = null
): GridCell[] {
  const diag = diagonalFirst(a, b)
  if (entryDir === null && exitDir === null) return diag
  const straight = straightFirst(a, b)
  if (entryDir === null) {
    // Only the outgoing bearing is known. An exact match is too strict to be
    // useful: leaving Dukuh Atas neither variant ends heading straight down, so
    // both would tie and the fallback would keep the staircase. Score by how far
    // each one's final step has to turn to meet the outgoing bearing instead —
    // straight-first ends on a diagonal (one 45° turn from vertical), while
    // diagonal-first ends horizontal (two). The smaller turn puts the corner
    // here, which is what the printed diagram draws.
    const dTurn = turnCost(exitStep(diag), exitDir)
    const sTurn = turnCost(exitStep(straight), exitDir)
    if (dTurn !== sTurn) return dTurn < sTurn ? diag : straight
    return internalBends(diag) <= internalBends(straight) ? diag : straight
  }
  const diagContinues = sameStep(entryOf(diag), entryDir)
  const straightContinues = sameStep(entryOf(straight), entryDir)
  if (diagContinues && !straightContinues) return diag
  if (straightContinues && !diagContinues) return straight
  // Neither (or both) continues the bearing: take the straighter route, and
  // prefer diagonal-first on a tie so the established look is preserved.
  return internalBends(diag) <= internalBends(straight) ? diag : straight
}

// True when route[i] is where the path changes direction (a dogleg corner).
export function isCorner(route: GridCell[], i: number): boolean {
  if (i <= 0 || i >= route.length - 1) return false
  const p = route[i - 1]!
  const c = route[i]!
  const n = route[i + 1]!
  return (
    Math.sign(c.col - p.col) !== Math.sign(n.col - c.col)
    || Math.sign(c.row - p.row) !== Math.sign(n.row - c.row)
  )
}
