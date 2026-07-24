// Octilinear (0/45/90°) routing on the baked col/row lattice. Ported verbatim
// from the original Canvas2D hero (network-canvas.ts) — the lattice geometry is
// identical; only the projection to pixels/world changes downstream.

export interface GridCell {
  col: number
  row: number
}

// Octilinear route between two lattice cells: step diagonally (45°) along the
// shorter axis, then straight (H or V) for the remainder. Returns every cell
// the route passes through, inclusive of both ends.
export function octRoute(a: GridCell, b: GridCell): GridCell[] {
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
