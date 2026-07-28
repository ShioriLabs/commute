// Geometry for the nav-rail card → fullscreen sheet morph
// (app/components/nav-buttons/sheet-button.tsx). The sheet's closed state is a
// transform that maps its own box onto the card's, so opening reads as the card
// expanding to fill the screen and closing as it collapsing back.
//
// Split out here because apps/web has no jsdom test environment — vitest.config.ts
// picks up only `utils/**/*.test.ts` and `app/**/*.test.ts` — so the geometry is
// the only part of the morph that can be covered by a test at all.

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export interface MorphStyle {
  // Maps the `to` box onto the `from` box. Assumes `transform-origin: top left`
  // on the element it is applied to.
  transform: string
  // `border-radius` shorthand, pre-divided by the scale (see below).
  radius: string
}

// Everything that can displace an element from its layout box, plus the
// transition that would otherwise animate our neutralising of them.
//
// `transform` alone is not enough on two counts. Tailwind v4 emits the
// *individual* transform properties, so `scale-105` compiles to `scale: 105%`
// rather than to a `transform`. And `transition-transform` in v4 covers all four
// of them, so simply writing `scale: none` starts a 1.05 → 1 *transition* and
// the synchronous read that follows returns the value it started from — the
// measurement silently comes back exactly as wrong as if nothing had been done.
const DISPLACING_PROPERTIES = ['transform', 'scale', 'rotate', 'translate'] as const

// An empty value removes the declaration, handing control back to whatever class
// had set it — which is what we want for every property that had no inline value
// to begin with.
function restore(element: HTMLElement, property: string, value: string) {
  if (value) element.style.setProperty(property, value)
  else element.style.removeProperty(property)
}

// The element's box as it *lays out*, with any transform taken back out.
//
// A plain getBoundingClientRect() returns the box as *drawn*, which folds in
// whatever transform happens to be live at measure time — and both boxes this
// morph needs are transformed at exactly the moment we want to measure them.
// The card carries `lg:hover:scale-105` and on a desktop the pointer is by
// definition on it at click time, so it measures ~5% too large. The sheet is
// measured while headlessui already has `data-closed` on it, i.e. already
// wearing the very transform we are trying to compute.
//
// Nothing is painted between the clear and the restore, so this is invisible.
// It costs a couple of forced style recalcs per measurement, which is fine at
// once per open plus resizes.
export function measureBox(element: HTMLElement): Box {
  const inlineTransition = element.style.getPropertyValue('transition')
  const inlineDisplacements = DISPLACING_PROPERTIES.map(p => element.style.getPropertyValue(p))

  element.style.setProperty('transition', 'none')
  DISPLACING_PROPERTIES.forEach(property => element.style.setProperty(property, 'none'))

  const { left, top, width, height } = element.getBoundingClientRect()

  DISPLACING_PROPERTIES.forEach((property, index) => restore(element, property, inlineDisplacements[index]))

  // Flush the restored displacements while transitions are still suppressed.
  // Without this the browser sees the element go from neutralised back to
  // transformed at the same style change event that re-enables transitions, and
  // helpfully animates it — a hovered card would visibly shrink to its layout
  // size and scale back up every time it was measured.
  void element.offsetWidth
  restore(element, 'transition', inlineTransition)

  return { left, top, width, height }
}

// Transform + radius that collapse `to` onto `from`.
//
// Returns null when either box has no area — an element that has not been laid
// out yet would otherwise divide by zero and put an `Infinity` in the transform
// string. That computes to `none`, which loses the animation *and* means no
// `transform` transitionend is ever emitted, so the caller has to know it got
// nothing rather than being handed a string that silently does neither.
export function morphStyle(from: Box, to: Box, cornerRadius: number): MorphStyle | null {
  const hasArea = from.width > 0 && from.height > 0 && to.width > 0 && to.height > 0
  if (!hasArea) return null

  const scaleX = from.width / to.width
  const scaleY = from.height / to.height
  const dx = from.left - to.left
  const dy = from.top - to.top

  // The radius is painted *through* that scale, so the card's own 12px corner
  // would come out as 12*scaleX wide by 12*scaleY tall — about 5px by 2px, i.e.
  // visibly sharp against the real card it is morphing into. Divide it back out
  // so both axes land on the card's radius once scaled. Two-value syntax is
  // horizontal / vertical radii.
  //
  // The same trap applies to any future border width, shadow, or px-based inset
  // on the sheet: anything sized in px there is painted through this scale.
  return {
    transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`,
    radius: `${cornerRadius / scaleX}px / ${cornerRadius / scaleY}px`
  }
}
