// Subtle haptic tick for touch interactions. `navigator.vibrate` is absent on
// iOS Safari and may throw inside cross-origin iframes — both are non-fatal.
export function haptic(ms = 10) {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return
  try {
    navigator.vibrate(ms)
  } catch {
    // ignore
  }
}
