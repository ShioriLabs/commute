// Shared helpers for the overlays that build markup as strings.

/** Escapes text interpolated into an innerHTML template. */
export function escapeHTML(s: string): string {
  return s.replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c
  ))
}

/** Clamps v into [lo, hi], tolerating a hi below lo (narrow viewports). */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi))
}
